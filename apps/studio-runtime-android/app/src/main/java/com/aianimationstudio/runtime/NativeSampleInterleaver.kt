package com.aianimationstudio.runtime

internal enum class NativeEncodedTrack { VIDEO, AUDIO }

internal data class NativeEncodedSamplePacket(
    val track: NativeEncodedTrack,
    val presentationTimeUs: Long,
    val flags: Int,
    val data: ByteArray,
)

/**
 * Keeps encoded audio/video output locally bounded while enforcing timestamp-ordered mux writes.
 * A lone track is held until the other track has a sample available or has explicitly ended.
 */
internal class NativeSampleInterleaver(
    private val sink: (NativeEncodedSamplePacket) -> Unit,
) {
    private companion object {
        const val MAX_PENDING_PACKETS = 8
    }

    private val video = ArrayDeque<NativeEncodedSamplePacket>()
    private val audio = ArrayDeque<NativeEncodedSamplePacket>()
    private var videoEnded = false
    private var audioEnded = false
    private var lastVideoPtsUs: Long? = null
    private var lastAudioPtsUs: Long? = null

    fun offer(packet: NativeEncodedSamplePacket) {
        require(packet.presentationTimeUs >= 0L) { "Encoded sample timestamp must be non-negative." }
        require(packet.data.isNotEmpty()) { "Encoded sample packet must contain bytes." }
        val previous = when (packet.track) {
            NativeEncodedTrack.VIDEO -> lastVideoPtsUs
            NativeEncodedTrack.AUDIO -> lastAudioPtsUs
        }
        require(previous == null || packet.presentationTimeUs >= previous) {
            "${packet.track.name.lowercase()} encoded sample timestamps must be monotonic."
        }
        when (packet.track) {
            NativeEncodedTrack.VIDEO -> {
                check(!videoEnded) { "Video encoder already ended." }
                lastVideoPtsUs = packet.presentationTimeUs
                video.addLast(packet)
            }
            NativeEncodedTrack.AUDIO -> {
                check(!audioEnded) { "Audio encoder already ended." }
                lastAudioPtsUs = packet.presentationTimeUs
                audio.addLast(packet)
            }
        }
        drain()
        check(pendingPacketCount() <= MAX_PENDING_PACKETS) {
            "Encoded sample interleaver exceeded its bounded $MAX_PENDING_PACKETS-packet window."
        }
    }

    fun end(track: NativeEncodedTrack) {
        when (track) {
            NativeEncodedTrack.VIDEO -> videoEnded = true
            NativeEncodedTrack.AUDIO -> audioEnded = true
        }
        drain()
    }

    fun pendingPacketCount(): Int = video.size + audio.size

    fun isComplete(): Boolean = videoEnded && audioEnded && video.isEmpty() && audio.isEmpty()

    private fun drain() {
        while (true) {
            val nextVideo = video.firstOrNull()
            val nextAudio = audio.firstOrNull()
            val next = when {
                nextVideo != null && nextAudio != null -> {
                    if (nextVideo.presentationTimeUs <= nextAudio.presentationTimeUs) video.removeFirst() else audio.removeFirst()
                }
                nextVideo != null && audioEnded -> video.removeFirst()
                nextAudio != null && videoEnded -> audio.removeFirst()
                else -> null
            } ?: return
            sink(next)
        }
    }
}
