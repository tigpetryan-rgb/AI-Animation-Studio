package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativePhase8CodecContractTest {
    private val sourceSha = "89abcdef0123456789abcdef0123456789abcdef"
    private val referenceSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    private val prompt = "Դերասանը քայլում է դեպի տուփը, կանգնում է, նայում է տուփին, վերցնում է այն և արձագանքում։ Փոխիր միջավայրը, լույսը և շարժիր տեսախցիկը։ 14 վայրկյան 320x240 12 fps"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase8-codec-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase8-codec-character",
        localFile = File("build/phase8-codec-character-reference.bin"),
    )

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_CODEC_TEST_BACKEND",
            model = "phase8-codec-fixture-v1",
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

    private fun boundPlan(): NativePhase8BoundRenderPlan {
        val orchestration = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-codec-contract",
            prompt = prompt,
            reference = reference(),
            sourceCommit = sourceSha,
            backend = backend,
        )
        assertTrue(orchestration is NativePhase7OrchestrationResult.Ready)
        val phase7 = (orchestration as NativePhase7OrchestrationResult.Ready).plan
        val binding = NativePhase8RenderBinder.bind(phase7)
        assertTrue(binding is NativePhase8RenderBindingResult.Ready)
        return (binding as NativePhase8RenderBindingResult.Ready).plan
    }

    @Test
    fun `phase8 exact indexed frames become an exact codec input contract without timing drift`() {
        val bound = boundPlan()
        val result = NativePhase8CodecContract.build(bound)
        assertTrue(result is NativePhase8CodecContractResult.Ready)
        val input = (result as NativePhase8CodecContractResult.Ready).input

        assertEquals(sourceSha, input.sourceCommit)
        assertEquals(referenceSha, input.referenceSha256)
        assertEquals(bound.scriptSha256, input.scriptSha256)
        assertEquals(320, input.codecPlan.width)
        assertEquals(240, input.codecPlan.height)
        assertEquals(12.0, input.codecPlan.frameRate, 0.0)
        assertEquals(14.0, input.codecPlan.durationSeconds, 0.0)
        assertEquals(168, input.codecPlan.frameCount)
        assertEquals(672_000L, input.codecPlan.totalAudioFrames)
        assertEquals(168, input.frames.size)
        assertEquals((0 until 168).toList(), input.frames.map { it.frameIndex })
        assertEquals(bound.frames.map { it.presentationTimeUs }, input.frames.map { it.presentationTimeUs })
        assertEquals(0L, input.frames.first().presentationTimeUs)
        assertEquals(13_916_667L, input.frames.last().presentationTimeUs)
        assertTrue(input.frames.zipWithNext().all { (left, right) -> right.presentationTimeUs > left.presentationTimeUs })
        assertTrue(input.frames.all { it.renderJobId.isNotBlank() && it.shotId.isNotBlank() })
    }

    @Test
    fun `phase8 codec contract fails closed when an accepted frame pts is changed`() {
        val bound = boundPlan()
        val damagedFrames = bound.frames.toMutableList()
        damagedFrames[37] = damagedFrames[37].copy(presentationTimeUs = damagedFrames[37].presentationTimeUs + 1L)
        val result = NativePhase8CodecContract.build(bound.copy(frames = damagedFrames))

        assertTrue(result is NativePhase8CodecContractResult.Rejected)
        val diagnostics = (result as NativePhase8CodecContractResult.Rejected).diagnostics
        assertTrue(diagnostics.any { it.code == "PHASE8_CODEC_PLAN" || it.code == "PHASE8_CODEC_PTS_DRIFT" })
    }
}
