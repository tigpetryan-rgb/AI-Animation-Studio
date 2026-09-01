package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NativeExternalSceneIrAdapterTest {
    private val request = NativeSceneSemanticRequest(
        originalText = "The character waits for 20 seconds.",
        sourceCommit = "a".repeat(40),
        referenceSha256 = "b".repeat(64),
        actorId = "character-main",
    )

    @Test
    fun `strict canonical response decodes to provider neutral semantic document`() {
        val document = NativeExternalSceneIrV1Adapter.decode(validResponse("request-1"), request, "request-1")

        assertEquals(NativeSceneLanguage.ENGLISH, document.detectedLanguage)
        assertEquals("proxy-provider", document.provider)
        assertEquals("model-v1", document.model)
        assertEquals(20.0, document.output.durationSeconds, 0.0)
        assertEquals(NativeSceneConcept.WAIT, document.actions.single().concept)
        assertFalse(document.ambiguous)
    }

    @Test
    fun `unknown field is rejected instead of being silently ignored`() {
        val invalid = validResponse("request-1").replace(
            "\"unresolved_terms\":[]",
            "\"unresolved_terms\":[],\"invented_renderer_command\":\"do it\"",
        )

        val error = expectAdapterFailure { NativeExternalSceneIrV1Adapter.decode(invalid, request, "request-1") }
        assertEquals("SCENE_EXTERNAL_UNKNOWN_FIELD", error.diagnosticCode)
    }

    @Test
    fun `duplicate json field is rejected before schema mapping`() {
        val invalid = validResponse("request-1").replace(
            "\"warnings\":[]",
            "\"warnings\":[],\"warnings\":[]",
        )

        val error = expectAdapterFailure { NativeExternalSceneIrV1Adapter.decode(invalid, request, "request-1") }
        assertEquals("SCENE_EXTERNAL_JSON", error.diagnosticCode)
    }

    @Test
    fun `external identity drift is rejected`() {
        val invalid = validResponse("request-1").replace(request.sourceCommit, "c".repeat(40))

        val error = expectAdapterFailure { NativeExternalSceneIrV1Adapter.decode(invalid, request, "request-1") }
        assertEquals("SCENE_EXTERNAL_BUILD_IDENTITY", error.diagnosticCode)
    }

    @Test
    fun `unsupported external camera plan is preserved as fail closed semantic capability`() {
        val response = validResponse("request-1").replace("\"movement\":\"LOCKED\"", "\"movement\":\"PAN\"")
        val document = NativeExternalSceneIrV1Adapter.decode(response, request, "request-1")
        val compilation = NaturalLanguageSceneCompiler(NativeSceneSemanticBackend { document }).compile(request)

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, compilation.status)
        assertTrue(compilation.ir?.actions?.any { it.concept == NativeSceneConcept.CAMERA_MOVE } == true)
        assertTrue(compilation.diagnostics.any { it.code == "UNSUPPORTED_CAPABILITY" })
    }

    @Test
    fun `unresolved external terms remain ambiguity and never become executable`() {
        val response = validResponse("request-1").replace(
            "\"unresolved_terms\":[]",
            "\"unresolved_terms\":[{\"source_excerpt\":\"wait somehow\",\"reason\":\"unclear timing\"}]",
        )
        val document = NativeExternalSceneIrV1Adapter.decode(response, request, "request-1")
        val compilation = NaturalLanguageSceneCompiler(NativeSceneSemanticBackend { document }).compile(request)

        assertEquals(NativeSceneSemanticStatus.AMBIGUOUS_SEMANTICS, compilation.status)
        assertEquals(null, compilation.ir)
    }

    @Test
    fun `controlled proxy request contains only safe compilation identity and no provider secret surface`() {
        lateinit var capturedRequest: String
        lateinit var backend: NativeSceneProxySemanticBackend
        val transport = NativeSceneProxyTransport { payload ->
            capturedRequest = payload
            validResponse(backend.controlledRequestId(request))
        }
        backend = NativeSceneProxySemanticBackend(transport)

        val document = backend.infer(request)

        assertEquals(NativeSceneConcept.WAIT, document.actions.single().concept)
        assertTrue(capturedRequest.contains("\"source_commit\":\"${request.sourceCommit}\""))
        assertTrue(capturedRequest.contains("\"reference_sha256\":\"${request.referenceSha256}\""))
        assertTrue(capturedRequest.contains("\"actor_id\":\"${request.actorId}\""))
        assertTrue(capturedRequest.contains("\"original_text\":\"${request.originalText}\""))
        assertFalse(capturedRequest.contains("api_key", ignoreCase = true))
        assertFalse(capturedRequest.contains("secret", ignoreCase = true))
        assertFalse(capturedRequest.contains("token", ignoreCase = true))
        assertFalse(capturedRequest.contains("reference_bytes", ignoreCase = true))
    }

    @Test
    fun `proxy request identity mismatch is rejected`() {
        val backend = NativeSceneProxySemanticBackend(
            NativeSceneProxyTransport { validResponse("wrong-request-id") },
        )

        try {
            backend.infer(request)
            fail("Expected strict proxy request identity rejection")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message?.contains("SCENE_EXTERNAL_REQUEST_IDENTITY") == true)
        }
    }

    private fun validResponse(requestId: String): String {
        val scriptSha = NativeSceneCompilerSecurity.sha256(request.originalText)
        return """
            {
              "scene_ir_version":1,
              "source":{
                "language":"ENGLISH",
                "original_text":"${request.originalText}",
                "normalized_text":"${request.originalText}",
                "script_sha256":"$scriptSha",
                "build_sha":"${request.sourceCommit}",
                "reference_sha256":"${request.referenceSha256}",
                "provider":"proxy-provider",
                "model":"model-v1",
                "request_id":"$requestId"
              },
              "project_id":"project-main",
              "scene_id":"scene-1",
              "entities":[
                {"id":"${request.actorId}","kind":"ACTOR","source_bound":true,"aliases":["ACTOR"],"material":null,"color":null}
              ],
              "shots":[
                {
                  "id":"shot-1",
                  "start_seconds":0,
                  "duration_seconds":20,
                  "camera":{"shot_size":"FULL","angle":"EYE_LEVEL","movement":"LOCKED","focus_target_id":"${request.actorId}","lens_mm":null},
                  "actions":[
                    {
                      "id":"action-1",
                      "concept":"WAIT",
                      "actor_id":"${request.actorId}",
                      "target_id":null,
                      "start_seconds":0,
                      "duration_seconds":20,
                      "emotion":null,
                      "expression":null,
                      "pose":null,
                      "gesture":null,
                      "spatial_relation":null,
                      "dialogue":null,
                      "source_excerpt":"waits for 20 seconds",
                      "required_capabilities":["WAIT"]
                    }
                  ]
                }
              ],
              "output":{"width":320,"height":240,"fps":12,"duration_seconds":20,"aspect":null},
              "continuity":[],
              "lighting":{"intent":null,"time_of_day":null},
              "environment":{"location_intent":null,"weather":null},
              "required_capabilities":["WAIT"],
              "warnings":[],
              "unresolved_terms":[]
            }
        """.trimIndent()
    }

    private fun expectAdapterFailure(block: () -> Unit): NativeExternalSceneIrException {
        try {
            block()
        } catch (error: NativeExternalSceneIrException) {
            return error
        }
        fail("Expected NativeExternalSceneIrException")
        error("unreachable")
    }
}
