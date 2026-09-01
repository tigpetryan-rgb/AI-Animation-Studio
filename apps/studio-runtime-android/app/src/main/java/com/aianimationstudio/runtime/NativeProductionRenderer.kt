package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.tan

internal const val NATIVE_PRODUCTION_RENDER_EXECUTOR_KIND = "AISTUDIO_SOURCE_BOUND_2D_CUTOUT_V1"

internal data class NativeProductionPoseSample(
    val timeSeconds: Double,
    val rootPosition: NativeStagePoint,
    val bodyPitchDegrees: Double,
    val bodyLeanDegrees: Double,
    val headYawDegrees: Double,
    val rightArmSwingDegrees: Double,
)

internal data class NativeProductionCameraSample(
    val timeSeconds: Double,
    val position: NativeStagePoint,
    val target: NativeStagePoint,
    val verticalFovDegrees: Double,
    val distanceToTarget: Double,
)

internal data class NativeFrameGeometry(
    val centerX: Double,
    val centerY: Double,
    val drawWidth: Double,
    val drawHeight: Double,
    val rotationDegrees: Double,
    val sourceCoveragePixels: Long,
)

internal data class NativeProductionFrameEvidence(
    val timeSeconds: Double,
    val checksum: String,
    val sourceCoveragePixels: Long,
    val sourceDrawWidth: Double,
    val sourceDrawHeight: Double,
    val pose: NativeProductionPoseSample,
    val camera: NativeProductionCameraSample,
)

internal data class NativeProductionRenderArtifact(
    val actorId: String,
    val shotId: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val output: NativeOutputSpec,
    val temporalEvidence: List<NativeProductionFrameEvidence>,
    val executorKind: String = NATIVE_PRODUCTION_RENDER_EXECUTOR_KIND,
    val renderModel: String = "SOURCE_PIXEL_2D_CUTOUT_CANONICAL_CONTROL",
)

internal sealed interface NativeRendererPreparation {
    data class Ready(val renderer: NativeAndroidFrameRenderer) : NativeRendererPreparation
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeRendererPreparation
}

internal sealed interface NativeTemporalRenderVerification {
    data class Ready(val artifact: NativeProductionRenderArtifact) : NativeTemporalRenderVerification
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeTemporalRenderVerification
}

internal object NativeProductionRendererMath {
    private const val CHARACTER_HEIGHT_METERS = 1.8

    fun validate(snapshot: NativeProductionSnapshot): List<NativeDiagnostic> {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        val blocking = snapshot.blocking
        val rig = snapshot.rig
        val performance = snapshot.performance
        val camera = snapshot.camera
        if (!Regex("^[0-9a-f]{40}$").matches(snapshot.sourceCommit)) {
            diagnostics += NativeDiagnostic("RENDER_SOURCE_IDENTITY", "Production renderer requires the exact 40-character Studio source commit.")
        }
        if (snapshot.stage != NativeProductionStage.READY_FOR_RENDER || blocking == null || rig == null || performance == null || camera == null) {
            diagnostics += NativeDiagnostic("RENDER_STAGE", "Production renderer requires an admitted READY_FOR_RENDER production snapshot.")
            return diagnostics
        }
        if (rig.sourceCommit != snapshot.sourceCommit || performance.sourceCommit != snapshot.sourceCommit || camera.sourceCommit != snapshot.sourceCommit) {
            diagnostics += NativeDiagnostic("RENDER_SOURCE_CONTINUITY", "Production renderer source identity changed between rig, performance and camera stages.")
        }
        if (rig.actorId != blocking.actorId || performance.actorId != blocking.actorId) {
            diagnostics += NativeDiagnostic("RENDER_ACTOR_CONTINUITY", "Production renderer actor identity changed after scene blocking.")
        }
        if (rig.shotId != performance.shotId) {
            diagnostics += NativeDiagnostic("RENDER_SHOT_CONTINUITY", "Production renderer shot identity changed between rig and acting stages.")
        }
        if (snapshot.referenceSha256 != blocking.reference.sha256 || rig.referenceSha256 != blocking.reference.sha256) {
            diagnostics += NativeDiagnostic("RENDER_REFERENCE_CONTINUITY", "Production renderer exact reference SHA-256 changed after scene blocking.")
        }
        if (camera.visibilitySamples.isEmpty() || camera.visibilitySamples.any { !it.visible }) {
            diagnostics += NativeDiagnostic("RENDER_CAMERA_VISIBILITY", "Production renderer requires all admitted camera visibility samples to remain visible.")
        }
        if (blocking.output.width <= 0 || blocking.output.height <= 0 || blocking.output.durationSeconds <= 0.0) {
            diagnostics += NativeDiagnostic("RENDER_OUTPUT_SPEC", "Production renderer requires positive output dimensions and duration.")
        }
        return diagnostics
    }

    fun samplePose(performance: NativeActingPerformance, timeSeconds: Double): NativeProductionPoseSample {
        require(timeSeconds.isFinite()) { "Production pose time must be finite." }
        require(performance.tracks.isNotEmpty()) { "Production performance contains no executable payloads." }
        val samples = performance.tracks.map { sampleTrack(it, timeSeconds) }
        val rootIndex = performance.tracks.indexOfFirst { it.kind == NativePerformanceTrackKind.ROOT }.let { if (it >= 0) it else 0 }
        val root = samples[rootIndex].rootPosition
        return NativeProductionPoseSample(
            timeSeconds = timeSeconds,
            rootPosition = root,
            bodyPitchDegrees = rotationAxis(samples, NativeSemanticBoneRole.CHEST, Axis.X) + rotationAxis(samples, NativeSemanticBoneRole.SPINE, Axis.X) * 0.5,
            bodyLeanDegrees = rotationAxis(samples, NativeSemanticBoneRole.CHEST, Axis.Z) + rotationAxis(samples, NativeSemanticBoneRole.SPINE, Axis.Z) * 0.5,
            headYawDegrees = rotationAxis(samples, NativeSemanticBoneRole.HEAD, Axis.Y) + rotationAxis(samples, NativeSemanticBoneRole.NECK, Axis.Y),
            rightArmSwingDegrees = rotationAxis(samples, NativeSemanticBoneRole.RIGHT_UPPER_ARM, Axis.X) +
                rotationAxis(samples, NativeSemanticBoneRole.RIGHT_LOWER_ARM, Axis.X) * 0.5 +
                rotationAxis(samples, NativeSemanticBoneRole.RIGHT_SHOULDER, Axis.Z) * 0.5,
        )
    }

    fun sampleCamera(camera: NativeCameraExecution, timeSeconds: Double): NativeProductionCameraSample {
        require(timeSeconds.isFinite()) { "Production camera time must be finite." }
        require(camera.keyframes.isNotEmpty()) { "Production camera has no keyframes." }
        val sampled = cameraAt(camera.keyframes, timeSeconds)
        return NativeProductionCameraSample(
            timeSeconds = timeSeconds,
            position = sampled.position,
            target = sampled.target,
            verticalFovDegrees = sampled.verticalFovDegrees,
            distanceToTarget = hypot(
                hypot(sampled.position.x - sampled.target.x, sampled.position.y - sampled.target.y),
                sampled.position.z - sampled.target.z,
            ),
        )
    }

    fun frameGeometry(
        blocking: NativeSceneBlocking,
        pose: NativeProductionPoseSample,
        camera: NativeProductionCameraSample,
    ): NativeFrameGeometry {
        val width = blocking.output.width.toDouble()
        val height = blocking.output.height.toDouble()
        val tangent = tan(Math.toRadians(camera.verticalFovDegrees) / 2.0)
        require(tangent.isFinite() && tangent > 0.0 && camera.distanceToTarget.isFinite() && camera.distanceToTarget > 0.0) {
            "Production camera projection is invalid at the requested frame time."
        }
        val projectedCharacterHeight = CHARACTER_HEIGHT_METERS / (2.0 * camera.distanceToTarget * tangent) * height
        val sourceAspect = blocking.reference.width.toDouble() / blocking.reference.height.toDouble()
        val poseScale = 1.0 + clamp(-pose.bodyPitchDegrees / 600.0 + abs(pose.rightArmSwingDegrees) / 2400.0, -0.04, 0.06)
        val drawHeight = clamp(projectedCharacterHeight * poseScale, height * 0.24, height * 0.88)
        val drawWidth = min(width * 0.9, drawHeight * sourceAspect)
        val centerX = width / 2.0 +
            clamp((pose.rootPosition.x - camera.target.x) * width * 0.08, -width * 0.18, width * 0.18) +
            clamp((pose.headYawDegrees + pose.rightArmSwingDegrees * 0.18) / 420.0 * width, -width * 0.08, width * 0.08)
        val centerY = height * 0.54 +
            clamp((camera.target.y - 0.95) * height * 0.12, -height * 0.08, height * 0.08) +
            clamp(pose.bodyPitchDegrees / 500.0 * height, -height * 0.04, height * 0.04)
        val rotationDegrees = clamp(
            pose.bodyLeanDegrees * 0.8 + pose.headYawDegrees * 0.08 + pose.rightArmSwingDegrees * 0.035,
            -12.0,
            12.0,
        )
        val clippedWidth = max(0.0, min(drawWidth, width))
        val clippedHeight = max(0.0, min(drawHeight, height))
        return NativeFrameGeometry(
            centerX = centerX,
            centerY = centerY,
            drawWidth = drawWidth,
            drawHeight = drawHeight,
            rotationDegrees = rotationDegrees,
            sourceCoveragePixels = max(1L, (clippedWidth * clippedHeight).roundToInt().toLong()),
        )
    }

    private enum class Axis { X, Y, Z }

    private fun rotationAxis(samples: List<NativePerformancePoseKeyframe>, role: NativeSemanticBoneRole, axis: Axis): Double {
        samples.forEach { sample ->
            val value = sample.rotations[role] ?: return@forEach
            return when (axis) {
                Axis.X -> value.x
                Axis.Y -> value.y
                Axis.Z -> value.z
            }
        }
        return 0.0
    }

    private fun sampleTrack(track: NativePerformanceTrack, timeSeconds: Double): NativePerformancePoseKeyframe {
        require(track.keyframes.isNotEmpty()) { "Performance track has no keyframes." }
        val first = track.keyframes.first()
        val last = track.keyframes.last()
        if (timeSeconds <= first.timeSeconds) return first.copy(timeSeconds = timeSeconds)
        if (timeSeconds >= last.timeSeconds) return last.copy(timeSeconds = timeSeconds)
        for (index in 1 until track.keyframes.size) {
            val right = track.keyframes[index]
            val left = track.keyframes[index - 1]
            if (timeSeconds > right.timeSeconds) continue
            val span = right.timeSeconds - left.timeSeconds
            val amount = if (span <= 0.0) 0.0 else (timeSeconds - left.timeSeconds) / span
            val roles = left.rotations.keys + right.rotations.keys
            val rotations = roles.associateWith { role ->
                val from = left.rotations[role] ?: NativeEulerDegrees()
                val to = right.rotations[role] ?: NativeEulerDegrees()
                NativeEulerDegrees(
                    lerp(from.x, to.x, amount),
                    lerp(from.y, to.y, amount),
                    lerp(from.z, to.z, amount),
                )
            }
            return NativePerformancePoseKeyframe(
                timeSeconds,
                lerp(left.rootPosition, right.rootPosition, amount),
                rotations,
            )
        }
        return last.copy(timeSeconds = timeSeconds)
    }

    private fun cameraAt(keyframes: List<NativeCameraKeyframe>, timeSeconds: Double): NativeCameraKeyframe {
        val first = keyframes.first()
        val last = keyframes.last()
        if (timeSeconds <= first.timeSeconds) return first.copy(timeSeconds = timeSeconds)
        if (timeSeconds >= last.timeSeconds) return last.copy(timeSeconds = timeSeconds)
        for (index in 1 until keyframes.size) {
            val right = keyframes[index]
            val left = keyframes[index - 1]
            if (timeSeconds > right.timeSeconds) continue
            val span = right.timeSeconds - left.timeSeconds
            val amount = if (span <= 0.0) 0.0 else (timeSeconds - left.timeSeconds) / span
            return NativeCameraKeyframe(
                timeSeconds = timeSeconds,
                position = lerp(left.position, right.position, amount),
                target = lerp(left.target, right.target, amount),
                verticalFovDegrees = lerp(left.verticalFovDegrees, right.verticalFovDegrees, amount),
            )
        }
        return last.copy(timeSeconds = timeSeconds)
    }

    private fun lerp(left: Double, right: Double, amount: Double): Double = left + (right - left) * amount

    private fun lerp(left: NativeStagePoint, right: NativeStagePoint, amount: Double) = NativeStagePoint(
        lerp(left.x, right.x, amount),
        lerp(left.y, right.y, amount),
        lerp(left.z, right.z, amount),
    )

    private fun clamp(value: Double, min: Double, max: Double): Double = kotlin.math.min(max, kotlin.math.max(min, value))
}

internal class NativeAndroidFrameRenderer private constructor(
    private val snapshot: NativeProductionSnapshot,
    private val sourceBitmap: Bitmap,
) : AutoCloseable {
    val width: Int get() = requireNotNull(snapshot.blocking).output.width
    val height: Int get() = requireNotNull(snapshot.blocking).output.height
    val durationSeconds: Double get() = requireNotNull(snapshot.blocking).output.durationSeconds

    fun renderFrame(target: Bitmap, timeSeconds: Double, captureEvidence: Boolean = false): NativeProductionFrameEvidence? {
        check(!sourceBitmap.isRecycled) { "Production renderer is closed." }
        require(target.width == width && target.height == height) { "Production render target must be ${width}×${height}." }
        require(timeSeconds.isFinite() && timeSeconds in 0.0..durationSeconds) { "Production frame time is outside the admitted shot duration." }
        val blocking = requireNotNull(snapshot.blocking)
        val performance = requireNotNull(snapshot.performance)
        val cameraExecution = requireNotNull(snapshot.camera)
        val pose = NativeProductionRendererMath.samplePose(performance, timeSeconds)
        val camera = NativeProductionRendererMath.sampleCamera(cameraExecution, timeSeconds)
        val geometry = NativeProductionRendererMath.frameGeometry(blocking, pose, camera)

        val canvas = Canvas(target)
        canvas.drawColor(Color.rgb(10, 12, 16))
        val groundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(18, 21, 27) }
        canvas.drawRect(0f, (height * 0.76f), width.toFloat(), height.toFloat(), groundPaint)

        val left = (geometry.centerX - geometry.drawWidth / 2.0).toFloat()
        val top = (geometry.centerY - geometry.drawHeight / 2.0).toFloat()
        val destination = RectF(
            left,
            top,
            (left + geometry.drawWidth).toFloat(),
            (top + geometry.drawHeight).toFloat(),
        )
        val save = canvas.save()
        canvas.rotate(geometry.rotationDegrees.toFloat(), geometry.centerX.toFloat(), geometry.centerY.toFloat())
        canvas.drawBitmap(sourceBitmap, null, destination, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        canvas.restoreToCount(save)

        if (!captureEvidence) return null
        return NativeProductionFrameEvidence(
            timeSeconds = timeSeconds,
            checksum = readbackChecksum(target),
            sourceCoveragePixels = geometry.sourceCoveragePixels,
            sourceDrawWidth = geometry.drawWidth,
            sourceDrawHeight = geometry.drawHeight,
            pose = pose,
            camera = camera,
        )
    }

    fun verifyTemporalMotion(): NativeTemporalRenderVerification {
        val target = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        return try {
            val times = listOf(0.0, durationSeconds * 0.5, durationSeconds * 0.82)
            val evidence = times.map { time -> requireNotNull(renderFrame(target, time, captureEvidence = true)) }
            if (evidence.any { it.sourceCoveragePixels <= 0L }) {
                return NativeTemporalRenderVerification.Rejected(listOf(NativeDiagnostic("RENDER_NO_SOURCE_PIXELS", "Production render evidence contains no source-pixel coverage.")))
            }
            if (evidence.map { it.checksum }.toSet().size < 2) {
                return NativeTemporalRenderVerification.Rejected(listOf(NativeDiagnostic("RENDER_TEMPORAL_IDENTITY", "Production render frames are temporally identical; animated-frame gate failed closed.")))
            }
            val blocking = requireNotNull(snapshot.blocking)
            val rig = requireNotNull(snapshot.rig)
            NativeTemporalRenderVerification.Ready(
                NativeProductionRenderArtifact(
                    actorId = blocking.actorId,
                    shotId = rig.shotId,
                    sourceCommit = snapshot.sourceCommit,
                    referenceSha256 = blocking.reference.sha256,
                    output = blocking.output,
                    temporalEvidence = evidence,
                ),
            )
        } finally {
            target.recycle()
        }
    }

    override fun close() {
        if (!sourceBitmap.isRecycled) sourceBitmap.recycle()
    }

    private fun readbackChecksum(bitmap: Bitmap): String {
        val centerY = (bitmap.height / 2).coerceIn(0, bitmap.height - 1)
        val centerX = (bitmap.width / 2).coerceIn(0, bitmap.width - 1)
        val horizontal = IntArray(bitmap.width)
        val vertical = IntArray(bitmap.height)
        bitmap.getPixels(horizontal, 0, bitmap.width, 0, centerY, bitmap.width, 1)
        bitmap.getPixels(vertical, 0, 1, centerX, 0, 1, bitmap.height)
        var hash = 0x811c9dc5u
        fun feed(pixel: Int) {
            repeat(4) { shift ->
                hash = hash xor ((pixel ushr (shift * 8)) and 0xff).toUInt()
                hash *= 0x01000193u
            }
        }
        horizontal.forEach(::feed)
        vertical.forEach(::feed)
        return hash.toString(16).padStart(8, '0')
    }

    internal companion object {
        fun prepare(snapshot: NativeProductionSnapshot): NativeRendererPreparation {
            val diagnostics = NativeProductionRendererMath.validate(snapshot).toMutableList()
            val reference = snapshot.blocking?.reference
            if (reference == null) {
                diagnostics += NativeDiagnostic("RENDER_REFERENCE_MISSING", "Production renderer requires the exact persisted reference bytes.")
                return NativeRendererPreparation.Rejected(diagnostics)
            }
            if (!reference.localFile.isFile || reference.localFile.length() != reference.sizeBytes) {
                diagnostics += NativeDiagnostic("RENDER_REFERENCE_FILE", "Persisted production reference bytes are missing or changed size.")
            } else {
                val actualSha = sha256(reference.localFile)
                if (!actualSha.equals(reference.sha256, ignoreCase = true)) {
                    diagnostics += NativeDiagnostic("RENDER_REFERENCE_HASH", "Persisted production reference SHA-256 no longer matches the admitted source identity.")
                }
            }
            if (diagnostics.isNotEmpty()) return NativeRendererPreparation.Rejected(diagnostics)

            val bitmap = BitmapFactory.decodeFile(reference.localFile.absolutePath)
                ?: return NativeRendererPreparation.Rejected(listOf(NativeDiagnostic("RENDER_REFERENCE_DECODE", "Production reference image could not be decoded natively.")))
            if (bitmap.width != reference.width || bitmap.height != reference.height) {
                bitmap.recycle()
                return NativeRendererPreparation.Rejected(listOf(NativeDiagnostic("RENDER_REFERENCE_DIMENSIONS", "Production renderer decoded dimensions do not match the admitted reference identity.")))
            }
            return NativeRendererPreparation.Ready(NativeAndroidFrameRenderer(snapshot, bitmap))
        }

        private fun sha256(file: java.io.File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    digest.update(buffer, 0, read)
                }
            }
            return buildString(64) {
                digest.digest().forEach { append(String.format(Locale.ROOT, "%02x", it.toInt() and 0xff)) }
            }
        }
    }
}
