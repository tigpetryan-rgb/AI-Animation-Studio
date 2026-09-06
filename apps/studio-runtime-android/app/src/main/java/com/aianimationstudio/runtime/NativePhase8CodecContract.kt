package com.aianimationstudio.runtime

internal data class NativePhase8CodecFrameInput(
    val frameIndex: Int,
    val presentationTimeUs: Long,
    val shotId: String,
    val renderJobId: String,
)

internal data class NativePhase8CodecInputPlan(
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val codecPlan: NativeCodecPlan,
    val frames: List<NativePhase8CodecFrameInput>,
)

internal sealed interface NativePhase8CodecContractResult {
    data class Ready(val input: NativePhase8CodecInputPlan) : NativePhase8CodecContractResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase8CodecContractResult
}

/**
 * Immutable Phase-8 boundary between accepted indexed 3D frame work and Android codec submission.
 * It preserves the Phase-7 source/reference/script identities and refuses any frame-count or PTS
 * drift before a MediaCodec session is allowed to start.
 */
internal object NativePhase8CodecContract {
    fun build(bound: NativePhase8BoundRenderPlan): NativePhase8CodecContractResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (!Regex("^[0-9a-f]{40}$").matches(bound.sourceCommit)) {
            diagnostics += NativeDiagnostic("PHASE8_CODEC_SOURCE_IDENTITY", "Phase-8 codec input requires the exact 40-character source commit.")
        }
        if (!Regex("^[0-9a-f]{64}$").matches(bound.referenceSha256) || !Regex("^[0-9a-f]{64}$").matches(bound.scriptSha256)) {
            diagnostics += NativeDiagnostic("PHASE8_CODEC_HASH_IDENTITY", "Phase-8 codec input requires exact reference and script SHA-256 identities.")
        }
        if (bound.totalFrames <= 0 || bound.frames.size != bound.totalFrames) {
            diagnostics += NativeDiagnostic("PHASE8_CODEC_FRAME_COUNT", "Phase-8 codec input frame count does not match the accepted render plan.")
        }
        if (bound.frames.indices.any { bound.frames[it].frameIndex != it }) {
            diagnostics += NativeDiagnostic("PHASE8_CODEC_FRAME_ORDER", "Phase-8 codec input contains a frame gap, overlap or reorder.")
        }
        if (diagnostics.isNotEmpty()) return NativePhase8CodecContractResult.Rejected(diagnostics)

        val codecPlan = runCatching { NativeCodecPlanFactory.fromPhase8(bound) }.getOrElse { failure ->
            return NativePhase8CodecContractResult.Rejected(
                listOf(NativeDiagnostic("PHASE8_CODEC_PLAN", failure.message ?: "Phase-8 exact codec plan could not be created.")),
            )
        }

        val frames = ArrayList<NativePhase8CodecFrameInput>(bound.totalFrames)
        bound.frames.forEach { frame ->
            val expectedPtsUs = NativeEncoderTiming.videoPresentationTimeUs(codecPlan, frame.frameIndex)
            if (frame.presentationTimeUs != expectedPtsUs) {
                return NativePhase8CodecContractResult.Rejected(
                    listOf(
                        NativeDiagnostic(
                            "PHASE8_CODEC_PTS_DRIFT",
                            "Frame ${frame.frameIndex} changed presentation time before H.264 submission: ${frame.presentationTimeUs} != $expectedPtsUs.",
                        ),
                    ),
                )
            }
            if (frame.renderJob.kind != NativePhase7JobKind.RENDER_SHOT || frame.renderJob.shotId != frame.segment.shotId) {
                return NativePhase8CodecContractResult.Rejected(
                    listOf(NativeDiagnostic("PHASE8_CODEC_RENDER_JOB", "Frame ${frame.frameIndex} lost its Phase-7 render-job ownership.")),
                )
            }
            frames += NativePhase8CodecFrameInput(
                frameIndex = frame.frameIndex,
                presentationTimeUs = frame.presentationTimeUs,
                shotId = frame.segment.shotId,
                renderJobId = frame.renderJob.id,
            )
        }
        if (frames.zipWithNext().any { (left, right) -> right.presentationTimeUs <= left.presentationTimeUs }) {
            return NativePhase8CodecContractResult.Rejected(
                listOf(NativeDiagnostic("PHASE8_CODEC_PTS_ORDER", "Phase-8 H.264 frame timestamps must be strictly increasing.")),
            )
        }

        return NativePhase8CodecContractResult.Ready(
            NativePhase8CodecInputPlan(
                sourceCommit = bound.sourceCommit,
                referenceSha256 = bound.referenceSha256,
                scriptSha256 = bound.scriptSha256,
                codecPlan = codecPlan,
                frames = frames,
            ),
        )
    }
}
