package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeActorPerformancePhase4Test {
    private val sourceSha = "456789abcdef0123456789abcdef0123456789ab"
    private val referenceSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase4-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase4-character",
        localFile = File("build/phase4-character-reference.bin"),
    )

    private fun capturedAsset(): NativeCharacterAsset3D {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase4-actor",
            prompt = "# Phase 4 character source 14 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT",
            reference = reference(),
            sourceCommit = sourceSha,
            shotId = "phase4-source-shot",
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        val capture = NativeCharacterAsset3DFactory.capture(
            model = requireNotNull(snapshot.model3d),
            rig = requireNotNull(snapshot.rig),
        )
        assertTrue(capture is NativeCharacterAsset3DResult.Ready)
        return (capture as NativeCharacterAsset3DResult.Ready).asset
    }

    private fun registry(actorId: String) = listOf(
        NativeStoryEntity(actorId, NativeEntityKind.CHARACTER, listOf("ACTOR", "CHARACTER")),
        NativeStoryEntity("prop_box", NativeEntityKind.PROP, listOf("BOX", "PROP")),
    )

    private fun doneGateStory(actorId: String): NativeStoryCompileResult = NativeStoryCompiler.compile(
        """
        ACTOR WALK_TO BOX
        ACTOR WAIT
        ACTOR TURN_TO BOX
        ACTOR LOOK_AT BOX
        ACTOR PICK_UP BOX
        ACTOR USE BOX
        ACTOR REACT
        """.trimIndent(),
        registry(actorId),
    )

    @Test
    fun `phase4 done gate executes multi step actor performance with contact and continuity`() {
        val asset = capturedAsset()
        val story = doneGateStory(asset.actorId)
        assertTrue(story.ok)

        val result = NativeActorPerformancePhase4Engine.execute(
            asset = asset,
            shotId = "phase4-done-gate",
            story = story,
            durationSeconds = 14.0,
        )
        assertTrue(result is NativePhase4PerformanceResult.Ready)
        val performance = (result as NativePhase4PerformanceResult.Ready).performance

        assertEquals(asset.assetId, performance.assetId)
        assertEquals(asset.actorId, performance.canonical.actorId)
        assertEquals(sourceSha, performance.canonical.sourceCommit)
        assertTrue(performance.acceptance.done)
        assertTrue(performance.acceptance.scriptCoverageGate)
        assertTrue(performance.acceptance.rootMotionGate)
        assertTrue(performance.acceptance.retargetingGate)
        assertTrue(performance.acceptance.contactIkGate)
        assertTrue(performance.acceptance.layeredActingGate)
        assertTrue(performance.acceptance.emotionReactionGate)
        assertTrue(performance.acceptance.continuityGate)

        val rootTrack = performance.canonical.tracks.single { it.kind == NativePerformanceTrackKind.ROOT }
        val firstRoot = rootTrack.keyframes.first().rootPosition
        assertTrue(rootTrack.keyframes.any { frame ->
            kotlin.math.abs(frame.rootPosition.x - firstRoot.x) >= 0.45 ||
                kotlin.math.abs(frame.rootPosition.z - firstRoot.z) >= 0.45
        })

        val waitStep = performance.steps.single { it.action == NativeStoryAction.WAIT }
        assertEquals(waitStep.rootStart, waitStep.rootEnd)
        assertTrue(performance.steps.any { it.action == NativeStoryAction.TURN_TO })
        assertTrue(performance.steps.any { it.action == NativeStoryAction.LOOK_AT })
        assertTrue(performance.steps.any { it.action == NativeStoryAction.PICK_UP })
        assertTrue(performance.steps.any { it.action == NativeStoryAction.USE })
        assertTrue(performance.steps.any { it.action == NativeStoryAction.REACT })

        val kinds = performance.canonical.tracks.map { it.kind }.toSet()
        assertTrue(kinds.containsAll(NativePerformanceTrackKind.values().toSet()))
        assertTrue(performance.contacts.any { it.kind == NativePhase4ContactKind.RIGHT_HAND && it.targetId == "prop_box" })
        assertTrue(performance.contacts.any { it.kind == NativePhase4ContactKind.PROP_GRASP && it.targetId == "prop_box" })
        assertTrue(performance.contacts.any { it.kind == NativePhase4ContactKind.LEFT_FOOT })
        assertTrue(performance.contacts.any { it.kind == NativePhase4ContactKind.RIGHT_FOOT })
        assertTrue(performance.contacts.all { it.maxErrorMeters <= 0.03 })
        assertTrue(performance.emotions.any { it.label == "reaction" && it.intensity >= 0.65 })
        assertTrue(performance.microPerformance.any { it.blinkAmount >= 0.99 })
    }

    @Test
    fun `reopened reusable character produces deterministic equivalent phase4 performance`() {
        val asset = capturedAsset()
        val file = File("build/phase4-reopen-${System.nanoTime()}.aichar3d")
        val store = NativeCharacterAsset3DStore(file)
        try {
            store.persist(asset)
            val reopened = requireNotNull(store.restoreVerified(asset.actorId, referenceSha, sourceSha)).asset
            val story = doneGateStory(asset.actorId)

            val first = NativeActorPerformancePhase4Engine.execute(asset, "phase4-reuse-shot", story, 14.0)
            val second = NativeActorPerformancePhase4Engine.execute(reopened, "phase4-reuse-shot", story, 14.0)
            assertTrue(first is NativePhase4PerformanceResult.Ready)
            assertTrue(second is NativePhase4PerformanceResult.Ready)
            val left = (first as NativePhase4PerformanceResult.Ready).performance
            val right = (second as NativePhase4PerformanceResult.Ready).performance

            assertEquals(left.assetId, right.assetId)
            assertEquals(left.canonical, right.canonical)
            assertEquals(left.steps, right.steps)
            assertEquals(left.contacts, right.contacts)
            assertEquals(left.emotions, right.emotions)
            assertEquals(left.microPerformance, right.microPerformance)
            assertEquals(left.acceptance, right.acceptance)
            assertTrue(right.acceptance.done)
        } finally {
            store.clear()
        }
    }

    @Test
    fun `incomplete acting script cannot satisfy phase4 done gate`() {
        val asset = capturedAsset()
        val story = NativeStoryCompiler.compile("ACTOR WAIT\nACTOR LOOK_AT BOX", registry(asset.actorId))
        val result = NativeActorPerformancePhase4Engine.execute(asset, "phase4-incomplete", story, 6.0)
        assertTrue(result is NativePhase4PerformanceResult.Ready)
        val acceptance = (result as NativePhase4PerformanceResult.Ready).performance.acceptance
        assertFalse(acceptance.done)
        assertFalse(acceptance.scriptCoverageGate)
        assertFalse(acceptance.contactIkGate)
    }

    @Test
    fun `stale or invalid reusable character identity fails closed`() {
        val asset = capturedAsset().copy(sourceCommit = "not-a-sha")
        val story = doneGateStory(asset.actorId)
        val result = NativeActorPerformancePhase4Engine.execute(asset, "phase4-invalid", story, 14.0)
        assertTrue(result is NativePhase4PerformanceResult.Rejected)
        val rejected = result as NativePhase4PerformanceResult.Rejected
        assertTrue(rejected.diagnostics.any { it.code == "CHARACTER_ASSET_SOURCE" })
    }
}
