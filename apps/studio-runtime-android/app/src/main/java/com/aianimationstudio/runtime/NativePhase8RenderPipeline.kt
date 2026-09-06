package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.roundToLong
import kotlin.math.sqrt

internal data class NativePhase8FrameBinding(
    val frameIndex: Int,
    val presentationTimeUs: Long,
    val timeSeconds: Double,
    val segment: NativePhase7TimelineSegment,
    val renderJob: NativePhase7RenderJob,
    val resolvedShot: NativePhase6ResolvedShot,
)

internal data class NativePhase8BoundRenderPlan(
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val width: Int,
    val height: Int,
    val frameRate: Double,
    val totalFrames: Int,
    val model: NativeCharacterModel3D,
    val performance: NativeActingPerformance,
    val frames: List<NativePhase8FrameBinding>,
)

internal sealed interface NativePhase8RenderBindingResult {
    data class Ready(val plan: NativePhase8BoundRenderPlan) : NativePhase8RenderBindingResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase8RenderBindingResult
}

/**
 * Phase-8 bridge from the accepted Phase-7 production plan to executable native 3D frame work.
 *
 * This bridge intentionally does not rebuild a legacy NativeProductionSnapshot and never calls the
 * old textual production coordinator. Frame ownership comes from the Phase-7 timeline/render DAG,
 * actor motion comes from the Phase-6 world-bound performance, camera state comes from the Phase-6
 * resolved production shots, and geometry comes from the reusable Phase-3 character asset.
 */
internal object NativePhase8RenderBinder {
    fun bind(plan: NativePhase7ProductionPlan): NativePhase8RenderBindingResult {
        val timeline = plan.timeline
        val diagnostics = mutableListOf<NativeDiagnostic>()

        if (!plan.acceptance.done) diagnostics += NativeDiagnostic("PHASE8_PHASE7_ACCEPTANCE", "Phase 8 requires an accepted Phase-7 production plan.")
        if (!Regex("^[0-9a-f]{40}$").matches(timeline.sourceCommit)) diagnostics += NativeDiagnostic("PHASE8_SOURCE_IDENTITY", "Phase-8 rendering requires the exact 40-character source commit.")
        if (!Regex("^[0-9a-f]{64}$").matches(timeline.referenceSha256) || !Regex("^[0-9a-f]{64}$").matches(timeline.scriptSha256)) {
            diagnostics += NativeDiagnostic("PHASE8_HASH_IDENTITY", "Phase-8 rendering requires exact reference and script SHA-256 identities.")
        }
        if (timeline.width <= 0 || timeline.height <= 0 || !timeline.frameRate.isFinite() || timeline.frameRate <= 0.0 || timeline.totalFrames <= 0) {
            diagnostics += NativeDiagnostic("PHASE8_OUTPUT_SPEC", "Phase-8 rendering requires positive dimensions, frame rate and frame count.")
        }
        if (timeline.sourceCommit != plan.ir.sourceCommit || timeline.referenceSha256 != plan.ir.referenceSha256 || timeline.scriptSha256 != plan.ir.scriptSha256) {
            diagnostics += NativeDiagnostic("PHASE8_TIMELINE_IDENTITY", "Phase-7 timeline identity does not match the accepted Scene IR identity.")
        }
        if (plan.characterAsset.sourceCommit != timeline.sourceCommit || plan.characterAsset.referenceSha256 != timeline.referenceSha256) {
            diagnostics += NativeDiagnostic("PHASE8_CHARACTER_IDENTITY", "Reusable character asset identity does not match the Phase-7 timeline.")
        }
        if (plan.worldBoundPerformance.sourceCommit != timeline.sourceCommit || plan.worldBoundPerformance.actorId != plan.ir.actorId || !plan.worldBoundPerformance.acceptance.done) {
            diagnostics += NativeDiagnostic("PHASE8_WORLD_BOUND_ACTOR", "Phase-8 rendering requires the accepted world-bound actor performance from the same production identity.")
        }
        if (plan.worldBoundPerformance.tracks.isEmpty()) diagnostics += NativeDiagnostic("PHASE8_WORLD_BOUND_TRACKS", "World-bound actor performance has no renderable tracks.")
        diagnostics += NativeCharacterAsset3DValidator.validate(plan.characterAsset)
        if (diagnostics.isNotEmpty()) return NativePhase8RenderBindingResult.Rejected(diagnostics.distinctBy { it.code to it.message })

        val instance = when (val result = NativeCharacterAsset3DFactory.instantiate(plan.characterAsset, plan.worldBoundPerformance.shotId)) {
            is NativeCharacterAssetInstantiation3DResult.Ready -> result.instance
            is NativeCharacterAssetInstantiation3DResult.Rejected -> return NativePhase8RenderBindingResult.Rejected(result.diagnostics)
        }
        val performance = plan.performance.canonical.copy(tracks = plan.worldBoundPerformance.tracks)

        val renderJobs = plan.renderGraph.jobs.filter { it.kind == NativePhase7JobKind.RENDER_SHOT }
        if (renderJobs.size != timeline.segments.size) {
            return NativePhase8RenderBindingResult.Rejected(listOf(NativeDiagnostic("PHASE8_RENDER_JOB_COUNT", "Phase-7 render-job count does not match timeline segments.")))
        }
        val resolvedShots = plan.worldPlan.resolvedShots.associateBy { it.sourceShot.id }
        if (resolvedShots.size != plan.worldPlan.resolvedShots.size) {
            return NativePhase8RenderBindingResult.Rejected(listOf(NativeDiagnostic("PHASE8_SHOT_IDENTITY", "Resolved production shot ids are not unique.")))
        }

        val frames = ArrayList<NativePhase8FrameBinding>(timeline.totalFrames)
        timeline.segments.forEach { segment ->
            val job = renderJobs.singleOrNull {
                it.shotId == segment.shotId &&
                    it.sourceEventId == segment.sourceEventId &&
                    it.startFrame == segment.startFrame &&
                    it.endFrameExclusive == segment.endFrameExclusive &&
                    it.sourceCommit == timeline.sourceCommit &&
                    it.referenceSha256 == timeline.referenceSha256 &&
                    it.scriptSha256 == timeline.scriptSha256
            } ?: return NativePhase8RenderBindingResult.Rejected(
                listOf(NativeDiagnostic("PHASE8_RENDER_JOB_BINDING", "Timeline segment ${segment.shotId} does not have exactly one identity-matched Phase-7 render job.")),
            )
            val shot = resolvedShots[segment.shotId] ?: return NativePhase8RenderBindingResult.Rejected(
                listOf(NativeDiagnostic("PHASE8_CAMERA_BINDING", "Timeline segment ${segment.shotId} has no resolved production camera shot.")),
            )
            for (frameIndex in segment.startFrame until segment.endFrameExclusive) {
                val ptsUs = (frameIndex.toDouble() * 1_000_000.0 / timeline.frameRate).roundToLong()
                frames += NativePhase8FrameBinding(
                    frameIndex = frameIndex,
                    presentationTimeUs = ptsUs,
                    timeSeconds = ptsUs / 1_000_000.0,
                    segment = segment,
                    renderJob = job,
                    resolvedShot = shot,
                )
            }
        }

        if (frames.size != timeline.totalFrames || frames.indices.any { frames[it].frameIndex != it }) {
            return NativePhase8RenderBindingResult.Rejected(listOf(NativeDiagnostic("PHASE8_FRAME_CONTIGUITY", "Phase-8 frame binding contains a gap, overlap or wrong total frame count.")))
        }
        if (frames.zipWithNext().any { (left, right) -> right.presentationTimeUs <= left.presentationTimeUs }) {
            return NativePhase8RenderBindingResult.Rejected(listOf(NativeDiagnostic("PHASE8_FRAME_TIMING", "Phase-8 frame presentation timestamps are not strictly monotonic.")))
        }

        return NativePhase8RenderBindingResult.Ready(
            NativePhase8BoundRenderPlan(
                sourceCommit = timeline.sourceCommit,
                referenceSha256 = timeline.referenceSha256,
                scriptSha256 = timeline.scriptSha256,
                width = timeline.width,
                height = timeline.height,
                frameRate = timeline.frameRate,
                totalFrames = timeline.totalFrames,
                model = instance.model,
                performance = performance,
                frames = frames,
            ),
        )
    }

    fun sampleCamera(frame: NativePhase8FrameBinding): NativeProductionCameraSample {
        val start = frame.resolvedShot.startPose
        val end = frame.resolvedShot.endPose
        val span = end.timeSeconds - start.timeSeconds
        val amount = if (span <= 1e-9) 0.0 else ((frame.timeSeconds - start.timeSeconds) / span).coerceIn(0.0, 1.0)
        val position = lerp(start.position, end.position, amount)
        val target = lerp(start.target, end.target, amount)
        val fov = start.verticalFovDegrees + (end.verticalFovDegrees - start.verticalFovDegrees) * amount
        val dx = position.x - target.x
        val dy = position.y - target.y
        val dz = position.z - target.z
        return NativeProductionCameraSample(
            timeSeconds = frame.timeSeconds,
            position = position,
            target = target,
            verticalFovDegrees = fov,
            distanceToTarget = sqrt(dx * dx + dy * dy + dz * dz),
        )
    }

    private fun lerp(left: NativeStagePoint, right: NativeStagePoint, amount: Double) = NativeStagePoint(
        left.x + (right.x - left.x) * amount,
        left.y + (right.y - left.y) * amount,
        left.z + (right.z - left.z) * amount,
    )
}

internal sealed interface NativePhase8RendererPreparation {
    data class Ready(val renderer: NativePhase8FrameRenderer) : NativePhase8RendererPreparation
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase8RendererPreparation
}

internal data class NativePhase8RenderedFrameEvidence(
    val frameIndex: Int,
    val presentationTimeUs: Long,
    val shotId: String,
    val renderJobId: String,
    val visibleTriangles: Int,
    val coveragePixels: Long,
)

internal class NativePhase8FrameRenderer private constructor(
    private val bound: NativePhase8BoundRenderPlan,
    private val sourceBitmap: Bitmap,
    private val palette: NativeReferencePalette3D,
) : AutoCloseable {
    val width: Int get() = bound.width
    val height: Int get() = bound.height
    val frameCount: Int get() = bound.totalFrames

    fun renderFrame(target: Bitmap, frameIndex: Int): NativePhase8RenderedFrameEvidence {
        check(!sourceBitmap.isRecycled) { "Phase-8 renderer is closed." }
        require(target.width == width && target.height == height) { "Phase-8 render target must be ${width}x${height}." }
        val frame = bound.frames.getOrNull(frameIndex) ?: throw IllegalArgumentException("Phase-8 frame index is outside the accepted timeline.")
        val camera = NativePhase8RenderBinder.sampleCamera(frame)
        val geometry = NativeSkinnedMeshRenderer3D.render(
            target = target,
            model = bound.model,
            performance = bound.performance,
            camera = camera,
            palette = palette,
            timeSeconds = frame.timeSeconds,
        )
        check(geometry.visibleTriangles > 0 && geometry.coveragePixels > 0L) { "Phase-8 native 3D renderer produced no visible mesh for frame $frameIndex." }
        return NativePhase8RenderedFrameEvidence(
            frameIndex = frameIndex,
            presentationTimeUs = frame.presentationTimeUs,
            shotId = frame.segment.shotId,
            renderJobId = frame.renderJob.id,
            visibleTriangles = geometry.visibleTriangles,
            coveragePixels = geometry.coveragePixels,
        )
    }

    override fun close() {
        if (!sourceBitmap.isRecycled) sourceBitmap.recycle()
    }

    internal companion object {
        fun prepare(plan: NativePhase7ProductionPlan, reference: PersistedReferenceAsset): NativePhase8RendererPreparation {
            val bound = when (val result = NativePhase8RenderBinder.bind(plan)) {
                is NativePhase8RenderBindingResult.Ready -> result.plan
                is NativePhase8RenderBindingResult.Rejected -> return NativePhase8RendererPreparation.Rejected(result.diagnostics)
            }
            val diagnostics = mutableListOf<NativeDiagnostic>()
            if (reference.sha256 != bound.referenceSha256) diagnostics += NativeDiagnostic("PHASE8_REFERENCE_IDENTITY", "Persisted reference does not match the accepted Phase-7 reference identity.")
            if (!reference.localFile.isFile || reference.localFile.length() != reference.sizeBytes) {
                diagnostics += NativeDiagnostic("PHASE8_REFERENCE_FILE", "Persisted Phase-8 reference bytes are missing or changed size.")
            } else if (!sha256(reference).equals(bound.referenceSha256, ignoreCase = false)) {
                diagnostics += NativeDiagnostic("PHASE8_REFERENCE_HASH", "Persisted Phase-8 reference bytes do not match the accepted SHA-256 identity.")
            }
            if (diagnostics.isNotEmpty()) return NativePhase8RendererPreparation.Rejected(diagnostics)

            val bitmap = BitmapFactory.decodeFile(reference.localFile.absolutePath)
                ?: return NativePhase8RendererPreparation.Rejected(listOf(NativeDiagnostic("PHASE8_REFERENCE_DECODE", "Persisted Phase-8 reference image could not be decoded natively.")))
            if (bitmap.width != reference.width || bitmap.height != reference.height) {
                bitmap.recycle()
                return NativePhase8RendererPreparation.Rejected(listOf(NativeDiagnostic("PHASE8_REFERENCE_DIMENSIONS", "Decoded reference dimensions do not match the admitted reference identity.")))
            }
            return NativePhase8RendererPreparation.Ready(
                NativePhase8FrameRenderer(bound, bitmap, NativeReferencePalette3D.fromBitmap(bitmap)),
            )
        }

        private fun sha256(reference: PersistedReferenceAsset): String {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(reference.localFile).use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read > 0) digest.update(buffer, 0, read)
                }
            }
            return buildString(64) {
                digest.digest().forEach { append(String.format(Locale.ROOT, "%02x", it.toInt() and 0xff)) }
            }
        }
    }
}
