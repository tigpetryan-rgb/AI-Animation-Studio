package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativePhase8RenderPipelineTest {
    private val sourceSha = "89abcdef0123456789abcdef0123456789abcdef"
    private val referenceSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    private val prompt = "Դերասանը քայլում է դեպի տուփը, կանգնում է, նայում է տուփին, վերցնում է այն և արձագանքում։ Փոխիր միջավայրը, լույսը և շարժիր տեսախցիկը։ 14 վայրկյան 320x240 12 fps"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase8-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase8-character",
        localFile = File("build/phase8-character-reference.bin"),
    )

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_TEST_SEMANTIC_BACKEND",
            model = "phase8-render-binding-fixture-v1",
            output = NativeSceneOutput(width = 320, height = 240, frameRate = 12.0, durationSeconds = 14.0),
            actions = listOf(
                NativeSceneActionDraft(NativeSceneConcept.WALK_TO, request.actorId, "prop_box", sourceExcerpt = "քայլում է դեպի տուփը"),
                NativeSceneActionDraft(NativeSceneConcept.WAIT, request.actorId, sourceExcerpt = "կանգնում է"),
                NativeSceneActionDraft(NativeSceneConcept.LOOK_AT, request.actorId, "prop_box", sourceExcerpt = "նայում է տուփին"),
                NativeSceneActionDraft(NativeSceneConcept.PICK_UP, request.actorId, "prop_box", sourceExcerpt = "վերցնում է այն"),
                NativeSceneActionDraft(NativeSceneConcept.REACT, request.actorId, sourceExcerpt = "արձագանքում"),
                NativeSceneActionDraft(NativeSceneConcept.ENVIRONMENT_CHANGE, request.actorId, sourceExcerpt = "փոխիր միջավայրը"),
                NativeSceneActionDraft(NativeSceneConcept.LIGHTING_CHANGE, request.actorId, sourceExcerpt = "լույսը"),
                NativeSceneActionDraft(NativeSceneConcept.CAMERA_MOVE, request.actorId, sourceExcerpt = "շարժիր տեսախցիկը"),
            ),
        )
    }

    private fun acceptedPlan(): NativePhase7ProductionPlan {
        val result = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-direct-render-binding",
            prompt = prompt,
            reference = reference(),
            sourceCommit = sourceSha,
            backend = backend,
        )
        assertTrue(result is NativePhase7OrchestrationResult.Ready)
        return (result as NativePhase7OrchestrationResult.Ready).plan
    }

    @Test
    fun `accepted phase7 render dag binds every exact frame directly to world-bound actor and resolved camera`() {
        val phase7 = acceptedPlan()
        val result = NativePhase8RenderBinder.bind(phase7)
        assertTrue(result is NativePhase8RenderBindingResult.Ready)
        val bound = (result as NativePhase8RenderBindingResult.Ready).plan

        assertEquals(sourceSha, bound.sourceCommit)
        assertEquals(referenceSha, bound.referenceSha256)
        assertEquals(phase7.ir.scriptSha256, bound.scriptSha256)
        assertEquals(320, bound.width)
        assertEquals(240, bound.height)
        assertEquals(12.0, bound.frameRate, 0.0)
        assertEquals(168, bound.totalFrames)
        assertEquals(168, bound.frames.size)
        assertEquals((0 until 168).toList(), bound.frames.map { it.frameIndex })
        assertEquals(0L, bound.frames.first().presentationTimeUs)
        assertEquals(13_916_667L, bound.frames.last().presentationTimeUs)
        assertTrue(bound.frames.zipWithNext().all { (left, right) -> right.presentationTimeUs > left.presentationTimeUs })

        assertEquals(phase7.worldBoundPerformance.tracks, bound.performance.tracks)
        assertEquals(phase7.characterAsset.sourceCommit, bound.model.sourceCommit)
        assertEquals(phase7.characterAsset.referenceSha256, bound.model.referenceSha256)
        assertTrue(bound.frames.all { frame ->
            frame.renderJob.kind == NativePhase7JobKind.RENDER_SHOT &&
                frame.renderJob.shotId == frame.segment.shotId &&
                frame.renderJob.startFrame == frame.segment.startFrame &&
                frame.renderJob.endFrameExclusive == frame.segment.endFrameExclusive &&
                frame.resolvedShot.sourceShot.id == frame.segment.shotId
        })

        val renderJobs = phase7.renderGraph.jobs.filter { it.kind == NativePhase7JobKind.RENDER_SHOT }
        renderJobs.forEach { job ->
            assertEquals(job.endFrameExclusive - job.startFrame, bound.frames.count { it.renderJob.id == job.id })
        }

        val cameraSamples = bound.frames.map(NativePhase8RenderBinder::sampleCamera)
        assertTrue(cameraSamples.all { it.distanceToTarget.isFinite() && it.distanceToTarget > 0.0 })
        assertTrue(cameraSamples.all { it.verticalFovDegrees.isFinite() && it.verticalFovDegrees > 0.0 })
    }

    @Test
    fun `phase8 binding fails closed when timeline identity is changed after phase7 acceptance`() {
        val phase7 = acceptedPlan()
        val stale = phase7.copy(timeline = phase7.timeline.copy(sourceCommit = "0000000000000000000000000000000000000000"))
        val result = NativePhase8RenderBinder.bind(stale)
        assertTrue(result is NativePhase8RenderBindingResult.Rejected)
        val diagnostics = (result as NativePhase8RenderBindingResult.Rejected).diagnostics
        assertTrue(diagnostics.any { it.code == "PHASE8_TIMELINE_IDENTITY" || it.code == "PHASE8_CHARACTER_IDENTITY" })
    }
}
