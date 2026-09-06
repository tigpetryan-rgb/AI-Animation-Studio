package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Engineering-only Phase-8 proof for the single M58 objective: Bim upright walking.
 *
 * This deliberately does not reuse the old generic mascot geometry as the visible proof model.
 * The accepted production identity still comes through Phase 7/8, while this gate renders a
 * dedicated Bim-shaped native skinned mesh and an analytically planted, alternating walk cycle.
 * Camera motion and audio are excluded so neither can hide bad character motion.
 */
@RunWith(AndroidJUnit4::class)
class NativePhase8BimUprightWalkInstrumentedTest {
    private companion object {
        const val DURATION_SECONDS = 10.0
        const val FRAME_RATE = 30.0
        const val FRAME_COUNT = 300
        const val HALF_STEP_SECONDS = 1.25
        const val HALF_STEP_COUNT = 8
        const val LEG_PIVOT_Y = 0.48
        const val LEG_SWING_DEGREES = 15.0
        const val ROOT_START_Z = -0.994
    }

    private val prompt =
        "Բիմը կանգնած դիրքով բնական քայլում է առաջ։ 10 վայրկյան 320x240 30 fps առանց ձայնի"

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_BIM_UPRIGHT_WALK_PROOF",
            model = "phase8-bim-upright-walk-v1",
            output = NativeSceneOutput(
                width = 320,
                height = 240,
                frameRate = FRAME_RATE,
                durationSeconds = DURATION_SECONDS,
            ),
            actions = listOf(
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WALK_TO,
                    actorId = request.actorId,
                    targetId = "walk_mark",
                    sourceExcerpt = "բնական քայլում է առաջ",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WAIT,
                    actorId = request.actorId,
                    sourceExcerpt = "կանգնած դիրքով",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LOOK_AT,
                    actorId = request.actorId,
                    targetId = "walk_mark",
                    sourceExcerpt = "առաջ",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.PICK_UP,
                    actorId = request.actorId,
                    targetId = "proof_prop",
                    sourceExcerpt = "proof contact",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.REACT,
                    actorId = request.actorId,
                    sourceExcerpt = "proof reaction",
                ),
            ),
        )
    }

    @Test
    fun bimProducesTenSecondUprightPlantedWalkWithLockedCamera() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val outputDir = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES))
        val frameDir = File(outputDir, "phase8-bim-upright-walk-frames")
        if (frameDir.exists()) frameDir.deleteRecursively()
        check(frameDir.mkdirs()) { "Unable to create Bim upright-walk frame directory." }
        outputDir.listFiles()
            ?.filter { it.name.startsWith("phase8-bim-upright-walk-") }
            ?.forEach { if (it != frameDir) it.deleteRecursively() }

        val referenceFile = File(context.cacheDir, "bim-upright-walk-reference.png")
        createBimReferenceImage(referenceFile)
        val referenceSha = sha256(referenceFile)
        val reference = PersistedReferenceAsset(
            displayName = "bim-upright-walk-reference.png",
            mimeType = "image/png",
            sizeBytes = referenceFile.length(),
            width = 512,
            height = 512,
            sha256 = referenceSha,
            originUri = "engineering://phase8/bim-upright-walk-reference",
            localFile = referenceFile,
        )

        val orchestration = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-bim-upright-walk-proof",
            prompt = prompt,
            reference = reference,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            backend = backend,
        )
        val plan = when (orchestration) {
            is NativePhase7OrchestrationResult.Ready -> orchestration.plan
            is NativePhase7OrchestrationResult.Rejected -> throw AssertionError(
                "Phase-7 rejected Bim upright-walk proof: ${diagnostics(orchestration.diagnostics)}",
            )
        }
        assertTrue("Phase-7 acceptance must be DONE.", plan.acceptance.done)
        assertEquals(FRAME_COUNT, plan.timeline.totalFrames)
        assertEquals(FRAME_RATE, plan.timeline.frameRate, 0.0)

        val bound = when (val result = NativePhase8RenderBinder.bind(plan)) {
            is NativePhase8RenderBindingResult.Ready -> result.plan
            is NativePhase8RenderBindingResult.Rejected -> throw AssertionError(
                "Phase-8 rejected Bim upright-walk proof: ${diagnostics(result.diagnostics)}",
            )
        }
        assertEquals(FRAME_COUNT, bound.frames.size)

        val bimModel = buildDedicatedBimModel(bound.model)
        val bounds = NativeModelBounds3D.from(bimModel)
        assertTrue("Bim proof model must be upright and full-height.", bounds.maxY - bounds.minY >= 1.85)
        assertTrue("Bim proof feet must reach the ground plane.", abs(bounds.minY) <= 0.02)

        val walkPerformance = buildUprightWalkPerformance(bound.performance)
        val maxContactDrift = maxStanceFootDriftMeters()
        assertTrue(
            "Analytic stance foot planting drift is too large: $maxContactDrift m",
            maxContactDrift <= 0.001,
        )
        val maxTorsoTilt = walkPerformance.tracks
            .filter { it.kind == NativePerformanceTrackKind.BODY }
            .flatMap { it.keyframes }
            .flatMap { frame ->
                listOfNotNull(
                    frame.rotations[NativeSemanticBoneRole.SPINE],
                    frame.rotations[NativeSemanticBoneRole.CHEST],
                )
            }
            .maxOfOrNull { rotation -> abs(rotation.x) + abs(rotation.y) + abs(rotation.z) }
            ?: 0.0
        assertTrue("Bim torso must remain upright, got $maxTorsoTilt degrees.", maxTorsoTilt <= 4.0)

        val decodedReference = requireNotNull(android.graphics.BitmapFactory.decodeFile(referenceFile.absolutePath))
        val palette = NativeReferencePalette3D(
            Color.rgb(66, 191, 190),
            Color.rgb(245, 220, 170),
            Color.rgb(8, 31, 34),
            Color.rgb(242, 180, 43),
            decodedReference,
            emptyList(),
            Color.rgb(246, 239, 224),
        )
        val fixedCamera = fixedProofCamera()
        val target = Bitmap.createBitmap(bound.width, bound.height, Bitmap.Config.ARGB_8888)
        val probeIndices = setOf(0, 38, 75, 113, 150, 188, 225, 263, 299)
        val probes = linkedMapOf<Int, IntArray>()

        try {
            bound.frames.forEach { frame ->
                val geometry = NativeSkinnedMeshRenderer3D.render(
                    target = target,
                    model = bimModel,
                    performance = walkPerformance,
                    camera = fixedCamera.copy(timeSeconds = frame.timeSeconds),
                    palette = palette,
                    timeSeconds = frame.timeSeconds,
                )
                check(geometry.visibleTriangles > 0) { "Frame ${frame.frameIndex} has no visible Bim triangles." }
                check(geometry.coveragePixels > 0L) { "Frame ${frame.frameIndex} has no visible Bim coverage." }

                applyProofStudioBackdrop(target)
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

        assertEquals(FRAME_COUNT, frameDir.listFiles()?.size ?: 0)
        assertEquals(probeIndices.size, probes.size)
        val firstProbe = checkNotNull(probes[0])
        val maxChangedFraction = probes.filterKeys { it != 0 }.values
            .maxOf { changedPixelFraction(firstProbe, it) }
        assertTrue(
            "Locked-camera Bim proof does not show enough character motion: $maxChangedFraction",
            maxChangedFraction >= 0.02,
        )

        val finalRoot = gaitSample(DURATION_SECONDS).root
        val rootTravel = finalRoot.z - gaitSample(0.0).root.z
        assertTrue("Bim walk must visibly translate forward.", rootTravel >= 1.85)

        File(outputDir, "phase8-bim-upright-walk-manifest.txt").writeText(
            buildString {
                appendLine("scope=BIM_UPRIGHT_WALK_PROOF")
                appendLine("character=BIM")
                appendLine("durationSeconds=$DURATION_SECONDS")
                appendLine("frameRate=$FRAME_RATE")
                appendLine("frameCount=$FRAME_COUNT")
                appendLine("audioTested=false")
                appendLine("cameraMode=LOCKED_BIM_UPRIGHT_PROOF_CAMERA")
                appendLine("modelMode=BIM_DEDICATED_NATIVE_SKINNED_MODEL_V1")
                appendLine("gaitMode=EIGHT_HALF_STEP_ANALYTIC_PLANTED_STANCE_V1")
                appendLine("floorMode=STATIC_GRID_SLIDE_EVIDENCE")
                appendLine("samplingMode=NATIVE_RENDERER_30FPS_NO_HOST_INTERPOLATION")
                appendLine("sourceCommit=${BuildConfig.STUDIO_COMMIT_SHA}")
                appendLine("referenceSha256=$referenceSha")
                appendLine("scriptSha256=${plan.ir.scriptSha256}")
                appendLine("rootTravelMeters=$rootTravel")
                appendLine("maxStanceFootDriftMeters=$maxContactDrift")
                appendLine("maxTorsoTiltDegrees=$maxTorsoTilt")
                appendLine("legSwingDegrees=$LEG_SWING_DEGREES")
                appendLine("visualVerdict=PENDING_HUMAN_REVIEW")
            },
        )
    }

    private data class GaitSample(
        val root: NativeStagePoint,
        val leftLegDegrees: Double,
        val rightLegDegrees: Double,
        val leftStance: Boolean,
    )

    private fun gaitSample(timeSeconds: Double): GaitSample {
        val bounded = timeSeconds.coerceIn(0.0, DURATION_SECONDS)
        val rawStep = (bounded / HALF_STEP_SECONDS).toInt()
        val stepIndex = rawStep.coerceIn(0, HALF_STEP_COUNT - 1)
        val stepStart = stepIndex * HALF_STEP_SECONDS
        val local = if (bounded >= DURATION_SECONDS) {
            1.0
        } else {
            ((bounded - stepStart) / HALF_STEP_SECONDS).coerceIn(0.0, 1.0)
        }
        val stanceDegrees = -LEG_SWING_DEGREES + 2.0 * LEG_SWING_DEGREES * local
        val stanceRadians = Math.toRadians(stanceDegrees)
        val swingAdvance = 2.0 * LEG_PIVOT_Y * sin(Math.toRadians(LEG_SWING_DEGREES))
        val root = NativeStagePoint(
            x = 0.0,
            y = LEG_PIVOT_Y * (cos(stanceRadians) - 1.0),
            z = ROOT_START_Z +
                stepIndex * swingAdvance +
                LEG_PIVOT_Y * (sin(stanceRadians) + sin(Math.toRadians(LEG_SWING_DEGREES))),
        )
        val leftStance = stepIndex % 2 == 0
        val left = if (leftStance) stanceDegrees else -stanceDegrees
        val right = if (leftStance) -stanceDegrees else stanceDegrees
        return GaitSample(root, left, right, leftStance)
    }

    private fun buildUprightWalkPerformance(base: NativeActingPerformance): NativeActingPerformance {
        val times = (0..FRAME_COUNT).map { index -> index.toDouble() / FRAME_RATE }
        fun frames(rotations: (GaitSample) -> Map<NativeSemanticBoneRole, NativeEulerDegrees>) =
            times.map { time ->
                val sample = gaitSample(time)
                NativePerformancePoseKeyframe(
                    timeSeconds = time,
                    rootPosition = sample.root,
                    rotations = rotations(sample),
                )
            }

        val rootTrack = NativePerformanceTrack(
            id = "bim-upright-root-v1",
            kind = NativePerformanceTrackKind.ROOT,
            keyframes = frames { emptyMap() },
        )
        val bodyTrack = NativePerformanceTrack(
            id = "bim-upright-body-v1",
            kind = NativePerformanceTrackKind.BODY,
            keyframes = frames { sample ->
                mapOf(
                    NativeSemanticBoneRole.SPINE to NativeEulerDegrees(1.2, 0.0, 0.6),
                    NativeSemanticBoneRole.CHEST to NativeEulerDegrees(-1.0, 0.0, -0.4),
                    NativeSemanticBoneRole.LEFT_UPPER_LEG to NativeEulerDegrees(sample.leftLegDegrees, 0.0, 0.0),
                    NativeSemanticBoneRole.RIGHT_UPPER_LEG to NativeEulerDegrees(sample.rightLegDegrees, 0.0, 0.0),
                )
            },
        )
        val headTrack = NativePerformanceTrack(
            id = "bim-upright-head-v1",
            kind = NativePerformanceTrackKind.HEAD,
            keyframes = frames { emptyMap() },
        )
        val leftArmTrack = NativePerformanceTrack(
            id = "bim-upright-left-arm-v1",
            kind = NativePerformanceTrackKind.LEFT_HAND,
            keyframes = frames { sample ->
                mapOf(
                    NativeSemanticBoneRole.LEFT_UPPER_ARM to NativeEulerDegrees(-sample.leftLegDegrees * 0.62, 0.0, 2.0),
                )
            },
        )
        val rightArmTrack = NativePerformanceTrack(
            id = "bim-upright-right-arm-v1",
            kind = NativePerformanceTrackKind.RIGHT_HAND,
            keyframes = frames { sample ->
                mapOf(
                    NativeSemanticBoneRole.RIGHT_UPPER_ARM to NativeEulerDegrees(-sample.rightLegDegrees * 0.62, 0.0, -2.0),
                )
            },
        )
        return base.copy(
            tracks = listOf(rootTrack, bodyTrack, headTrack, leftArmTrack, rightArmTrack),
            durationSeconds = DURATION_SECONDS,
        )
    }

    private fun buildDedicatedBimModel(base: NativeCharacterModel3D): NativeCharacterModel3D {
        val vertices = mutableListOf<NativeMeshVertex3D>()
        val triangles = mutableListOf<NativeMeshTriangle3D>()
        val latSegments = 10
        val lonSegments = 16

        fun addEllipsoid(
            center: NativeStagePoint,
            radii: NativeStagePoint,
            bone: NativeSemanticBoneRole,
            material: NativeMaterialSlot3D,
        ) {
            val start = vertices.size
            for (lat in 0..latSegments) {
                val v = lat.toDouble() / latSegments.toDouble()
                val theta = PI * v
                val sinTheta = sin(theta)
                val cosTheta = cos(theta)
                for (lon in 0..lonSegments) {
                    val u = lon.toDouble() / lonSegments.toDouble()
                    val phi = 2.0 * PI * u
                    val localX = radii.x * sinTheta * cos(phi)
                    val localY = radii.y * cosTheta
                    val localZ = radii.z * sinTheta * sin(phi)
                    val nx = if (radii.x <= 1e-9) 0.0 else localX / (radii.x * radii.x)
                    val ny = if (radii.y <= 1e-9) 0.0 else localY / (radii.y * radii.y)
                    val nz = if (radii.z <= 1e-9) 0.0 else localZ / (radii.z * radii.z)
                    val length = sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(1e-9)
                    vertices += NativeMeshVertex3D(
                        bindPosition = NativeStagePoint(center.x + localX, center.y + localY, center.z + localZ),
                        bindNormal = NativeStagePoint(nx / length, ny / length, nz / length),
                        uv = NativeUvPoint(u, v),
                        material = material,
                        influences = listOf(NativeSkinInfluence3D(bone, 1.0)),
                    )
                }
            }
            val row = lonSegments + 1
            for (lat in 0 until latSegments) {
                for (lon in 0 until lonSegments) {
                    val a = start + lat * row + lon
                    val b = a + row
                    val c = a + 1
                    val d = b + 1
                    triangles += NativeMeshTriangle3D(a, b, c)
                    triangles += NativeMeshTriangle3D(c, b, d)
                }
            }
        }

        addEllipsoid(
            NativeStagePoint(0.0, 1.03, 0.0),
            NativeStagePoint(0.47, 0.56, 0.34),
            NativeSemanticBoneRole.SPINE,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.0, 1.62, 0.0),
            NativeStagePoint(0.53, 0.47, 0.39),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.0, 1.60, 0.365),
            NativeStagePoint(0.36, 0.30, 0.052),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.FACE,
        )
        addEllipsoid(
            NativeStagePoint(-0.145, 1.67, 0.408),
            NativeStagePoint(0.068, 0.095, 0.030),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.EYE,
        )
        addEllipsoid(
            NativeStagePoint(0.145, 1.67, 0.408),
            NativeStagePoint(0.068, 0.095, 0.030),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.EYE,
        )
        addEllipsoid(
            NativeStagePoint(0.0, 1.43, 0.414),
            NativeStagePoint(0.095, 0.028, 0.020),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.EYE,
        )
        addEllipsoid(
            NativeStagePoint(-0.53, 1.58, -0.01),
            NativeStagePoint(0.16, 0.30, 0.16),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.53, 1.58, -0.01),
            NativeStagePoint(0.16, 0.30, 0.16),
            NativeSemanticBoneRole.HEAD,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(-0.53, 0.94, 0.0),
            NativeStagePoint(0.145, 0.34, 0.145),
            NativeSemanticBoneRole.LEFT_UPPER_ARM,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(-0.55, 0.68, 0.015),
            NativeStagePoint(0.16, 0.17, 0.15),
            NativeSemanticBoneRole.LEFT_UPPER_ARM,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.53, 0.94, 0.0),
            NativeStagePoint(0.145, 0.34, 0.145),
            NativeSemanticBoneRole.RIGHT_UPPER_ARM,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.55, 0.68, 0.015),
            NativeStagePoint(0.16, 0.17, 0.15),
            NativeSemanticBoneRole.RIGHT_UPPER_ARM,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(-0.20, 0.31, 0.0),
            NativeStagePoint(0.155, 0.28, 0.145),
            NativeSemanticBoneRole.LEFT_UPPER_LEG,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(-0.20, 0.105, 0.0),
            NativeStagePoint(0.205, 0.105, 0.245),
            NativeSemanticBoneRole.LEFT_UPPER_LEG,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.20, 0.31, 0.0),
            NativeStagePoint(0.155, 0.28, 0.145),
            NativeSemanticBoneRole.RIGHT_UPPER_LEG,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.20, 0.105, 0.0),
            NativeStagePoint(0.205, 0.105, 0.245),
            NativeSemanticBoneRole.RIGHT_UPPER_LEG,
            NativeMaterialSlot3D.BODY,
        )
        addEllipsoid(
            NativeStagePoint(0.0, 0.94, 0.35),
            NativeStagePoint(0.145, 0.145, 0.050),
            NativeSemanticBoneRole.CHEST,
            NativeMaterialSlot3D.ACCENT,
        )

        return base.copy(vertices = vertices, triangles = triangles)
    }

    private fun maxStanceFootDriftMeters(): Double {
        var maxDrift = 0.0
        repeat(HALF_STEP_COUNT) { step ->
            val startTime = step * HALF_STEP_SECONDS
            val anchor = stanceFootContact(gaitSample(startTime + 1e-6))
            for (sampleIndex in 0..30) {
                val fraction = sampleIndex / 30.0
                val time = (startTime + fraction * HALF_STEP_SECONDS).coerceAtMost(DURATION_SECONDS - 1e-6)
                val current = stanceFootContact(gaitSample(time))
                maxDrift = maxOf(maxDrift, distance(anchor, current))
            }
        }
        return maxDrift
    }

    private fun stanceFootContact(sample: GaitSample): NativeStagePoint {
        val angle = Math.toRadians(if (sample.leftStance) sample.leftLegDegrees else sample.rightLegDegrees)
        val x = if (sample.leftStance) -0.20 else 0.20
        return NativeStagePoint(
            x = x + sample.root.x,
            y = LEG_PIVOT_Y - LEG_PIVOT_Y * cos(angle) + sample.root.y,
            z = -LEG_PIVOT_Y * sin(angle) + sample.root.z,
        )
    }

    private fun fixedProofCamera(): NativeProductionCameraSample {
        val position = NativeStagePoint(5.5, 1.20, 3.0)
        val target = NativeStagePoint(0.0, 1.20, 0.0)
        val dx = position.x - target.x
        val dy = position.y - target.y
        val dz = position.z - target.z
        return NativeProductionCameraSample(
            timeSeconds = 0.0,
            position = position,
            target = target,
            verticalFovDegrees = 38.0,
            distanceToTarget = sqrt(dx * dx + dy * dy + dz * dz),
        )
    }

    private fun applyProofStudioBackdrop(bitmap: Bitmap) {
        val backdrop = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(backdrop)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(Color.rgb(238, 231, 218))
        val floorTop = bitmap.height * 0.79f
        paint.color = Color.rgb(189, 171, 145)
        canvas.drawRect(0f, floorTop, bitmap.width.toFloat(), bitmap.height.toFloat(), paint)

        paint.color = Color.rgb(137, 119, 96)
        paint.strokeWidth = 1.5f
        listOf(0.84f, 0.90f, 0.96f).forEach { fraction ->
            val y = bitmap.height * fraction
            canvas.drawLine(0f, y, bitmap.width.toFloat(), y, paint)
        }
        for (x in 20 until bitmap.width step 30) {
            canvas.drawLine(x.toFloat(), floorTop, x.toFloat(), bitmap.height.toFloat(), paint)
        }

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
        canvas.drawOval(222f, 254f, 290f, 269f, paint)
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

    private fun distance(a: NativeStagePoint, b: NativeStagePoint): Double {
        val dx = a.x - b.x
        val dy = a.y - b.y
        val dz = a.z - b.z
        return sqrt(dx * dx + dy * dy + dz * dz)
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
