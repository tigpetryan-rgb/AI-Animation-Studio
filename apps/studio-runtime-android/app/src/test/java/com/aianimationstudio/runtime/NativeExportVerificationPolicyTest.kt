package com.aianimationstudio.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeExportVerificationPolicyTest {
    @Test
    fun `duration tolerance preserves production contract minimum`() {
        assertTrue(NativeExportVerificationPolicy.durationMatches(2_000L, 800L))
        assertTrue(NativeExportVerificationPolicy.durationMatches(2_000L, 3_200L))
        assertFalse(NativeExportVerificationPolicy.durationMatches(2_000L, 799L))
        assertFalse(NativeExportVerificationPolicy.durationMatches(2_000L, 3_201L))
    }

    @Test
    fun `duration tolerance scales to eight percent for long exports`() {
        assertTrue(NativeExportVerificationPolicy.durationMatches(100_000L, 108_000L))
        assertFalse(NativeExportVerificationPolicy.durationMatches(100_000L, 108_001L))
    }

    @Test
    fun `non positive duration never verifies`() {
        assertFalse(NativeExportVerificationPolicy.durationMatches(0L, 1L))
        assertFalse(NativeExportVerificationPolicy.durationMatches(1L, 0L))
    }
}
