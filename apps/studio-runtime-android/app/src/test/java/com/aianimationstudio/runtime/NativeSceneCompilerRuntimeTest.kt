package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class NativeSceneCompilerRuntimeTest {
    private val request = NativeSceneSemanticRequest(
        originalText = "Կերպարը սպասում է 30 վայրկյան։",
        sourceCommit = "c".repeat(40),
        referenceSha256 = "d".repeat(64),
        actorId = "character-main",
    )

    private fun document(actions: List<NativeSceneActionDraft> = listOf(waitDraft())) = NativeSceneSemanticDocument(
        detectedLanguage = NativeSceneLanguage.ARMENIAN,
        normalizedText = request.originalText,
        provider = "fixture",
        model = "fixture-v1",
        output = NativeSceneOutput(durationSeconds = 30.0),
        actions = actions,
    )

    private fun waitDraft() = NativeSceneActionDraft(
        concept = NativeSceneConcept.WAIT,
        actorId = request.actorId,
        sourceExcerpt = request.originalText,
    )

    private fun ir(actions: List<NativeSceneAction> = listOf(action("a1"))): NativeSceneIrV1 = NativeSceneIrV1(
        schemaVersion = 1,
        detectedLanguage = NativeSceneLanguage.ARMENIAN,
        originalText = request.originalText,
        normalizedText = request.originalText,
        scriptSha256 = "e".repeat(64),
        sourceCommit = request.sourceCommit,
        referenceSha256 = request.referenceSha256,
        semanticProvider = "fixture",
        semanticModel = "fixture-v1",
        actorId = request.actorId,
        output = NativeSceneOutput(durationSeconds = 30.0),
        actions = actions,
    )

    private fun action(id: String) = NativeSceneAction(
        id = id,
        concept = NativeSceneConcept.WAIT,
        actorId = request.actorId,
        sourceExcerpt = request.originalText,
    )

    private fun camera() = NativeSceneCameraPlan(
        shotSize = NativeCameraShotSize.FULL,
        angle = NativeCameraAngle.EYE_LEVEL,
        movement = NativeCameraMovement.LOCKED,
        focusTargetId = request.actorId,
    )

    @Test
    fun `bounded backend retries transient failure then succeeds`() {
        val attempts = AtomicInteger(0)
        val delegate = NativeSceneSemanticBackend {
            if (attempts.incrementAndGet() == 1) error("temporary")
            document()
        }
        val backend = BoundedNativeSceneSemanticBackend(
            delegate,
            NativeSceneBackendPolicy(timeoutMillis = 1_000, maxAttempts = 2, retryBackoffMillis = 0),
        )

        val result = backend.infer(request)

        assertEquals(2, attempts.get())
        assertEquals("fixture-v1", result.model)
    }

    @Test
    fun `bounded backend timeout fails explicitly without fabricated semantics`() {
        val backend = BoundedNativeSceneSemanticBackend(
            NativeSceneSemanticBackend {
                Thread.sleep(500)
                document()
            },
            NativeSceneBackendPolicy(timeoutMillis = 30, maxAttempts = 1, retryBackoffMillis = 0, pollMillis = 5),
        )

        try {
            backend.infer(request)
            fail("Expected timeout")
        } catch (failure: NativeSceneBackendException) {
            assertEquals(NativeSceneBackendFailureCategory.TIMEOUT, failure.category)
        }
    }

    @Test
    fun `bounded backend cancellation stops before provider call`() {
        var providerCalled = false
        val token = NativeSceneCancellationToken().apply { cancel() }
        val backend = BoundedNativeSceneSemanticBackend(
            NativeSceneSemanticBackend {
                providerCalled = true
                document()
            },
            NativeSceneBackendPolicy(timeoutMillis = 1_000, maxAttempts = 2, retryBackoffMillis = 0),
            token,
        )

        try {
            backend.infer(request)
            fail("Expected cancellation")
        } catch (failure: NativeSceneBackendException) {
            assertEquals(NativeSceneBackendFailureCategory.CANCELLED, failure.category)
            assertTrue(!providerCalled)
        }
    }

    @Test
    fun `bounded backend rejects oversized structured response`() {
        val huge = List(M57_MAX_MODEL_ACTIONS + 1) { index -> waitDraft().copy(sourceExcerpt = "action-$index") }
        val backend = BoundedNativeSceneSemanticBackend(
            NativeSceneSemanticBackend { document(huge) },
            NativeSceneBackendPolicy(timeoutMillis = 1_000, maxAttempts = 1, retryBackoffMillis = 0),
        )

        try {
            backend.infer(request)
            fail("Expected bounded response rejection")
        } catch (failure: NativeSceneBackendException) {
            assertEquals(NativeSceneBackendFailureCategory.RESPONSE_TOO_LARGE, failure.category)
        }
    }

    @Test
    fun `single shot timeline preserves exact 30 second budget and identity`() {
        val result = NativeSceneTimelineCompiler.singleShot(ir())
        assertTrue(result is NativeSceneTimelineResult.Ready)
        val timeline = (result as NativeSceneTimelineResult.Ready).timeline
        assertEquals(30.0, timeline.durationSeconds, 0.0)
        assertEquals(request.sourceCommit, timeline.sourceCommit)
        assertEquals(request.referenceSha256, timeline.referenceSha256)
        assertEquals("e".repeat(64), timeline.scriptSha256)
        assertEquals(0.0, timeline.shots.single().startSeconds, 0.0)
        assertEquals(30.0, timeline.shots.single().endSeconds, 0.0)
    }

    @Test
    fun `multi shot timeline is contiguous explicit and duration exact`() {
        val scene = ir(listOf(action("a1"), action("a2"), action("a3")))
        val result = NativeSceneTimelineCompiler.compile(
            scene,
            listOf(
                NativeSceneShotDraft("shot-1", 0.0, 10.0, listOf("a1"), camera()),
                NativeSceneShotDraft("shot-2", 10.0, 8.0, listOf("a2"), camera()),
                NativeSceneShotDraft("shot-3", 18.0, 12.0, listOf("a3"), camera()),
            ),
        )

        assertTrue(result is NativeSceneTimelineResult.Ready)
        assertEquals(30.0, (result as NativeSceneTimelineResult.Ready).timeline.shots.last().endSeconds, 0.0)
    }

    @Test
    fun `timeline rejects gaps overlaps unknown refs and silently dropped actions`() {
        val scene = ir(listOf(action("a1"), action("a2")))
        val result = NativeSceneTimelineCompiler.compile(
            scene,
            listOf(
                NativeSceneShotDraft("shot-1", 1.0, 10.0, listOf("a1", "unknown"), camera()),
                NativeSceneShotDraft("shot-2", 9.0, 10.0, emptyList(), camera()),
            ),
        )

        assertTrue(result is NativeSceneTimelineResult.Rejected)
        val codes = (result as NativeSceneTimelineResult.Rejected).diagnostics.map { it.code }.toSet()
        assertTrue("SCENE_TIMELINE_GAP" in codes)
        assertTrue("SCENE_TIMELINE_OVERLAP" in codes)
        assertTrue("SCENE_UNKNOWN_ACTION_REF" in codes)
        assertTrue("SCENE_UNSCHEDULED_ACTION" in codes)
        assertTrue("SCENE_TIMING_BUDGET" in codes)
    }

    @Test
    fun `timeline camera target outside exact actor identity fails closed`() {
        val foreignCamera = camera().copy(focusTargetId = "invented-target")
        val result = NativeSceneTimelineCompiler.compile(
            ir(),
            listOf(NativeSceneShotDraft("shot-1", 0.0, 30.0, listOf("a1"), foreignCamera)),
        )

        assertTrue(result is NativeSceneTimelineResult.Rejected)
        assertTrue((result as NativeSceneTimelineResult.Rejected).diagnostics.any { it.code == "SCENE_CAMERA_TARGET" })
    }
}
