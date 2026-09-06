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

/**
 * Engineering-only visual motion proof for Phase 8.
 *
 * The production camera is intentionally locked for every frame so camera movement cannot satisfy
 * the motion gate. Every PNG is rendered by the real native skinned-mesh renderer from the accepted
 * Phase-7 plan. Host CI later packages these exact frames into a broadly playable video-only MP4/GIF.
 * Audio is explicitly outside this proof.
 */
@RunWith(AndroidJUnit4::class)
class NativePhase8CharacterMotionProofInstrumentedTest {
    private val prompt =
        "Դերասանը քայլում է դեպի տուփը, կանգնում է, նայում է տուփին, վերցնում է այն և արձագանքում։ 14 վայրկյան 320x240 12 fps"

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_CHARACTER_MOTION_PROOF",
            model = "phase8-fixed-camera-motion-proof-v1",
            output = NativeSceneOutput(
                width = 320,
                height = 240,
                frameRate = 12.0,
                durationSeconds = 14.0,
            ),
            actions = listOf(
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WALK_TO,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "քայլում է դեպի տուփը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WAIT,
                    actorId = request.actorId,
                    sourceExcerpt = "կանգնում է",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LOOK_AT,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "նայում է տուփին",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.PICK_UP,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "վերցնում է այն",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.REACT,
                    actorId = request.actorId,
                    sourceExcerpt = "արձագանքում",
                ),
            ),
        )
    }

    @Test
    fun acceptedPhase7PerformanceProducesVisibleCharacterMotionWithLockedCamera() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val outputDir = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES))
        val frameDir = File(outputDir, "phase8-motion-frames")
        if (frameDir.exists()) frameDir.deleteRecursively()
        check(frameDir.mkdirs()) { "Unable to create Phase-8 motion frame directory." }
        outputDir.listFiles()
            ?.filter { it.name.startsWith("phase8-character-") || it.name == "phase8-motion-manifest.txt" }
            ?.forEach { it.deleteRecursively() }

        val referenceFile = File(context.cacheDir, "phase8-motion-reference.png")
        createReferenceImage(referenceFile)
        val referenceSha = sha256(referenceFile)
        val reference = PersistedReferenceAsset(
            displayName = referenceFile.name,
            mimeType = "image/png",
            sizeBytes = referenceFile.length(),
            width = 512,
            height = 512,
            sha256 = referenceSha,
            originUri = "engineering://phase8/character-motion-reference",
            localFile = referenceFile,
        )

        val orchestration = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-character-motion-proof",
            prompt = prompt,
            reference = reference,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            backend = backend,
        )
        val plan = requirePhase7Ready(orchestration)
        assertTrue("Phase-7 acceptance must be DONE before character-motion proof.", plan.acceptance.done)
        assertEquals(168, plan.timeline.totalFrames)
        assertEquals(12.0, plan.timeline.frameRate, 0.0)

        val bound = when (val result = NativePhase8RenderBinder.bind(plan)) {
            is NativePhase8RenderBindingResult.Ready -> result.plan
            is NativePhase8RenderBindingResult.Rejected -> throw AssertionError(
                "Phase-8 binding rejected before character-motion proof: ${diagnostics(result.diagnostics)}",
            )
        }
        assertEquals(168, bound.frames.size)

        val maxRotationMagnitude = bound.performance.tracks
            .flatMap { it.keyframes }
            .flatMap { it.rotations.values }
            .maxOfOrNull { rotation -> abs(rotation.x) + abs(rotation.y) + abs(rotation.z) }
            ?: 0.0
        assertTrue(
            "Character-motion proof requires non-trivial skeletal animation keys, got $maxRotationMagnitude degrees.",
            maxRotationMagnitude >= 20.0,
        )

        val decodedReference = requireNotNull(BitmapFactory.decodeFile(referenceFile.absolutePath)) {
            "Unable to decode Phase-8 motion reference image."
        }
        val palette = NativeReferencePalette3D.fromBitmap(decodedReference)
        val initialCamera = NativePhase8RenderBinder.sampleCamera(bound.frames.first())
        val fixedCamera = closerCamera(initialCamera, 0.78)
        val target = Bitmap.createBitmap(bound.width, bound.height, Bitmap.Config.ARGB_8888)
        val probeIndices = setOf(0, 10, 20, 72, 94, 167)
        val probes = linkedMapOf<Int, IntArray>()

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
                check(geometry.visibleTriangles > 0) { "Frame ${frame.frameIndex} has no visible 3D triangles." }
                check(geometry.coveragePixels > 0L) { "Frame ${frame.frameIndex} has no visible character coverage." }

                val frameFile = File(frameDir, "frame-%03d.png".format(frame.frameIndex))
                frameFile.outputStream().use { stream ->
                    check(target.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                        "Unable to persist motion frame ${frame.frameIndex}."
                    }
                }
                check(frameFile.isFile && frameFile.length() > 0L)
                if (frame.frameIndex in probeIndices) probes[frame.frameIndex] = pixels(target)
            }
        } finally {
            if (!target.isRecycled) target.recycle()
            if (!decodedReference.isRecycled) decodedReference.recycle()
        }

        assertEquals("Motion proof must render all 168 fixed-camera frames.", 168, frameDir.listFiles()?.size ?: 0)
        assertEquals("All requested motion probes must be rendered.", probeIndices.size, probes.size)
        val firstProbe = checkNotNull(probes[0])
        val maxChangedFraction = probes
            .filterKeys { it != 0 }
            .values
            .maxOf { candidate -> changedPixelFraction(firstProbe, candidate) }
        assertTrue(
            "Locked-camera frames do not show enough visible character motion: changedFraction=$maxChangedFraction",
            maxChangedFraction >= 0.015,
        )

        File(outputDir, "phase8-motion-manifest.txt").writeText(
            buildString {
                appendLine("scope=CHARACTER_MOTION_PROOF_VIDEO_ONLY")
                appendLine("audioTested=false")
                appendLine("cameraMode=LOCKED_PHASE8_FIRST_CAMERA")
                appendLine("cameraDistanceScale=0.78")
                appendLine("sourceCommit=${BuildConfig.STUDIO_COMMIT_SHA}")
                appendLine("referenceSha256=$referenceSha")
                appendLine("scriptSha256=${plan.ir.scriptSha256}")
                appendLine("frameRate=${plan.timeline.frameRate}")
                appendLine("frameCount=${bound.frames.size}")
                appendLine("maxRotationMagnitudeDegrees=$maxRotationMagnitude")
                appendLine("maxChangedPixelFraction=$maxChangedFraction")
            },
        )
    }

    private fun requirePhase7Ready(result: NativePhase7OrchestrationResult): NativePhase7ProductionPlan = when (result) {
        is NativePhase7OrchestrationResult.Ready -> result.plan
        is NativePhase7OrchestrationResult.Rejected -> throw AssertionError(
            "Phase-7 orchestration rejected before motion proof: ${diagnostics(result.diagnostics)}",
        )
    }

    private fun closerCamera(camera: NativeProductionCameraSample, scale: Double): NativeProductionCameraSample {
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

    private fun pixels(bitmap: Bitmap): IntArray = IntArray(bitmap.width * bitmap.height).also { values ->
        bitmap.getPixels(values, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    }

    private fun changedPixelFraction(left: IntArray, right: IntArray): Double {
        require(left.size == right.size && left.isNotEmpty())
        var changed = 0
        left.indices.forEach { index ->
            val a = left[index]
            val b = right[index]
            val delta =
                abs(Color.red(a) - Color.red(b)) +
                    abs(Color.green(a) - Color.green(b)) +
                    abs(Color.blue(a) - Color.blue(b))
            if (delta >= 36) changed += 1
        }
        return changed.toDouble() / left.size.toDouble()
    }

    private fun createReferenceImage(file: File) {
        val bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(32, 38, 48))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.rgb(224, 180, 145)
        canvas.drawCircle(256f, 155f, 92f, paint)
        paint.color = Color.rgb(52, 110, 190)
        canvas.drawRoundRect(150f, 245f, 362f, 470f, 42f, 42f, paint)
        paint.color = Color.rgb(28, 30, 36)
        canvas.drawRect(190f, 120f, 322f, 150f, paint)
        paint.color = Color.WHITE
        canvas.drawCircle(222f, 165f, 10f, paint)
        canvas.drawCircle(290f, 165f, 10f, paint)
        file.outputStream().use { stream ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
        bitmap.recycle()
    }

    private fun diagnostics(values: List<NativeDiagnostic>): String = values.joinToString(" | ") { diagnostic ->
        "${diagnostic.code}: ${diagnostic.message}"
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
