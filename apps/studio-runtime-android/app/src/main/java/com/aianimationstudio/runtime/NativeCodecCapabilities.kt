package com.aianimationstudio.runtime

import android.media.AudioFormat
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.roundToLong

internal const val NATIVE_OPUS_SAMPLE_RATE = 48_000
internal const val NATIVE_OPUS_CHANNELS = 1
internal const val NATIVE_OPUS_CHUNK_FRAMES = 960
internal const val NATIVE_OPUS_BITRATE = 96_000

internal data class NativeCodecPlan(
    val width: Int,
    val height: Int,
    val frameRate: Double,
    val durationSeconds: Double,
    val frameCount: Int,
    val videoBitrate: Int,
    val audioSampleRate: Int = NATIVE_OPUS_SAMPLE_RATE,
    val audioChannels: Int = NATIVE_OPUS_CHANNELS,
    val audioChunkFrames: Int = NATIVE_OPUS_CHUNK_FRAMES,
    val audioBitrate: Int = NATIVE_OPUS_BITRATE,
    val totalAudioFrames: Long,
)

internal data class NativeCodecSelection(
    val plan: NativeCodecPlan,
    val videoEncoderName: String,
    val audioEncoderName: String,
    val videoFormat: MediaFormat,
    val audioFormat: MediaFormat,
)

internal sealed interface NativeCodecCapabilityResult {
    data class Ready(val selection: NativeCodecSelection) : NativeCodecCapabilityResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCodecCapabilityResult
}

internal object NativeCodecPlanFactory {
    fun fromOutput(output: NativeOutputSpec): NativeCodecPlan {
        require(output.width > 0 && output.height > 0) { "Codec plan requires positive output dimensions." }
        require(output.frameRate.isFinite() && output.frameRate > 0.0) { "Codec plan requires a positive finite frame rate." }
        require(output.durationSeconds.isFinite() && output.durationSeconds > 0.0) { "Codec plan requires a positive finite duration." }
        val frameCount = max(1, (output.durationSeconds * output.frameRate).roundToInt())
        val videoBitrate = videoBitrate(output.width, output.height, output.frameRate)
        val totalAudioFrames = max(1L, (output.durationSeconds * NATIVE_OPUS_SAMPLE_RATE).roundToInt().toLong())
        return NativeCodecPlan(
            width = output.width,
            height = output.height,
            frameRate = output.frameRate,
            durationSeconds = output.durationSeconds,
            frameCount = frameCount,
            videoBitrate = videoBitrate,
            totalAudioFrames = totalAudioFrames,
        )
    }

    fun fromPhase8(bound: NativePhase8BoundRenderPlan): NativeCodecPlan {
        require(bound.width > 0 && bound.height > 0) { "Phase-8 codec plan requires positive output dimensions." }
        require(bound.frameRate.isFinite() && bound.frameRate > 0.0) { "Phase-8 codec plan requires a positive finite frame rate." }
        require(bound.totalFrames > 0 && bound.frames.size == bound.totalFrames) { "Phase-8 codec plan requires the exact bound frame count." }
        require(bound.frames.indices.all { bound.frames[it].frameIndex == it }) { "Phase-8 codec plan requires contiguous frame indices." }

        val durationSeconds = bound.totalFrames.toDouble() / bound.frameRate
        require(durationSeconds.isFinite() && durationSeconds > 0.0) { "Phase-8 codec duration is invalid." }
        bound.frames.forEach { frame ->
            val expectedPtsUs = (frame.frameIndex.toDouble() * 1_000_000.0 / bound.frameRate).roundToLong()
            require(frame.presentationTimeUs == expectedPtsUs) {
                "Phase-8 codec plan timestamp drift at frame ${frame.frameIndex}: ${frame.presentationTimeUs} != $expectedPtsUs."
            }
        }
        return NativeCodecPlan(
            width = bound.width,
            height = bound.height,
            frameRate = bound.frameRate,
            durationSeconds = durationSeconds,
            frameCount = bound.totalFrames,
            videoBitrate = videoBitrate(bound.width, bound.height, bound.frameRate),
            totalAudioFrames = max(1L, (durationSeconds * NATIVE_OPUS_SAMPLE_RATE).roundToLong()),
        )
    }

    fun audioChunkCount(plan: NativeCodecPlan): Int =
        ceil(plan.totalAudioFrames.toDouble() / plan.audioChunkFrames.toDouble()).toInt()

    fun estimatedOutputBytes(plan: NativeCodecPlan): Long = max(
        1_048_576L,
        ceil((plan.videoBitrate.toLong() + plan.audioBitrate) * plan.durationSeconds / 8.0 * 1.2).toLong(),
    )

    private fun videoBitrate(width: Int, height: Int, frameRate: Double): Int =
        (width.toDouble() * height * frameRate * 0.08)
            .coerceIn(500_000.0, 12_000_000.0)
            .roundToInt()
}

/** Strict device preflight for the production H.264 + Opus MP4 contract. */
internal object NativeCodecCapabilities {
    fun probe(snapshot: NativeProductionSnapshot): NativeCodecCapabilityResult {
        val blocking = snapshot.blocking
        if (snapshot.stage != NativeProductionStage.READY_FOR_RENDER || blocking == null) {
            return NativeCodecCapabilityResult.Rejected(
                listOf(NativeDiagnostic("CODEC_STAGE", "Native codec preflight requires an admitted READY_FOR_RENDER production snapshot.")),
            )
        }
        val renderDiagnostics = NativeProductionRendererMath.validate(snapshot)
        if (renderDiagnostics.isNotEmpty()) return NativeCodecCapabilityResult.Rejected(renderDiagnostics)
        return probe(NativeCodecPlanFactory.fromOutput(blocking.output))
    }

    fun probe(plan: NativeCodecPlan): NativeCodecCapabilityResult {
        val diagnostics = validatePlan(plan)
        if (diagnostics.isNotEmpty()) return NativeCodecCapabilityResult.Rejected(diagnostics)

        val videoFormat = MediaFormat.createVideoFormat(NATIVE_MP4_VIDEO_MIME, plan.width, plan.height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, plan.videoBitrate)
            setFloat(MediaFormat.KEY_FRAME_RATE, plan.frameRate.toFloat())
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
        }
        val audioFormat = MediaFormat.createAudioFormat(NATIVE_MP4_AUDIO_MIME, plan.audioSampleRate, plan.audioChannels).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, plan.audioBitrate)
            setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, plan.audioChunkFrames * plan.audioChannels * 2)
        }

        val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        val videoName = codecs.findEncoderForFormat(videoFormat)
        val audioName = codecs.findEncoderForFormat(audioFormat)
        val unavailable = buildList {
            if (videoName == null) add(
                NativeDiagnostic(
                    "CODEC_H264_UNAVAILABLE",
                    "This Android device has no hardware/software encoder matching the exact ${plan.width}×${plan.height} @ ${plan.frameRate} fps H.264 surface-input profile.",
                ),
            )
            if (audioName == null) add(
                NativeDiagnostic(
                    "CODEC_OPUS_UNAVAILABLE",
                    "This Android device has no 48 kHz mono Opus encoder; production export fails closed and does not fall back to AAC.",
                ),
            )
        }
        if (unavailable.isNotEmpty() || videoName == null || audioName == null) {
            return NativeCodecCapabilityResult.Rejected(unavailable)
        }
        return NativeCodecCapabilityResult.Ready(
            NativeCodecSelection(plan, videoName, audioName, videoFormat, audioFormat),
        )
    }

    private fun validatePlan(plan: NativeCodecPlan): List<NativeDiagnostic> = buildList {
        if (plan.width <= 0 || plan.height <= 0) {
            add(NativeDiagnostic("CODEC_OUTPUT_SIZE", "Native codec plan requires positive dimensions."))
        }
        if (!plan.frameRate.isFinite() || plan.frameRate <= 0.0 || !plan.durationSeconds.isFinite() || plan.durationSeconds <= 0.0) {
            add(NativeDiagnostic("CODEC_OUTPUT_TIMING", "Native codec plan requires positive finite frame rate and duration."))
        }
        if (plan.frameCount <= 0 || plan.totalAudioFrames <= 0L) {
            add(NativeDiagnostic("CODEC_MEDIA_COUNT", "Native codec plan requires positive video and audio frame counts."))
        }
        if (plan.videoBitrate <= 0 || plan.audioBitrate <= 0 || plan.audioSampleRate <= 0 || plan.audioChannels <= 0 || plan.audioChunkFrames <= 0) {
            add(NativeDiagnostic("CODEC_MEDIA_FORMAT", "Native codec plan contains an invalid bitrate or audio format."))
        }
    }
}
