package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMp4ContractTest {
    @Test
    fun `accepts only H264 plus Opus for production MP4`() {
        assertTrue(NativeMp4Contract.validateTrackMimes("video/avc", "audio/opus").isEmpty())

        val wrongVideo = NativeMp4Contract.validateTrackMimes("video/hevc", "audio/opus")
        assertEquals(listOf("MP4_VIDEO_CODEC"), wrongVideo.map { it.code })

        val wrongAudio = NativeMp4Contract.validateTrackMimes("video/avc", "audio/mp4a-latm")
        assertEquals(listOf("MP4_AUDIO_CODEC"), wrongAudio.map { it.code })
    }

    @Test
    fun `requires monotonic non-negative timestamps per track`() {
        assertNull(NativeMp4Contract.validatePresentationTime(null, 0L, "video"))
        assertNull(NativeMp4Contract.validatePresentationTime(10_000L, 10_000L, "video"))
        assertNull(NativeMp4Contract.validatePresentationTime(10_000L, 20_000L, "video"))

        assertEquals(
            "MP4_NEGATIVE_PTS",
            NativeMp4Contract.validatePresentationTime(null, -1L, "audio")?.code,
        )
        assertEquals(
            "MP4_NON_MONOTONIC_PTS",
            NativeMp4Contract.validatePresentationTime(20_000L, 19_999L, "audio")?.code,
        )
    }
}
