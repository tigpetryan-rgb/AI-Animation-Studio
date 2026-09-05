package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeProductionOrchestrationPhase7Test {
    private val sourceSha = "89abcdef0123456789abcdef0123456789abcdef"
    private val referenceSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    private val prompt = "Դերասանը քայլում է դեպի տուփը, կանգնում է, նայում է տուփին, վերցնում է այն և արձագանքում։ Փոխիր միջավայրը, լույսը և շարժիր տեսախցիկը։ 14 վայրկյան 320x240 12 fps"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase7-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase7-character",
        localFile = File("build/phase7-character-reference.bin"),
    )

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE7_TEST_SEMANTIC_BACKEND",
            model = "phase7-orchestration-fixture-v1",
            output = NativeSceneOutput(
                width = 320,
                height = 240,
                frameRate = 12.0,
                durationSeconds = 14.0,
            ),
            actions = listOf(
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WALK_TO,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "քայլում է դեպի տուփը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WAIT,
                    actorId = request.actorId,
                    sourceExcerpt = "կանգնում է",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LOOK_AT,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "նայում է տուփին",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.PICK_UP,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "վերցնում է այն",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.REACT,
                    actorId = request.actorId,
                    sourceExcerpt = "արձագանքում",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.ENVIRONMENT_CHANGE,
                    actorId = request.actorId,
                    sourceExcerpt = "փոխիր միջավայրը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LIGHTING_CHANGE,
                    actorId = request.actorId,
                    sourceExcerpt = "լույսը",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.CAMERA_MOVE,
                    actorId = request.actorId,
                    sourceExcerpt = "շարժիր տեսախցիկը",
                ),
            ),
        )
    }

    private fun execute(text: String = prompt): NativePhase7OrchestrationResult =
        NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase7-armenian-orchestration",
            prompt = text,
            reference = reference(),
            sourceCommit = sourceSha,
            backend = backend,
        )

    @Test
    fun `armenian natural language scene becomes full production timeline and render dag without manual internal state`() {
        val result = execute()
        assertTrue(result is NativePhase7OrchestrationResult.Ready)
        val plan = (result as NativePhase7OrchestrationResult.Ready).plan

        assertTrue(plan.acceptance.done)
        assertEquals(NativeSceneLanguage.ARMENIAN, plan.ir.detectedLanguage)
        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, plan.productionSemanticStatus)
        assertEquals(sourceSha, plan.ir.sourceCommit)
        assertEquals(referenceSha, plan.ir.referenceSha256)

        assertTrue(plan.entities.any { it.id == plan.ir.actorId && it.kind == NativePhase7EntityKind.CHARACTER })
        assertTrue(plan.entities.any { it.id == "prop_box" && it.kind == NativePhase7EntityKind.PROP })
        assertTrue(plan.story.ok)
        val actions = plan.story.ir.events.map { it.type }
        assertTrue(NativeStoryAction.WALK_TO in actions)
        assertTrue(NativeStoryAction.WAIT in actions)
        assertTrue(NativeStoryAction.TURN_TO in actions)
        assertTrue(NativeStoryAction.LOOK_AT in actions)
        assertTrue(NativeStoryAction.PICK_UP in actions)
        assertTrue(NativeStoryAction.REACT in actions)

        assertTrue(plan.performance.acceptance.done)
        assertTrue(plan.cameraPlan.acceptance.done)
        assertTrue(plan.worldPlan.acceptance.done)
        assertTrue(plan.worldBoundPerformance.acceptance.done)
        assertEquals(
            setOf(NativeSceneConcept.CAMERA_MOVE, NativeSceneConcept.LIGHTING_CHANGE, NativeSceneConcept.ENVIRONMENT_CHANGE),
            plan.controlConcepts,
        )
        assertTrue(plan.worldPlan.world.environment.id.startsWith("phase7-semantic-environment-"))
        assertTrue(plan.worldPlan.world.lights.single { it.role == NativePhase6LightRole.KEY }.intensityLux > 600.0)
        assertTrue(plan.cameraPlan.shots.any { it.motion != NativePhase5CameraMotion.STATIC })

        val finalProp = plan.worldPlan.finalPropStates.getValue("phase7-prop-prop_box")
        assertEquals(NativePhase6PropMode.HELD, finalProp.mode)
        assertEquals(plan.ir.actorId, finalProp.ownerActorId)
        val canonicalProp = plan.worldPlan.world.anchors.single { it.semanticId == "prop_box" }.position
        val targetContacts = plan.worldBoundPerformance.contacts.filter { it.targetId == "prop_box" }
        assertTrue(targetContacts.isNotEmpty())
        assertTrue(targetContacts.all { it.anchor == canonicalProp && it.solvedPosition == canonicalProp })

        assertEquals(168, plan.timeline.totalFrames)
        assertEquals(0, plan.timeline.segments.first().startFrame)
        assertEquals(168, plan.timeline.segments.last().endFrameExclusive)
        assertTrue(plan.timeline.segments.zipWithNext().all { (left, right) -> left.endFrameExclusive == right.startFrame })
        assertEquals(plan.timeline.segments.size + 1, plan.renderGraph.jobs.size)
        assertEquals(NativePhase7JobKind.PREPARE_CANONICAL_SCENE, plan.renderGraph.jobs.first().kind)
        assertEquals(plan.timeline.segments.size, plan.renderGraph.jobs.count { it.kind == NativePhase7JobKind.RENDER_SHOT })
        assertTrue(plan.renderGraph.jobs.all {
            it.sourceCommit == sourceSha && it.referenceSha256 == referenceSha && it.scriptSha256 == plan.ir.scriptSha256
        })
    }

    @Test
    fun `same natural language identity deterministically reproduces orchestration fingerprint timeline and jobs`() {
        val first = execute()
        val second = execute()
        assertTrue(first is NativePhase7OrchestrationResult.Ready)
        assertTrue(second is NativePhase7OrchestrationResult.Ready)
        val left = (first as NativePhase7OrchestrationResult.Ready).plan
        val right = (second as NativePhase7OrchestrationResult.Ready).plan
        assertEquals(left.deterministicFingerprint, right.deterministicFingerprint)
        assertEquals(left.timeline, right.timeline)
        assertEquals(left.renderGraph, right.renderGraph)
        assertEquals(left.worldPlan.finalPropStates, right.worldPlan.finalPropStates)

        val changed = execute(prompt.replace("14 վայրկյան", "16 վայրկյան"))
        assertTrue(changed is NativePhase7OrchestrationResult.Ready)
        assertNotEquals(
            left.deterministicFingerprint,
            (changed as NativePhase7OrchestrationResult.Ready).plan.deterministicFingerprint,
        )
    }

    @Test
    fun `phase7 fails closed without exact reference identity`() {
        val result = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase7-armenian-orchestration",
            prompt = prompt,
            reference = null,
            sourceCommit = sourceSha,
            backend = backend,
        )
        assertTrue(result is NativePhase7OrchestrationResult.Rejected)
        val diagnostics = (result as NativePhase7OrchestrationResult.Rejected).diagnostics
        assertTrue(diagnostics.any { it.code == "BLOCKING_MISSING_REFERENCE" || it.code == "PHASE7_REFERENCE_IDENTITY" })
    }
}
