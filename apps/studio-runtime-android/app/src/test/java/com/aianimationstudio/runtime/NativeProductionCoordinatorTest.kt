package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeProductionCoordinatorTest {
    private val sourceCommit = "f".repeat(40)
    private val reference = PersistedReferenceAsset(
        displayName = "character.png",
        mimeType = "image/png",
        sizeBytes = 8192,
        width = 1254,
        height = 1254,
        sha256 = "1".repeat(64),
        originUri = "content://test/reference",
        localFile = File("reference.bin"),
    )

    @Test
    fun `wait script reaches ready for render but not render ready`() {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "main",
            prompt = "ACTOR WAIT",
            reference = reference,
            sourceCommit = sourceCommit,
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        assertTrue(snapshot.blockingReady)
        assertTrue(snapshot.performanceReady)
        assertTrue(snapshot.cameraReady)
        assertFalse(snapshot.renderReady)
        assertEquals(sourceCommit, snapshot.sourceCommit)
        assertEquals(reference.sha256, snapshot.referenceSha256)
        assertEquals(5, snapshot.camera?.visibilitySamples?.size)
    }

    @Test
    fun `natural language remains fail closed instead of fabricating story events`() {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "main",
            prompt = "Make the character smile and walk toward the window.",
            reference = reference,
            sourceCommit = sourceCommit,
        )
        assertEquals(NativeProductionStage.BLOCKING_VALID, snapshot.stage)
        assertNotNull(snapshot.blocking)
        assertTrue(snapshot.performance == null)
        assertTrue(snapshot.diagnostics.any { it.code == "STORY_UNKNOWN_ACTOR" })
    }

    @Test
    fun `stale source commit blocks rig before performance`() {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "main",
            prompt = "ACTOR WAIT",
            reference = reference,
            sourceCommit = "deadbeef",
        )
        assertEquals(NativeProductionStage.BLOCKING_VALID, snapshot.stage)
        assertTrue(snapshot.diagnostics.any { it.code == "RIG_SOURCE_IDENTITY" })
        assertFalse(snapshot.performanceReady)
        assertFalse(snapshot.cameraReady)
    }
}
