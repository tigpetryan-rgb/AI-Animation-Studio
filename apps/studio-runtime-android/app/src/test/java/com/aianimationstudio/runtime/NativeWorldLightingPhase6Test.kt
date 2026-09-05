package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeWorldLightingPhase6Test {
    private val sourceSha = "6789abcdef0123456789abcdef0123456789abcd"
    private val referenceSha = "cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase6-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase6-character",
        localFile = File("build/phase6-character-reference.bin"),
    )

    private fun capturedAsset(): NativeCharacterAsset3D {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase6-world-lighting",
            prompt = "# Phase 6 source 14 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT",
            reference = reference(),
            sourceCommit = sourceSha,
            shotId = "phase6-source-shot",
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

    private fun performanceAndCamera(): Pair<NativePhase4ActorPerformance, NativePhase5CameraPlan> {
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
        val phase4 = NativeActorPerformancePhase4Engine.execute(
            asset = asset,
            shotId = "phase6-master-performance",
            story = story,
            durationSeconds = 14.0,
        )
        assertTrue(phase4 is NativePhase4PerformanceResult.Ready)
        val performance = (phase4 as NativePhase4PerformanceResult.Ready).performance
        assertTrue(performance.acceptance.done)
        val phase5 = NativeVirtualDirectorPhase5Engine.execute(performance)
        assertTrue(phase5 is NativePhase5DirectorResult.Ready)
        val camera = (phase5 as NativePhase5DirectorResult.Ready).plan
        assertTrue(camera.acceptance.done)
        return performance to camera
    }

    private fun world(performance: NativePhase4ActorPerformance): NativePhase6WorldState = NativePhase6WorldState(
        sourceCommit = sourceSha,
        shotId = performance.canonical.shotId,
        actorId = performance.canonical.actorId,
        environment = NativePhase6Environment(
            id = "studio-stage-a",
            min = NativeStagePoint(-10.0, -1.0, -10.0),
            max = NativeStagePoint(10.0, 8.0, 12.0),
            obstacles = listOf(
                NativePhase6Obstacle("pillar-left", NativeStagePoint(-4.0, 0.0, -2.0), 0.75),
                NativePhase6Obstacle("set-piece-right", NativeStagePoint(6.5, 0.0, -3.0), 0.9),
            ),
        ),
        anchors = listOf(
            NativePhase6Anchor("anchor_prop_box", "prop_box", NativePhase6AnchorKind.PROP, NativeStagePoint(3.0, 0.0, 0.8)),
            NativePhase6Anchor("anchor_actor_mark", "actor_mark", NativePhase6AnchorKind.ACTOR_MARK, NativeStagePoint(0.0, 0.0, 0.0)),
            NativePhase6Anchor("anchor_key", "light_key", NativePhase6AnchorKind.LIGHT, NativeStagePoint(-1.5, 3.5, 4.0)),
            NativePhase6Anchor("anchor_fill", "light_fill", NativePhase6AnchorKind.LIGHT, NativeStagePoint(4.5, 2.8, 4.5)),
            NativePhase6Anchor("anchor_rim", "light_rim", NativePhase6AnchorKind.LIGHT, NativeStagePoint(2.0, 3.2, -4.0)),
        ),
        props = listOf(
            NativePhase6Prop(
                id = "world-prop-box",
                semanticId = "prop_box",
                radiusMeters = 0.24,
                initialState = NativePhase6PropState(
                    mode = NativePhase6PropMode.STAGED,
                    ownerActorId = null,
                    anchorId = "anchor_prop_box",
                ),
            ),
        ),
        lights = listOf(
            NativePhase6Light("key-light", NativePhase6LightRole.KEY, "anchor_key", 600.0),
            NativePhase6Light("fill-light", NativePhase6LightRole.FILL, "anchor_fill", 220.0),
            NativePhase6Light("rim-light", NativePhase6LightRole.RIM, "anchor_rim", 350.0),
            NativePhase6Light("environment-light", NativePhase6LightRole.ENVIRONMENT, null, 160.0),
        ),
    )

    @Test
    fun `phase6 done gate resolves canonical world prop collision and lighting from one state`() {
        val (performance, camera) = performanceAndCamera()
        val world = world(performance)
        val result = NativeWorldLightingPhase6Engine.execute(performance, camera, world)
        assertTrue(result is NativePhase6WorldLightingResult.Ready)
        val plan = (result as NativePhase6WorldLightingResult.Ready).plan

        assertTrue(plan.acceptance.done)
        assertTrue(plan.acceptance.canonicalAnchorsGate)
        assertTrue(plan.acceptance.worldAnchorReplacementGate)
        assertTrue(plan.acceptance.propStateGate)
        assertTrue(plan.acceptance.collisionGate)
        assertTrue(plan.acceptance.lightingRigGate)
        assertTrue(plan.acceptance.exposureVisibilityGate)
        assertTrue(plan.acceptance.cameraAwareLightingGate)
        assertTrue(plan.acceptance.deterministicSpatialStateGate)

        val canonicalProp = world.anchors.single { it.semanticId == "prop_box" }.position
        val oldRehearsal = performance.steps.first { it.targetId == "prop_box" }.targetAnchor
        assertNotEquals(oldRehearsal, canonicalProp)
        assertTrue(plan.resolvedSteps.filter { it.targetId == "prop_box" }.all { it.targetAnchor == canonicalProp })

        val walk = plan.resolvedSteps.single { it.action == NativeStoryAction.WALK_TO }
        assertNotEquals(performance.steps.single { it.action == NativeStoryAction.WALK_TO }.rootEnd, walk.rootEnd)
        assertTrue(plan.collisionSamples.isNotEmpty())
        assertTrue(plan.collisionSamples.all { it.safe && it.insideEnvironment && it.minimumClearanceMeters >= 0.08 })

        assertEquals(NativePhase6PropMode.IN_USE, plan.finalPropStates.getValue("world-prop-box").mode)
        assertEquals(performance.canonical.actorId, plan.finalPropStates.getValue("world-prop-box").ownerActorId)
        assertTrue(plan.propTransitions.any { it.action == NativeStoryAction.PICK_UP && it.after.mode == NativePhase6PropMode.HELD })
        assertTrue(plan.propTransitions.any { it.action == NativeStoryAction.USE && it.after.mode == NativePhase6PropMode.IN_USE })

        assertTrue(plan.lightingSamples.isNotEmpty())
        assertTrue(plan.lightingSamples.all { it.subjectVisible })
        assertTrue(plan.lightingSamples.all { it.cameraAware })
        assertTrue(plan.lightingSamples.all { it.exposureScore in 0.45..1.60 })
        assertTrue(plan.lightingSamples.all { it.keyCameraAngleDegrees in 15.0..120.0 })
        assertTrue(plan.lightingSamples.all { it.rimCameraAngleDegrees in 85.0..180.0 })
    }

    @Test
    fun `same canonical world performance and camera deterministically reproduce phase6 plan`() {
        val (performance, camera) = performanceAndCamera()
        val world = world(performance)
        val first = NativeWorldLightingPhase6Engine.execute(performance, camera, world)
        val second = NativeWorldLightingPhase6Engine.execute(performance, camera, world)
        assertTrue(first is NativePhase6WorldLightingResult.Ready)
        assertTrue(second is NativePhase6WorldLightingResult.Ready)
        assertEquals(
            (first as NativePhase6WorldLightingResult.Ready).plan,
            (second as NativePhase6WorldLightingResult.Ready).plan,
        )
    }

    @Test
    fun `phase6 fails closed when canonical world source identity does not match`() {
        val (performance, camera) = performanceAndCamera()
        val badWorld = world(performance).copy(sourceCommit = "0000000000000000000000000000000000000000")
        val result = NativeWorldLightingPhase6Engine.execute(performance, camera, badWorld)
        assertTrue(result is NativePhase6WorldLightingResult.Rejected)
        val diagnostics = (result as NativePhase6WorldLightingResult.Rejected).diagnostics
        assertTrue(diagnostics.any { it.code == "PHASE6_SOURCE_IDENTITY" })
    }
}
