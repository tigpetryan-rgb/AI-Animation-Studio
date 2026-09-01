package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeEncoderTimingTest {
    private val plan = NativeCodecPlanFactory.fromOutput(
        NativeOutputSpec(
            width = 320,
            height = 240,
            frameRate = 12.0,
            durationSeconds = 2.0,
        ),
    )

    @Test
    fun `video timestamps come from absolute frame index`() {
        assertEquals(0L, NativeEncoderTiming.videoPresentationTimeUs(plan, 0))
        assertEquals(83_333L, NativeEncoderTiming.videoPresentationTimeUs(plan, 1))
        assertEquals(1_916_667L, NativeEncoderTiming.videoPresentationTimeUs(plan, 23))
    }

    @Test
    fun `audio timestamps and chunks come from absolute pcm frame index`() {
        assertEquals(0L, NativeEncoderTiming.audioPresentationTimeUs(0L, 48_000))
        assertEquals(20_000L, NativeEncoderTiming.audioPresentationTimeUs(960L, 48_000))
        assertEquals(
            960,
            NativeEncoderTiming.audioFramesForNextInput(
                totalFrames = 2_000L,
                queuedFrames = 0L,
                preferredChunkFrames = 960,
                inputCapacityBytes = 1_920,
                channels = 1,
            ),
        )
        assertEquals(
            80,
            NativeEncoderTiming.audioFramesForNextInput(
                totalFrames = 2_000L,
                queuedFrames = 1_920L,
                preferredChunkFrames = 960,
                inputCapacityBytes = 1_920,
                channels = 1,
            ),
        )
    }

    @Test
    fun `audio chunk respects actual codec input capacity`() {
        assertEquals(
            480,
            NativeEncoderTiming.audioFramesForNextInput(
                totalFrames = 2_000L,
                queuedFrames = 0L,
                preferredChunkFrames = 960,
                inputCapacityBytes = 960,
                channels = 1,
            ),
        )
    }
}
