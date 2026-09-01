package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCodecPlanTest {
    @Test
    fun `matches production frame audio and bitrate contract`() {
        val plan = NativeCodecPlanFactory.fromOutput(
            NativeOutputSpec(width = 320, height = 240, frameRate = 12.0, durationSeconds = 2.0),
        )

        assertEquals(24, plan.frameCount)
        assertEquals(500_000, plan.videoBitrate)
        assertEquals(48_000, plan.audioSampleRate)
        assertEquals(1, plan.audioChannels)
        assertEquals(960, plan.audioChunkFrames)
        assertEquals(96_000, plan.audioBitrate)
        assertEquals(96_000L, plan.totalAudioFrames)
        assertEquals(100, NativeCodecPlanFactory.audioChunkCount(plan))
        assertTrue(NativeCodecPlanFactory.estimatedOutputBytes(plan) >= 1_048_576L)
    }

    @Test
    fun `caps high resolution video bitrate at the production ceiling`() {
        val plan = NativeCodecPlanFactory.fromOutput(
            NativeOutputSpec(width = 8192, height = 8192, frameRate = 120.0, durationSeconds = 0.1),
        )
        assertEquals(12_000_000, plan.videoBitrate)
        assertEquals(12, plan.frameCount)
        assertEquals(4_800L, plan.totalAudioFrames)
        assertEquals(5, NativeCodecPlanFactory.audioChunkCount(plan))
    }
}
