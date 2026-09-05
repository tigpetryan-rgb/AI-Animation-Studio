package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeWorldBoundPerformancePhase6Test {
    private val sourceSha = "6789abcdef0123456789abcdef0123456789abcd"
    private val referenceSha = "cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab"

    private fun acceptedPlan(): NativePhase6ProductionPlan {
        val reference = PersistedReferenceAsset(
            displayName = "phase6-world-bound.png",
            mimeType = "image/png",
            sizeBytes = 4096,
            width = 1280,
            height = 1280,
            sha256 = referenceSha,
            originUri = "content://test/phase6-world-bound",
            localFile = File("build/phase6-world-bound-reference.bin"),
        )
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase6-world-bound",
            prompt = "# Phase 6 source 14 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT",
            reference = reference,
            sourceCommit = sourceSha,
            shotId = "phase6-world-bound-source",
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        val capture = NativeCharacterAsset3DFactory.capture(
            model = requireNotNull(snapshot.model3d),
            rig = requireNotNull(snapshot.rig),
        )
        assertTrue(capture is NativeCharacterAsset3DResult.Ready)
        val asset = (capture as NativeCharacterAsset3DResult.Ready).asset
        val registry = listOf(
            NativeStoryEntity(asset.actorId, NativeEntityKind.CHARACTER, listOf("ACTOR", "CHARACTER")),
            NativeStoryEntity("prop_box", NativeEntityKind.PROP, listOf("BOX", "PROP")),
        )
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
            registry,
        )
        assertTrue(story.ok)
        val phase4 = NativeActorPerformancePhase4Engine.execute(
            asset = asset,
            shotId = "phase6-world-bound-performance",
            story = story,
            durationSeconds = 14.0,
        )
        assertTrue(phase4 is NativePhase4PerformanceResult.Ready)
        val performance = (phase4 as NativePhase4PerformanceResult.Ready).performance
        val phase5 = NativeVirtualDirectorPhase5Engine.execute(performance)
        assertTrue(phase5 is NativePhase5DirectorResult.Ready)
        val camera = (phase5 as NativePhase5DirectorResult.Ready).plan
        val world = NativePhase6WorldState(
            sourceCommit = sourceSha,
            shotId = performance.canonical.shotId,
            actorId = performance.canonical.actorId,
            environment = NativePhase6Environment(
                id = "studio-stage-world-bound",
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
                    initialState = NativePhase6PropState(NativePhase6PropMode.STAGED, null, "anchor_prop_box"),
                ),
            ),
            lights = listOf(
                NativePhase6Light("key-light", NativePhase6LightRole.KEY, "anchor_key", 600.0),
                NativePhase6Light("fill-light", NativePhase6LightRole.FILL, "anchor_fill", 220.0),
                NativePhase6Light("rim-light", NativePhase6LightRole.RIM, "anchor_rim", 350.0),
                NativePhase6Light("environment-light", NativePhase6LightRole.ENVIRONMENT, null, 160.0),
            ),
        )
        val phase6 = NativeWorldLightingPhase6Engine.execute(performance, camera, world)
        assertTrue(phase6 is NativePhase6WorldLightingResult.Ready)
        return (phase6 as NativePhase6WorldLightingResult.Ready).plan
    }

    @Test
    fun `canonical world rebases actor root and binds hand grasp contacts to real prop anchor`() {
        val plan = acceptedPlan()
        val result = NativeWorldBoundPerformancePhase6Binder.bind(plan)
        assertTrue(result is NativePhase6WorldBoundResult.Ready)
        val bound = (result as NativePhase6WorldBoundResult.Ready).performance
        assertTrue(bound.acceptance.done)
        assertTrue(bound.acceptance.canonicalTargetContactGate)
        assertTrue(bound.acceptance.rootRebaseGate)
        assertTrue(bound.acceptance.contactSolveGate)
        assertTrue(bound.acceptance.propInteractionContactGate)

        val canonicalProp = plan.world.anchors.single { it.semanticId == "prop_box" }.position
        val oldTargetContacts = plan.performance.contacts.filter { it.targetId == "prop_box" }
        assertTrue(oldTargetContacts.isNotEmpty())
        assertTrue(oldTargetContacts.any { it.anchor != canonicalProp })

        val boundTargetContacts = bound.contacts.filter { it.targetId == "prop_box" }
        assertTrue(boundTargetContacts.isNotEmpty())
        assertTrue(boundTargetContacts.all { it.anchor == canonicalProp && it.solvedPosition == canonicalProp })
        assertTrue(boundTargetContacts.any { it.kind == NativePhase4ContactKind.RIGHT_HAND })
        assertTrue(boundTargetContacts.any { it.kind == NativePhase4ContactKind.PROP_GRASP })

        val oldRoot = plan.performance.canonical.tracks.single { it.kind == NativePerformanceTrackKind.ROOT }
        val newRoot = bound.tracks.single { it.kind == NativePerformanceTrackKind.ROOT }
        assertEquals(oldRoot.keyframes.size, newRoot.keyframes.size)
        assertTrue(oldRoot.keyframes.zip(newRoot.keyframes).any { (before, after) -> before.rootPosition != after.rootPosition })
        assertNotEquals(
            plan.performance.steps.single { it.action == NativeStoryAction.WALK_TO }.rootEnd,
            plan.resolvedSteps.single { it.action == NativeStoryAction.WALK_TO }.rootEnd,
        )
        assertTrue(bound.contacts.all { contact ->
            distance(contact.anchor, contact.solvedPosition) <= contact.maxErrorMeters
        })
    }

    @Test
    fun `world bound actor result is deterministic for the same canonical phase6 plan`() {
        val plan = acceptedPlan()
        val first = NativeWorldBoundPerformancePhase6Binder.bind(plan)
        val second = NativeWorldBoundPerformancePhase6Binder.bind(plan)
        assertTrue(first is NativePhase6WorldBoundResult.Ready)
        assertTrue(second is NativePhase6WorldBoundResult.Ready)
        assertEquals(first, second)
    }

    private fun distance(a: NativeStagePoint, b: NativeStagePoint): Double {
        val dx = a.x - b.x
        val dy = a.y - b.y
        val dz = a.z - b.z
        return kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
    }
}
