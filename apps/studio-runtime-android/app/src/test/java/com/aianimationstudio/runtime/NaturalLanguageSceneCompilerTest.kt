package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NaturalLanguageSceneCompilerTest {
    private val sourceCommit = "a".repeat(40)
    private val referenceSha = "b".repeat(64)
    private val actorId = "character-main"

    private fun compile(text: String, backend: NativeSceneSemanticBackend = NativeSupportedSubsetSemanticProbe) =
        NaturalLanguageSceneCompiler(backend).compile(
            NativeSceneSemanticRequest(
                originalText = text,
                sourceCommit = sourceCommit,
                referenceSha256 = referenceSha,
                actorId = actorId,
            ),
        )

    @Test
    fun `armenian natural wait compiles to executable versioned ir with exact provenance`() {
        val source = "Կերպարը հանգիստ սպասում է 24 վայրկյան։ Ելքը՝ 320×240, 12 կադր/վրկ։"
        val result = compile(source)

        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, result.status)
        val ir = assertNotNull(result.ir).let { requireNotNull(result.ir) }
        assertEquals(M57_SCENE_IR_SCHEMA_VERSION, ir.schemaVersion)
        assertEquals(NativeSceneLanguage.ARMENIAN, ir.detectedLanguage)
        assertEquals(source, ir.originalText)
        assertEquals(sourceCommit, ir.sourceCommit)
        assertEquals(referenceSha, ir.referenceSha256)
        assertEquals(NativeSceneCompilerSecurity.sha256(source), ir.scriptSha256)
        assertEquals(24.0, ir.output.durationSeconds, 0.0)
        assertEquals(320, ir.output.width)
        assertEquals(240, ir.output.height)
        assertEquals(12.0, ir.output.frameRate, 0.0)
        assertEquals(NativeSceneConcept.WAIT, ir.actions.single().concept)
        assertTrue(result.matchesIdentity(source, referenceSha, sourceCommit))
        assertFalse(result.matchesIdentity("$source փոփոխված", referenceSha, sourceCommit))
    }

    @Test
    fun `english and russian paraphrases resolve the same canonical wait concept`() {
        val english = compile("The character stands quietly and waits for 20 seconds.")
        val russian = compile("Персонаж спокойно ждёт 20 секунд.")

        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, english.status)
        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, russian.status)
        assertEquals(NativeSceneLanguage.ENGLISH, english.ir?.detectedLanguage)
        assertEquals(NativeSceneLanguage.RUSSIAN, russian.ir?.detectedLanguage)
        assertEquals(NativeSceneConcept.WAIT, english.ir?.actions?.single()?.concept)
        assertEquals(NativeSceneConcept.WAIT, russian.ir?.actions?.single()?.concept)
    }

    @Test
    fun `mixed language applies every present language recognizer and fails closed on unsupported intent`() {
        val result = compile("Կերպարը հանգիստ սպասում է, then opens the door for 20 seconds.")

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, result.status)
        val ir = requireNotNull(result.ir)
        assertEquals(NativeSceneLanguage.MIXED, ir.detectedLanguage)
        assertTrue(ir.actions.any { it.concept == NativeSceneConcept.WAIT })
        assertTrue(ir.actions.any { it.concept == NativeSceneConcept.OPEN })
        assertTrue(result.diagnostics.any { it.code == "UNSUPPORTED_CAPABILITY" && it.message.contains("OPEN") })
    }

    @Test
    fun `semantically understood interaction fails closed as unsupported capability`() {
        val result = compile("Կերպարը քայլում է դեպի պատուհանը և բացում է այն 24 վայրկյան։")

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, result.status)
        val ir = requireNotNull(result.ir)
        assertTrue(ir.actions.any { it.concept == NativeSceneConcept.WALK_TO })
        assertTrue(ir.actions.any { it.concept == NativeSceneConcept.OPEN })
        assertTrue(result.diagnostics.isNotEmpty())
        assertTrue(result.diagnostics.all { it.code == "UNSUPPORTED_CAPABILITY" })
    }

    @Test
    fun `camera lighting and environment intent is understood but never fabricated as executable`() {
        val result = compile("The camera zooms and the lighting dims while the background changes for 20 seconds.")

        assertEquals(NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY, result.status)
        val concepts = requireNotNull(result.ir).actions.map { it.concept }.toSet()
        assertTrue(NativeSceneConcept.CAMERA_MOVE in concepts)
        assertTrue(NativeSceneConcept.LIGHTING_CHANGE in concepts)
        assertTrue(NativeSceneConcept.ENVIRONMENT_CHANGE in concepts)
    }

    @Test
    fun `unresolved natural language is ambiguity not fabricated execution`() {
        val result = compile("Կերպարը հիշում է իր մանկությունը ու մտածում ապագայի մասին։")

        assertEquals(NativeSceneSemanticStatus.AMBIGUOUS_SEMANTICS, result.status)
        assertEquals(null, result.ir)
        assertTrue(result.diagnostics.any { it.code == "AMBIGUOUS_SEMANTICS" })
    }

    @Test
    fun `bounded backend failure category survives compiler boundary`() {
        val backend = NativeSceneSemanticBackend {
            throw NativeSceneBackendException(
                NativeSceneBackendFailureCategory.TIMEOUT,
                "fixture timeout",
            )
        }
        val result = compile("The character waits for 20 seconds.", backend)

        assertEquals(NativeSceneSemanticStatus.INVALID_SCHEMA, result.status)
        assertEquals(null, result.ir)
        assertTrue(result.diagnostics.any { it.code == NativeSceneBackendFailureCategory.TIMEOUT.diagnosticCode })
        assertFalse(result.diagnostics.any { it.code == "SCENE_BACKEND_FAILURE" })
    }

    @Test
    fun `network and executable directives are rejected before semantic backend`() {
        var backendCalled = false
        val backend = NativeSceneSemanticBackend {
            backendCalled = true
            error("must not run")
        }
        val result = compile("Կերպարը սպասում է։ Բացի այդ՝ https://example.com/script", backend)

        assertEquals(NativeSceneSemanticStatus.SECURITY_REJECTED, result.status)
        assertFalse(backendCalled)
        assertTrue(result.diagnostics.any { it.code == "SCENE_SECURITY_REJECTED" })
    }

    @Test
    fun `model document outside actor identity is invalid schema`() {
        val backend = NativeSceneSemanticBackend { request ->
            NativeSceneSemanticDocument(
                detectedLanguage = NativeSceneLanguage.ARMENIAN,
                normalizedText = request.originalText,
                provider = "fixture-provider",
                model = "fixture-model-v1",
                output = NativeSceneOutput(durationSeconds = 20.0),
                actions = listOf(
                    NativeSceneActionDraft(
                        concept = NativeSceneConcept.WAIT,
                        actorId = "invented-character",
                        sourceExcerpt = request.originalText,
                    ),
                ),
            )
        }
        val result = compile("Կերպարը սպասում է։", backend)

        assertEquals(NativeSceneSemanticStatus.INVALID_SCHEMA, result.status)
        assertTrue(result.diagnostics.any { it.code == "SCENE_UNKNOWN_ACTOR" })
    }

    @Test
    fun `oversized source is bounded before inference`() {
        var backendCalled = false
        val backend = NativeSceneSemanticBackend {
            backendCalled = true
            error("must not run")
        }
        val result = compile("ա".repeat(M57_MAX_SCRIPT_BYTES), backend)

        assertEquals(NativeSceneSemanticStatus.INVALID_SCHEMA, result.status)
        assertFalse(backendCalled)
        assertTrue(result.diagnostics.any { it.code == "SCENE_SOURCE_TOO_LARGE" })
    }

    @Test
    fun `executable ir lowers only to admitted deterministic legacy commands`() {
        val result = compile("Կերպարը հանգիստ սպասում է 24 վայրկյան։")
        val script = NativeSceneIrLowerer.lowerToLegacyDeterministicScript(requireNotNull(result.ir))

        assertTrue(script.lines().first().startsWith("# M57 Scene IR v1"))
        assertTrue(script.lines().contains("ACTOR WAIT"))
    }
}
