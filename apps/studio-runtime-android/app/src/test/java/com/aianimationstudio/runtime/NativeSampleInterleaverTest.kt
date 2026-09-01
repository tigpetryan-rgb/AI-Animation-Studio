package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSampleInterleaverTest {
    private fun packet(track: NativeEncodedTrack, pts: Long) = NativeEncodedSamplePacket(
        track = track,
        presentationTimeUs = pts,
        flags = 0,
        data = byteArrayOf((pts and 0xff).toByte()),
    )

    @Test
    fun `holds a lone track and emits samples in timestamp order`() {
        val written = mutableListOf<NativeEncodedSamplePacket>()
        val interleaver = NativeSampleInterleaver(written::add)

        interleaver.offer(packet(NativeEncodedTrack.VIDEO, 0))
        assertEquals(1, interleaver.pendingPacketCount())
        assertTrue(written.isEmpty())

        interleaver.offer(packet(NativeEncodedTrack.AUDIO, 0))
        assertEquals(listOf(NativeEncodedTrack.VIDEO), written.map { it.track })

        interleaver.offer(packet(NativeEncodedTrack.AUDIO, 20_000))
        assertEquals(listOf(0L), written.map { it.presentationTimeUs })
        assertEquals(2, interleaver.pendingPacketCount())

        interleaver.offer(packet(NativeEncodedTrack.VIDEO, 41_667))
        assertEquals(listOf(0L, 0L, 20_000L), written.map { it.presentationTimeUs })

        interleaver.end(NativeEncodedTrack.AUDIO)
        assertEquals(listOf(0L, 0L, 20_000L, 41_667L), written.map { it.presentationTimeUs })
        interleaver.end(NativeEncodedTrack.VIDEO)
        assertTrue(interleaver.isComplete())
    }

    @Test
    fun `exposes bounded backpressure until lagging encoder produces a packet`() {
        val written = mutableListOf<NativeEncodedSamplePacket>()
        val interleaver = NativeSampleInterleaver(written::add)

        repeat(8) { index ->
            assertTrue(interleaver.canAccept(NativeEncodedTrack.VIDEO))
            interleaver.offer(packet(NativeEncodedTrack.VIDEO, index * 83_333L))
        }

        assertEquals(8, interleaver.pendingPacketCount())
        assertFalse(interleaver.canAccept(NativeEncodedTrack.VIDEO))
        assertTrue(interleaver.canAccept(NativeEncodedTrack.AUDIO))

        interleaver.offer(packet(NativeEncodedTrack.AUDIO, 0L))

        assertTrue(written.isNotEmpty())
        assertTrue(interleaver.pendingPacketCount() < 8)
        assertTrue(interleaver.canAccept(NativeEncodedTrack.VIDEO))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects backwards timestamps within a track`() {
        val interleaver = NativeSampleInterleaver { }
        interleaver.offer(packet(NativeEncodedTrack.VIDEO, 10))
        interleaver.offer(packet(NativeEncodedTrack.VIDEO, 9))
    }

    @Test(expected = IllegalStateException::class)
    fun `fails closed if a caller ignores the bounded interleave capacity`() {
        val interleaver = NativeSampleInterleaver { }
        repeat(9) { index ->
            interleaver.offer(packet(NativeEncodedTrack.VIDEO, index.toLong()))
        }
    }
}
