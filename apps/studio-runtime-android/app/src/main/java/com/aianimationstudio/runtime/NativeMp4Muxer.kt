package com.aianimationstudio.runtime

import android.media.MediaCodec
import android.media.MediaFormat
import androidx.media3.common.util.MediaFormatUtil
import androidx.media3.common.util.UnstableApi
import androidx.media3.muxer.Mp4Muxer
import androidx.media3.muxer.MuxerUtil
import androidx.media3.muxer.SeekableMuxerOutput
import java.io.File
import java.nio.ByteBuffer

internal const val NATIVE_MP4_VIDEO_MIME = "video/avc"
internal const val NATIVE_MP4_AUDIO_MIME = "audio/opus"

internal object NativeMp4Contract {
    fun validateTrackMimes(videoMime: String?, audioMime: String?): List<NativeDiagnostic> = buildList {
        if (videoMime != NATIVE_MP4_VIDEO_MIME) {
            add(NativeDiagnostic("MP4_VIDEO_CODEC", "Native MP4 export requires H.264/AVC (video/avc), received ${videoMime ?: "missing"}."))
        }
        if (audioMime != NATIVE_MP4_AUDIO_MIME) {
            add(NativeDiagnostic("MP4_AUDIO_CODEC", "Native MP4 export requires Opus (audio/opus), received ${audioMime ?: "missing"}."))
        }
    }

    fun validatePresentationTime(previousUs: Long?, nextUs: Long, track: String): NativeDiagnostic? {
        if (nextUs < 0L) return NativeDiagnostic("MP4_NEGATIVE_PTS", "$track sample timestamp must be non-negative.")
        if (previousUs != null && nextUs < previousUs) {
            return NativeDiagnostic("MP4_NON_MONOTONIC_PTS", "$track sample timestamps must be monotonic: $nextUs < $previousUs.")
        }
        return null
    }
}

/**
 * Thin strict boundary around Media3's in-app MP4 muxer.
 *
 * Encoders own codec choice and sample production. This class refuses any format other than
 * H.264/AVC video plus Opus audio, normalizes MediaCodec buffer offsets into sample slices and
 * enforces per-track monotonic presentation timestamps before writing the MP4 container.
 */
@UnstableApi
internal class NativeMp4Muxer(outputFile: File) : AutoCloseable {
    private val muxer = Mp4Muxer.Builder(SeekableMuxerOutput.of(outputFile.absolutePath)).build()
    private var videoTrackId: Int? = null
    private var audioTrackId: Int? = null
    private var lastVideoPtsUs: Long? = null
    private var lastAudioPtsUs: Long? = null
    private var closed = false

    fun addVideoTrack(mediaFormat: MediaFormat): Int {
        check(!closed) { "Native MP4 muxer is closed." }
        check(videoTrackId == null) { "Native MP4 muxer already has a video track." }
        val mime = mediaFormat.getString(MediaFormat.KEY_MIME)
        val diagnostics = NativeMp4Contract.validateTrackMimes(mime, NATIVE_MP4_AUDIO_MIME)
        check(diagnostics.none { it.code == "MP4_VIDEO_CODEC" }) { diagnostics.first { it.code == "MP4_VIDEO_CODEC" }.message }
        val trackId = muxer.addTrack(MediaFormatUtil.createFormatFromMediaFormat(mediaFormat))
        videoTrackId = trackId
        return trackId
    }

    fun addAudioTrack(mediaFormat: MediaFormat): Int {
        check(!closed) { "Native MP4 muxer is closed." }
        check(audioTrackId == null) { "Native MP4 muxer already has an audio track." }
        val mime = mediaFormat.getString(MediaFormat.KEY_MIME)
        val diagnostics = NativeMp4Contract.validateTrackMimes(NATIVE_MP4_VIDEO_MIME, mime)
        check(diagnostics.none { it.code == "MP4_AUDIO_CODEC" }) { diagnostics.first { it.code == "MP4_AUDIO_CODEC" }.message }
        val trackId = muxer.addTrack(MediaFormatUtil.createFormatFromMediaFormat(mediaFormat))
        audioTrackId = trackId
        return trackId
    }

    fun writeVideoSample(buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        val trackId = checkNotNull(videoTrackId) { "Native MP4 video track has not been added." }
        if (skipCodecOnlyBuffer(info)) return
        NativeMp4Contract.validatePresentationTime(lastVideoPtsUs, info.presentationTimeUs, "video")?.let { error(it.message) }
        muxer.writeSampleData(trackId, sampleSlice(buffer, info), MuxerUtil.getMuxerBufferInfoFromMediaCodecBufferInfo(info))
        lastVideoPtsUs = info.presentationTimeUs
    }

    fun writeAudioSample(buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
        val trackId = checkNotNull(audioTrackId) { "Native MP4 audio track has not been added." }
        if (skipCodecOnlyBuffer(info)) return
        NativeMp4Contract.validatePresentationTime(lastAudioPtsUs, info.presentationTimeUs, "audio")?.let { error(it.message) }
        muxer.writeSampleData(trackId, sampleSlice(buffer, info), MuxerUtil.getMuxerBufferInfoFromMediaCodecBufferInfo(info))
        lastAudioPtsUs = info.presentationTimeUs
    }

    fun hasBothProductionTracks(): Boolean = videoTrackId != null && audioTrackId != null

    override fun close() {
        if (closed) return
        closed = true
        muxer.close()
    }

    private fun skipCodecOnlyBuffer(info: MediaCodec.BufferInfo): Boolean =
        info.size <= 0 || (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0

    private fun sampleSlice(buffer: ByteBuffer, info: MediaCodec.BufferInfo): ByteBuffer {
        require(info.offset >= 0 && info.size >= 0 && info.offset + info.size <= buffer.capacity()) {
            "Encoded sample range is outside the codec output buffer."
        }
        return buffer.duplicate().apply {
            position(info.offset)
            limit(info.offset + info.size)
        }.slice()
    }
}
