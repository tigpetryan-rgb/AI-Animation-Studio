package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeVirtualDirectorPhase5Test {
    private val sourceSha = "56789abcdef0123456789abcdef0123456789abc"
    private val referenceSha = "bcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789a"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase5-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase5-character",
        localFile = File("build/phase5-character-reference.bin"),
    )

    private fun capturedAsset(): NativeCharacterAsset3D {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase5-director",
            prompt = "# Phase 5 source 14 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT",
            reference = reference(),
            sourceCommit = sourceSha,
            shotId = "phase5-source-shot",
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

    private fun masterPerformance(): NativePhase4ActorPerformance {
        val asset = capturedAsset()
        val story = NativeStoryCompiler.compile(
            """
            ACTOR WALK_TO BOX
            ACTOR WAIT
            ACTOR TURN_TO BOX
            ACTOR LOOK_AT BOX
            ACTOR PICK_UP BOX
            ACTOR USE BOX
            ACTOR REACT
            """.trimIndent(),
            registry(asset.actorId),
        )
        assertTrue(story.ok)
        val result = NativeActorPerformancePhase4Engine.execute(
            asset = asset,
            shotId = "phase5-master-performance",
            story = story,
            durationSeconds = 14.0,
        )
        assertTrue(result is NativePhase4PerformanceResult.Ready)
        val performance = (result as NativePhase4PerformanceResult.Ready).performance
        assertTrue(performance.acceptance.done)
        return performance
    }

    @Test
    fun `phase5 done gate creates cinematic continuity safe coverage from one master performance`() {
        val performance = masterPerformance()
        val result = NativeVirtualDirectorPhase5Engine.execute(performance, 16.0 / 9.0)
        assertTrue(result is NativePhase5DirectorResult.Ready)
        val plan = (result as NativePhase5DirectorResult.Ready).plan

        assertEquals(performance.assetId, plan.assetId)
        assertEquals(performance.canonical.actorId, plan.actorId)
        assertEquals(performance.canonical.shotId, plan.shotId)
        assertEquals(sourceSha, plan.sourceCommit)
        assertEquals(performance.steps.size, plan.shots.size)
        assertTrue(plan.acceptance.done)
        assertTrue(plan.acceptance.shotLanguageGate)
        assertTrue(plan.acceptance.framingLensGate)
        assertTrue(plan.acceptance.motionGate)
        assertTrue(plan.acceptance.visibilityGate)
        assertTrue(plan.acceptance.collisionGate)
        assertTrue(plan.acceptance.eyelineContinuityGate)
        assertTrue(plan.acceptance.onePerformanceManyCamerasGate)
        assertTrue(plan.acceptance.storyIntentSelectionGate)

        val sizes = plan.shots.map { it.size }.toSet()
        assertTrue(sizes.contains(NativePhase5ShotSize.WIDE))
        assertTrue(sizes.contains(NativePhase5ShotSize.FULL))
        assertTrue(sizes.contains(NativePhase5ShotSize.MEDIUM))
        assertTrue(sizes.contains(NativePhase5ShotSize.MEDIUM_CLOSE))
        assertTrue(sizes.contains(NativePhase5ShotSize.CLOSE_UP))

        val motions = plan.shots.map { it.motion }.toSet()
        assertTrue(motions.contains(NativePhase5CameraMotion.TRACKING))
        assertTrue(motions.contains(NativePhase5CameraMotion.ORBIT))
        assertTrue(motions.contains(NativePhase5CameraMotion.PAN))
        assertTrue(motions.contains(NativePhase5CameraMotion.DOLLY_IN))
        assertTrue(motions.contains(NativePhase5CameraMotion.STATIC))

        assertTrue(plan.shots.all { it.lensMm in 24.0..120.0 })
        assertTrue(plan.shots.all { it.startPose.verticalFovDegrees in 10.0..60.0 })
        assertTrue(plan.safetySamples.all { it.visible })
        assertTrue(plan.safetySamples.all { it.actorClearanceMeters >= 0.72 })
        assertTrue(plan.safetySamples.all { it.targetClearanceMeters == null || it.targetClearanceMeters >= 0.45 })
        assertEquals(setOf(1), plan.safetySamples.map { it.eyelineSide }.toSet())

        val walk = plan.shots.single { it.action == NativeStoryAction.WALK_TO }
        assertEquals(NativePhase5ShotSize.WIDE, walk.size)
        assertEquals(NativePhase5CameraMotion.TRACKING, walk.motion)
        val interaction = plan.shots.single { it.action == NativeStoryAction.PICK_UP }
        assertEquals(NativePhase5ShotSize.MEDIUM_CLOSE, interaction.size)
        val reaction = plan.shots.single { it.action == NativeStoryAction.REACT }
        assertEquals(NativePhase5ShotSize.CLOSE_UP, reaction.size)
        assertTrue(reaction.lensMm > interaction.lensMm)
    }

    @Test
    fun `same master performance produces deterministic identical phase5 camera plan`() {
        val performance = masterPerformance()
        val first = NativeVirtualDirectorPhase5Engine.execute(performance)
        val second = NativeVirtualDirectorPhase5Engine.execute(performance)
        assertTrue(first is NativePhase5DirectorResult.Ready)
        assertTrue(second is NativePhase5DirectorResult.Ready)
        assertEquals(
            (first as NativePhase5DirectorResult.Ready).plan,
            (second as NativePhase5DirectorResult.Ready).plan,
        )
    }

    @Test
    fun `phase5 fails closed when phase4 done gate is not satisfied`() {
        val asset = capturedAsset()
        val story = NativeStoryCompiler.compile(
            "ACTOR WAIT\nACTOR LOOK_AT BOX",
            registry(asset.actorId),
        )
        val phase4 = NativeActorPerformancePhase4Engine.execute(
            asset = asset,
            shotId = "phase5-incomplete-performance",
            story = story,
            durationSeconds = 6.0,
        )
        assertTrue(phase4 is NativePhase4PerformanceResult.Ready)
        val incomplete = (phase4 as NativePhase4PerformanceResult.Ready).performance
        assertFalse(incomplete.acceptance.done)

        val result = NativeVirtualDirectorPhase5Engine.execute(incomplete)
        assertTrue(result is NativePhase5DirectorResult.Rejected)
        val diagnostics = (result as NativePhase5DirectorResult.Rejected).diagnostics
        assertTrue(diagnostics.any { it.code == "PHASE5_PERFORMANCE" })
    }
}
