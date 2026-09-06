package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Engineering-only visual proof: Bim walks through a warm home interior. */
@RunWith(AndroidJUnit4::class)
class NativePhase8BimHomeWalkInstrumentedTest {
    private val prompt =
        "Բիմը քայլում է իր տան միջով դեպի գրքերի դարակը, կանգնում է, նայում է գրքին, վերցնում է գիրքը և վերջում ուրախ արձագանքում։ 10 վայրկյան 320x240 30 fps"

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_BIM_HOME_WALK_PROOF",
            model = "phase8-bim-home-walk-v3",
            output = NativeSceneOutput(
                width = 320,
                height = 240,
                frameRate = 30.0,
                durationSeconds = 10.0,
            ),
            actions = listOf(
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WALK_TO,
                    actorId = request.actorId,
                    targetId = "bookshelf",
                    sourceExcerpt = "քայլում է իր տան միջով դեպի գրքերի դարակը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WAIT,
                    actorId = request.actorId,
                    sourceExcerpt = "կանգնում է",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LOOK_AT,
                    actorId = request.actorId,
                    targetId = "book",
                    sourceExcerpt = "նայում է գրքին",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.PICK_UP,
                    actorId = request.actorId,
                    targetId = "book",
                    sourceExcerpt = "վերցնում է գիրքը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.REACT,
                    actorId = request.actorId,
                    sourceExcerpt = "վերջում ուրախ արձագանքում",
                ),
            ),
        )
    }

    @Test
    fun bimWalksThroughHomeInTenSecondNativeVisualProof() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val outputDir = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES))
        val frameDir = File(outputDir, "phase8-bim-home-frames")
        if (frameDir.exists()) frameDir.deleteRecursively()
        check(frameDir.mkdirs()) { "Unable to create Bim home frame directory." }
        outputDir.listFiles()
            ?.filter { it.name.startsWith("phase8-bim-home-") }
            ?.forEach { if (it != frameDir) it.deleteRecursively() }

        val referenceFile = File(context.cacheDir, "phase8-bim-reference.png")
        createBimReferenceImage(referenceFile)
        val referenceSha = sha256(referenceFile)
        val reference = PersistedReferenceAsset(
            displayName = "bim-character-reference.png",
            mimeType = "image/png",
            sizeBytes = referenceFile.length(),
            width = 512,
            height = 512,
            sha256 = referenceSha,
            originUri = "engineering://phase8/bim-character-reference",
            localFile = referenceFile,
        )

        val orchestration = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-bim-home-walk-proof",
            prompt = prompt,
            reference = reference,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            backend = backend,
        )
        val plan = when (orchestration) {
            is NativePhase7OrchestrationResult.Ready -> orchestration.plan
            is NativePhase7OrchestrationResult.Rejected -> throw AssertionError(
                "Phase-7 rejected Bim home proof: ${diagnostics(orchestration.diagnostics)}",
            )
        }
        assertTrue("Phase-7 acceptance must be DONE.", plan.acceptance.done)
        assertEquals(300, plan.timeline.totalFrames)
        assertEquals(30.0, plan.timeline.frameRate, 0.0)

        val bound = when (val result = NativePhase8RenderBinder.bind(plan)) {
            is NativePhase8RenderBindingResult.Ready -> result.plan
            is NativePhase8RenderBindingResult.Rejected -> throw AssertionError(
                "Phase-8 rejected Bim home proof: ${diagnostics(result.diagnostics)}",
            )
        }
        assertEquals(300, bound.frames.size)

        val maxRotationMagnitude = bound.performance.tracks
            .flatMap { it.keyframes }
            .flatMap { it.rotations.values }
            .maxOfOrNull { rotation -> abs(rotation.x) + abs(rotation.y) + abs(rotation.z) }
            ?: 0.0
        assertTrue("Bim proof requires visible skeletal motion.", maxRotationMagnitude >= 20.0)

        val decodedReference = requireNotNull(BitmapFactory.decodeFile(referenceFile.absolutePath))
        val palette = NativeReferencePalette3D.fromBitmap(decodedReference)
        val initialCamera = NativePhase8RenderBinder.sampleCamera(bound.frames.first())
        val fixedCamera = scaledCamera(initialCamera, 1.12)
        val target = Bitmap.createBitmap(bound.width, bound.height, Bitmap.Config.ARGB_8888)
        val probes = linkedMapOf<Int, IntArray>()
        val probeIndices = setOf(0, 60, 120, 180, 240, 299)

        try {
            bound.frames.forEach { frame ->
                val geometry = NativeSkinnedMeshRenderer3D.render(
                    target = target,
                    model = bound.model,
                    performance = bound.performance,
                    camera = fixedCamera.copy(timeSeconds = frame.timeSeconds),
                    palette = palette,
                    timeSeconds = frame.timeSeconds,
                )
                check(geometry.visibleTriangles > 0) { "Frame ${frame.frameIndex} has no visible triangles." }
                check(geometry.coveragePixels > 0L) { "Frame ${frame.frameIndex} has no visible Bim coverage." }

                applyWarmHomeBackdrop(target)
                val frameFile = File(frameDir, "frame-%03d.png".format(frame.frameIndex))
                frameFile.outputStream().use { stream ->
                    check(target.compress(Bitmap.CompressFormat.PNG, 100, stream))
                }
                check(frameFile.isFile && frameFile.length() > 0L)
                if (frame.frameIndex in probeIndices) probes[frame.frameIndex] = pixels(target)
            }
        } finally {
            target.recycle()
            decodedReference.recycle()
        }

        assertEquals(300, frameDir.listFiles()?.size ?: 0)
        assertEquals(probeIndices.size, probes.size)
        val firstProbe = checkNotNull(probes[0])
        val maxChangedFraction = probes.filterKeys { it != 0 }.values.maxOf { changedPixelFraction(firstProbe, it) }
        assertTrue(
            "Bim locked-camera proof does not show enough visible motion: $maxChangedFraction",
            maxChangedFraction >= 0.015,
        )

        File(outputDir, "phase8-bim-home-manifest.txt").writeText(
            buildString {
                appendLine("scope=BIM_HOME_WALK_VIDEO_ONLY")
                appendLine("character=BIM")
                appendLine("durationSeconds=10.0")
                appendLine("frameRate=30.0")
                appendLine("frameCount=300")
                appendLine("audioTested=false")
                appendLine("cameraMode=LOCKED_PHASE8_FIRST_CAMERA")
                appendLine("modelMode=CURRENT_NATIVE_SKINNED_MASCOT_PROXY_WITH_BIM_REFERENCE_PALETTE")
                appendLine("environmentMode=ENGINEERING_HOME_BACKDROP_OVER_NATIVE_RENDER_BACKGROUND")
                appendLine("samplingMode=NATIVE_RENDERER_30FPS_NO_HOST_INTERPOLATION")
                appendLine("sourceCommit=${BuildConfig.STUDIO_COMMIT_SHA}")
                appendLine("referenceSha256=$referenceSha")
                appendLine("scriptSha256=${plan.ir.scriptSha256}")
                appendLine("maxRotationMagnitudeDegrees=$maxRotationMagnitude")
                appendLine("maxChangedPixelFraction=$maxChangedFraction")
            },
        )
    }

    private fun scaledCamera(camera: NativeProductionCameraSample, scale: Double): NativeProductionCameraSample {
        val dx = camera.position.x - camera.target.x
        val dy = camera.position.y - camera.target.y
        val dz = camera.position.z - camera.target.z
        return camera.copy(
            position = NativeStagePoint(
                camera.target.x + dx * scale,
                camera.target.y + dy * scale,
                camera.target.z + dz * scale,
            ),
            distanceToTarget = camera.distanceToTarget * scale,
        )
    }

    /** Replaces only the native renderer's exact flat background colors. */
    private fun applyWarmHomeBackdrop(bitmap: Bitmap) {
        val backdrop = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(backdrop)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        canvas.drawColor(Color.rgb(231, 207, 169))
        paint.color = Color.rgb(196, 136, 79)
        canvas.drawRect(0f, bitmap.height * 0.72f, bitmap.width.toFloat(), bitmap.height.toFloat(), paint)

        // Bookshelf.
        paint.color = Color.rgb(112, 73, 48)
        canvas.drawRoundRect(12f, 44f, 78f, 174f, 6f, 6f, paint)
        paint.color = Color.rgb(177, 121, 69)
        canvas.drawRect(18f, 54f, 72f, 166f, paint)
        paint.color = Color.rgb(91, 57, 38)
        listOf(82f, 112f, 142f).forEach { y -> canvas.drawRect(18f, y, 72f, y + 4f, paint) }
        val bookColors = listOf(
            Color.rgb(74, 124, 153),
            Color.rgb(166, 82, 68),
            Color.rgb(89, 137, 92),
            Color.rgb(219, 172, 75),
        )
        var bx = 22f
        repeat(8) { index ->
            paint.color = bookColors[index % bookColors.size]
            canvas.drawRect(bx, 60f + (index % 2) * 4f, bx + 5f, 80f, paint)
            bx += 6f
        }

        // Window.
        paint.color = Color.rgb(129, 185, 196)
        canvas.drawRect(252f, 43f, 301f, 111f, paint)
        paint.color = Color.rgb(245, 220, 132)
        canvas.drawCircle(287f, 58f, 12f, paint)
        paint.color = Color.rgb(105, 77, 55)
        canvas.drawRect(275f, 43f, 279f, 111f, paint)
        canvas.drawRect(252f, 76f, 301f, 80f, paint)

        // Rug and side table.
        paint.color = Color.rgb(173, 74, 67)
        canvas.drawOval(95f, 188f, 244f, 228f, paint)
        paint.color = Color.rgb(98, 63, 42)
        canvas.drawRect(270f, 154f, 304f, 161f, paint)
        canvas.drawRect(276f, 161f, 281f, 206f, paint)
        canvas.drawRect(295f, 161f, 300f, 206f, paint)

        val rendererWall = Color.rgb(10, 12, 16)
        val rendererGround = Color.rgb(18, 21, 27)
        for (y in 0 until bitmap.height) {
            for (x in 0 until bitmap.width) {
                val pixel = bitmap.getPixel(x, y)
                if (pixel == rendererWall || pixel == rendererGround) {
                    bitmap.setPixel(x, y, backdrop.getPixel(x, y))
                }
            }
        }
        backdrop.recycle()
    }

    /** Programmatic Bim reference used only to drive the current palette/reconstruction path. */
    private fun createBimReferenceImage(file: File) {
        val bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(Color.rgb(246, 239, 224))

        val turquoise = Color.rgb(66, 191, 190)
        val cream = Color.rgb(245, 220, 170)
        val eye = Color.rgb(8, 31, 34)
        val gold = Color.rgb(242, 180, 43)
        val cord = Color.rgb(105, 65, 42)

        paint.color = turquoise
        canvas.drawOval(124f, 116f, 388f, 392f, paint)
        canvas.drawCircle(256f, 163f, 132f, paint)
        canvas.drawOval(84f, 137f, 158f, 279f, paint)
        canvas.drawOval(354f, 137f, 428f, 279f, paint)
        canvas.drawOval(146f, 342f, 236f, 458f, paint)
        canvas.drawOval(276f, 342f, 366f, 458f, paint)

        paint.color = cream
        canvas.drawOval(148f, 97f, 364f, 286f, paint)
        paint.color = eye
        canvas.drawOval(183f, 145f, 242f, 226f, paint)
        canvas.drawOval(270f, 145f, 329f, 226f, paint)
        paint.color = Color.WHITE
        canvas.drawCircle(221f, 167f, 10f, paint)
        canvas.drawCircle(308f, 167f, 10f, paint)

        paint.color = cord
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 8f
        canvas.drawOval(196f, 264f, 316f, 347f, paint)
        paint.style = Paint.Style.FILL
        paint.color = gold
        canvas.drawCircle(256f, 337f, 34f, paint)
        paint.color = Color.rgb(255, 226, 76)
        val star = android.graphics.Path().apply {
            moveTo(256f, 310f)
            lineTo(264f, 329f)
            lineTo(285f, 330f)
            lineTo(269f, 343f)
            lineTo(274f, 364f)
            lineTo(256f, 352f)
            lineTo(238f, 364f)
            lineTo(243f, 343f)
            lineTo(227f, 330f)
            lineTo(248f, 329f)
            close()
        }
        canvas.drawPath(star, paint)

        file.outputStream().use { stream -> check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) }
        bitmap.recycle()
    }

    private fun pixels(bitmap: Bitmap): IntArray = IntArray(bitmap.width * bitmap.height).also {
        bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    }

    private fun changedPixelFraction(left: IntArray, right: IntArray): Double {
        require(left.size == right.size && left.isNotEmpty())
        var changed = 0
        left.indices.forEach { index ->
            val a = left[index]
            val b = right[index]
            val delta = abs(Color.red(a) - Color.red(b)) +
                abs(Color.green(a) - Color.green(b)) +
                abs(Color.blue(a) - Color.blue(b))
            if (delta >= 36) changed += 1
        }
        return changed.toDouble() / left.size.toDouble()
    }

    private fun diagnostics(values: List<NativeDiagnostic>): String = values.joinToString(" | ") {
        "${it.code}: ${it.message}"
    }.ifBlank { "no diagnostics returned" }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
