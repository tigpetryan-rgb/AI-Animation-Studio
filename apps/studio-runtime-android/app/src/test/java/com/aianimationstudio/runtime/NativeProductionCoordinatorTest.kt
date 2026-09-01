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
        assertEquals(null, snapshot.sceneTimeline)
    }

    @Test
    fun `physical proof wait script accepts exact inline output metadata`() {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "physical-proof",
            prompt = "ACTOR WAIT 2 seconds 320x240 12 fps.",
            reference = reference,
            sourceCommit = sourceCommit,
        )

        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        assertTrue(snapshot.performanceReady)
        assertTrue(snapshot.cameraReady)
        assertEquals(NativeStoryAction.WAIT, snapshot.story?.events?.single()?.type)
        assertEquals(null, snapshot.story?.events?.single()?.targetId)
        assertEquals(320, snapshot.blocking?.output?.width)
        assertEquals(240, snapshot.blocking?.output?.height)
        assertEquals(12.0, snapshot.blocking?.output?.frameRate ?: 0.0, 0.0)
        assertEquals(2.0, snapshot.blocking?.output?.durationSeconds ?: 0.0, 0.0)
    }

    @Test
    fun `armenian natural supported subset reaches ready through scene ir and exact timeline gate`() {
        val source = "Կերպարը հանգիստ սպասում է 24 վայրկյան։ Ելքը՝ 320×240, 12 կադր/վրկ։"
        val snapshot = NativeProductionCoordinator.prepareNaturalLanguage(
            chatId = "armenian-physical-proof",
            prompt = source,
            reference = reference,
            sourceCommit = sourceCommit,
            backend = NativeSupportedSubsetSemanticProbe,
        )

        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, snapshot.sceneSemanticStatus)
        assertEquals(NativeSceneLanguage.ARMENIAN, snapshot.sceneIr?.detectedLanguage)
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        assertTrue(snapshot.performanceReady)
        assertTrue(snapshot.cameraReady)
        assertEquals(NativeStoryAction.WAIT, snapshot.story?.events?.single()?.type)
        assertEquals(320, snapshot.blocking?.output?.width)
        assertEquals(240, snapshot.blocking?.output?.height)
        assertEquals(12.0, snapshot.blocking?.output?.frameRate ?: 0.0, 0.0)
        assertEquals(24.0, snapshot.blocking?.output?.durationSeconds ?: 0.0, 0.0)
        val sceneIr = requireNotNull(snapshot.sceneIr)
        val timeline = requireNotNull(snapshot.sceneTimeline)
        assertEquals(64, sceneIr.scriptSha256.length)
        assertEquals(sourceCommit, timeline.sourceCommit)
        assertEquals(reference.sha256, timeline.referenceSha256)
        assertEquals(sceneIr.scriptSha256, timeline.scriptSha256)
        assertEquals(24.0, timeline.durationSeconds, 0.0)
        assertEquals(1, timeline.shots.size)
        assertEquals(sceneIr.actions.map { it.id }, timeline.shots.single().actionIds)
    }

    @Test
    fun `natural understood but unsupported interaction never becomes ready`() {
        val snapshot = NativeProductionCoordinator.prepareNaturalLanguage(
            chatId = "unsupported",
            prompt = "Կերպարը քայլում է դեպի պատուհանը և բացում է այն 24 վայրկյան։",
            reference = reference,
            sourceCommit = sourceCommit,
            backend = NativeSupportedSubsetSemanticProbe,
        )

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, snapshot.sceneSemanticStatus)
        assertEquals(NativeProductionStage.BLOCKING_VALID, snapshot.stage)
        assertFalse(snapshot.performanceReady)
        assertFalse(snapshot.cameraReady)
        assertEquals(null, snapshot.sceneTimeline)
        assertTrue(snapshot.diagnostics.any { it.code == "UNSUPPORTED_CAPABILITY" })
    }

    @Test
    fun `mixed natural unsupported intent does not bypass timeline or capability gate`() {
        val snapshot = NativeProductionCoordinator.prepareNaturalLanguage(
            chatId = "mixed-unsupported",
            prompt = "Կերպարը հանգիստ սպասում է, then opens the door for 20 seconds.",
            reference = reference,
            sourceCommit = sourceCommit,
            backend = NativeSupportedSubsetSemanticProbe,
        )

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, snapshot.sceneSemanticStatus)
        assertEquals(NativeSceneLanguage.MIXED, snapshot.sceneIr?.detectedLanguage)
        assertEquals(NativeProductionStage.BLOCKING_VALID, snapshot.stage)
        assertEquals(null, snapshot.sceneTimeline)
        assertFalse(snapshot.performanceReady)
        assertTrue(snapshot.diagnostics.any { it.code == "UNSUPPORTED_CAPABILITY" })
    }

    @Test
    fun `wait output metadata projection remains fail closed for unknown suffix`() {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "main",
            prompt = "ACTOR WAIT 2 seconds nonsense 320x240 12 fps",
            reference = reference,
            sourceCommit = sourceCommit,
        )

        assertEquals(NativeProductionStage.BLOCKING_VALID, snapshot.stage)
        assertTrue(snapshot.diagnostics.any { it.code == "STORY_UNEXPECTED_TARGET" })
        assertFalse(snapshot.performanceReady)
    }

    @Test
    fun `natural language remains fail closed instead of fabricating story events in legacy mode`() {
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
        assertEquals(null, snapshot.sceneSemanticStatus)
        assertEquals(null, snapshot.sceneTimeline)
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
