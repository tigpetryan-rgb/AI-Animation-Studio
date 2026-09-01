package com.aianimationstudio.runtime

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Locale

internal const val M57_SCENE_IR_SCHEMA_VERSION = 1
internal const val M57_MAX_SCRIPT_BYTES = 24 * 1024
internal const val M57_MAX_MODEL_ACTIONS = 64
internal const val M57_MAX_DIALOGUE_BYTES = 8 * 1024

internal enum class NativeSceneLanguage { ARMENIAN, ENGLISH, RUSSIAN, MIXED, UNKNOWN }

internal enum class NativeSceneSemanticStatus {
    VALID_EXECUTABLE,
    VALID_BUT_UNSUPPORTED_CAPABILITY,
    INVALID_SCHEMA,
    AMBIGUOUS_SEMANTICS,
    SECURITY_REJECTED,
}

internal enum class NativeSceneConcept {
    WAIT,
    SPEAK,
    REACT,
    SIT,
    STAND,
    WALK_TO,
    RUN_TO,
    LOOK_AT,
    PICK_UP,
    OPEN,
    CLOSE,
    CAMERA_MOVE,
    LIGHTING_CHANGE,
    ENVIRONMENT_CHANGE,
}

internal data class NativeSceneOutput(
    val width: Int = 1920,
    val height: Int = 1080,
    val frameRate: Double = 24.0,
    val durationSeconds: Double = 10.0,
)

internal data class NativeSceneAction(
    val id: String,
    val concept: NativeSceneConcept,
    val actorId: String,
    val targetId: String? = null,
    val text: String? = null,
    val startSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val sourceExcerpt: String,
)

internal data class NativeSceneIrV1(
    val schemaVersion: Int,
    val detectedLanguage: NativeSceneLanguage,
    val originalText: String,
    val normalizedText: String,
    val scriptSha256: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val semanticProvider: String,
    val semanticModel: String,
    val actorId: String,
    val output: NativeSceneOutput,
    val actions: List<NativeSceneAction>,
    val warnings: List<String> = emptyList(),
)

internal data class NativeSceneCompilation(
    val status: NativeSceneSemanticStatus,
    val ir: NativeSceneIrV1?,
    val diagnostics: List<NativeDiagnostic>,
) {
    val executable: Boolean get() = status == NativeSceneSemanticStatus.VALID_EXECUTABLE && ir != null

    fun matchesIdentity(script: String, referenceSha256: String, sourceCommit: String): Boolean {
        val current = ir ?: return false
        return current.scriptSha256 == NativeSceneCompilerSecurity.sha256(script) &&
            current.referenceSha256 == referenceSha256 &&
            current.sourceCommit == sourceCommit
    }
}

/**
 * Provider-neutral semantic boundary. A production provider must live behind a server/proxy boundary;
 * provider API secrets are never accepted by this Android interface and never belong in the APK.
 */
internal fun interface NativeSceneSemanticBackend {
    fun infer(request: NativeSceneSemanticRequest): NativeSceneSemanticDocument
}

internal data class NativeSceneSemanticRequest(
    val originalText: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val actorId: String,
)

internal data class NativeSceneSemanticDocument(
    val detectedLanguage: NativeSceneLanguage,
    val normalizedText: String,
    val provider: String,
    val model: String,
    val output: NativeSceneOutput,
    val actions: List<NativeSceneActionDraft>,
    val ambiguous: Boolean = false,
    val warnings: List<String> = emptyList(),
)

internal data class NativeSceneActionDraft(
    val concept: NativeSceneConcept,
    val actorId: String,
    val targetId: String? = null,
    val text: String? = null,
    val startSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val sourceExcerpt: String,
)

internal object NativeSceneCapabilityRegistry {
    private val executable = setOf(
        NativeSceneConcept.WAIT,
        NativeSceneConcept.SPEAK,
        NativeSceneConcept.REACT,
        NativeSceneConcept.SIT,
        NativeSceneConcept.STAND,
    )

    fun isExecutable(concept: NativeSceneConcept): Boolean = concept in executable

    fun unsupported(actions: List<NativeSceneAction>): Set<NativeSceneConcept> = actions
        .map { it.concept }
        .filterNot(::isExecutable)
        .toSet()
}

internal object NativeSceneCompilerSecurity {
    private val sha40 = Regex("^[0-9a-f]{40}$")
    private val sha256 = Regex("^[0-9a-f]{64}$")
    private val forbidden = listOf(
        Regex("(?i)javascript\\s*:"),
        Regex("(?i)file\\s*://"),
        Regex("(?i)https?\\s*://"),
        Regex("(?i)<\\s*script\\b"),
        Regex("(?i)\\b(?:curl|wget|powershell|cmd\\.exe|bash|sh)\\b\\s+[-/\\w]"),
        Regex("(?:^|[\\s'\"])(?:/etc/|/proc/|/system/|[A-Za-z]:\\\\|\\.\\./)"),
        Regex("(?i)\\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|API_SECRET)\\b"),
    )

    fun validateIdentity(sourceCommit: String, referenceSha256: String): List<NativeDiagnostic> = buildList {
        if (!sha40.matches(sourceCommit)) add(NativeDiagnostic("SCENE_SOURCE_IDENTITY", "Natural-language compilation requires the exact 40-character Studio source commit."))
        if (!sha256.matches(referenceSha256)) add(NativeDiagnostic("SCENE_REFERENCE_IDENTITY", "Natural-language compilation requires the exact 64-character reference SHA-256."))
    }

    fun inspect(text: String): List<NativeDiagnostic> = buildList {
        val bytes = text.toByteArray(StandardCharsets.UTF_8).size
        if (bytes == 0) add(NativeDiagnostic("SCENE_EMPTY_SOURCE", "Natural-language scene source is empty."))
        if (bytes > M57_MAX_SCRIPT_BYTES) add(NativeDiagnostic("SCENE_SOURCE_TOO_LARGE", "Natural-language scene source exceeds the bounded ${M57_MAX_SCRIPT_BYTES}-byte input limit."))
        forbidden.firstOrNull { it.containsMatchIn(text) }?.let {
            add(NativeDiagnostic("SCENE_SECURITY_REJECTED", "Scene text contains a forbidden code/network/file-system directive; semantic input is data only."))
        }
    }

    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(Locale.ROOT, byte.toInt() and 0xff) }
}

internal class NaturalLanguageSceneCompiler(
    private val backend: NativeSceneSemanticBackend,
) {
    fun compile(request: NativeSceneSemanticRequest): NativeSceneCompilation {
        val preflight = NativeSceneCompilerSecurity.validateIdentity(request.sourceCommit, request.referenceSha256) +
            NativeSceneCompilerSecurity.inspect(request.originalText)
        if (preflight.isNotEmpty()) {
            val status = if (preflight.any { it.code == "SCENE_SECURITY_REJECTED" }) {
                NativeSceneSemanticStatus.SECURITY_REJECTED
            } else {
                NativeSceneSemanticStatus.INVALID_SCHEMA
            }
            return NativeSceneCompilation(status, null, preflight)
        }
        if (request.actorId.isBlank()) {
            return NativeSceneCompilation(
                NativeSceneSemanticStatus.INVALID_SCHEMA,
                null,
                listOf(NativeDiagnostic("SCENE_ACTOR_IDENTITY", "Natural-language compilation requires a stable actor identity.")),
            )
        }

        val document = runCatching { backend.infer(request) }.getOrElse { failure ->
            return NativeSceneCompilation(
                NativeSceneSemanticStatus.INVALID_SCHEMA,
                null,
                listOf(NativeDiagnostic("SCENE_BACKEND_FAILURE", "Semantic backend failed closed: ${failure.message ?: failure::class.java.simpleName}.")),
            )
        }
        if (document.ambiguous) {
            return NativeSceneCompilation(
                NativeSceneSemanticStatus.AMBIGUOUS_SEMANTICS,
                null,
                listOf(NativeDiagnostic("AMBIGUOUS_SEMANTICS", "Semantic backend could not resolve the scene without inventing intent.")),
            )
        }

        val diagnostics = validateDocument(request, document)
        if (diagnostics.isNotEmpty()) {
            return NativeSceneCompilation(NativeSceneSemanticStatus.INVALID_SCHEMA, null, diagnostics)
        }

        val ir = NativeSceneIrV1(
            schemaVersion = M57_SCENE_IR_SCHEMA_VERSION,
            detectedLanguage = document.detectedLanguage,
            originalText = request.originalText,
            normalizedText = document.normalizedText,
            scriptSha256 = NativeSceneCompilerSecurity.sha256(request.originalText),
            sourceCommit = request.sourceCommit,
            referenceSha256 = request.referenceSha256,
            semanticProvider = document.provider,
            semanticModel = document.model,
            actorId = request.actorId,
            output = document.output,
            actions = document.actions.mapIndexed { index, action ->
                NativeSceneAction(
                    id = "scene_action_${index + 1}",
                    concept = action.concept,
                    actorId = action.actorId,
                    targetId = action.targetId,
                    text = action.text,
                    startSeconds = action.startSeconds,
                    durationSeconds = action.durationSeconds,
                    sourceExcerpt = action.sourceExcerpt,
                )
            },
            warnings = document.warnings,
        )

        val unsupported = NativeSceneCapabilityRegistry.unsupported(ir.actions)
        if (unsupported.isNotEmpty()) {
            return NativeSceneCompilation(
                NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY,
                ir,
                unsupported.sortedBy { it.name }.map { concept ->
                    NativeDiagnostic("UNSUPPORTED_CAPABILITY", "Scene concept ${concept.name} is semantically valid but is not executable by the current source-bound M56 renderer/performance capability set.")
                },
            )
        }
        return NativeSceneCompilation(
            NativeSceneSemanticStatus.VALID_EXECUTABLE,
            ir,
            listOf(NativeDiagnostic("SCENE_IR_VALID", "Versioned Scene IR passed identity, schema, semantic and executable-capability validation.")),
        )
    }

    private fun validateDocument(
        request: NativeSceneSemanticRequest,
        document: NativeSceneSemanticDocument,
    ): List<NativeDiagnostic> = buildList {
        if (document.provider.isBlank() || document.model.isBlank()) add(NativeDiagnostic("SCENE_MODEL_PROVENANCE", "Semantic provider/model provenance is required."))
        if (document.normalizedText.isBlank()) add(NativeDiagnostic("SCENE_NORMALIZED_SOURCE", "Semantic backend returned an empty normalized scene."))
        if (document.detectedLanguage == NativeSceneLanguage.UNKNOWN) add(NativeDiagnostic("SCENE_LANGUAGE_UNKNOWN", "Semantic backend must identify Armenian, English, Russian or a mixed-language scene."))
        if (document.actions.isEmpty()) add(NativeDiagnostic("SCENE_NO_ACTIONS", "Semantic backend returned no canonical scene actions."))
        if (document.actions.size > M57_MAX_MODEL_ACTIONS) add(NativeDiagnostic("SCENE_TOO_MANY_ACTIONS", "Semantic backend exceeded the bounded $M57_MAX_MODEL_ACTIONS-action scene limit."))

        val output = document.output
        if (output.width !in 64..8192 || output.height !in 64..8192) add(NativeDiagnostic("SCENE_INVALID_RESOLUTION", "Scene output must be between 64 and 8192 pixels per side."))
        if (!output.frameRate.isFinite() || output.frameRate !in 1.0..120.0) add(NativeDiagnostic("SCENE_INVALID_FPS", "Scene frame rate must be between 1 and 120 fps."))
        if (!output.durationSeconds.isFinite() || output.durationSeconds !in 0.1..3600.0) add(NativeDiagnostic("SCENE_INVALID_DURATION", "Scene duration must be between 0.1 and 3600 seconds."))

        var dialogueBytes = 0
        document.actions.forEachIndexed { index, action ->
            if (action.actorId != request.actorId) add(NativeDiagnostic("SCENE_UNKNOWN_ACTOR", "Action ${index + 1} references an actor outside the exact admitted reference identity."))
            if (action.sourceExcerpt.isBlank()) add(NativeDiagnostic("SCENE_MISSING_PROVENANCE", "Action ${index + 1} has no source-text provenance excerpt."))
            if (action.startSeconds != null && (!action.startSeconds.isFinite() || action.startSeconds < 0.0 || action.startSeconds > output.durationSeconds)) {
                add(NativeDiagnostic("SCENE_ACTION_TIME_RANGE", "Action ${index + 1} start time is outside the scene duration."))
            }
            if (action.durationSeconds != null && (!action.durationSeconds.isFinite() || action.durationSeconds < 0.0 || action.durationSeconds > output.durationSeconds)) {
                add(NativeDiagnostic("SCENE_ACTION_DURATION_RANGE", "Action ${index + 1} duration is outside the scene duration."))
            }
            action.text?.let { text ->
                dialogueBytes += text.toByteArray(StandardCharsets.UTF_8).size
                if (NativeSceneCompilerSecurity.inspect(text).any { it.code == "SCENE_SECURITY_REJECTED" }) {
                    add(NativeDiagnostic("SCENE_DIALOGUE_SECURITY", "Dialogue text contains a forbidden executable/network/file-system directive."))
                }
            }
        }
        if (dialogueBytes > M57_MAX_DIALOGUE_BYTES) add(NativeDiagnostic("SCENE_DIALOGUE_TOO_LARGE", "Scene dialogue exceeds the bounded $M57_MAX_DIALOGUE_BYTES-byte limit."))
    }
}

/**
 * Bounded, offline semantic probe used for deterministic CI and physical supported-subset proof.
 * It is deliberately not presented as broad language understanding or Runway parity. Production
 * breadth must be supplied through the NativeSceneSemanticBackend server boundary above.
 */
internal object NativeSupportedSubsetSemanticProbe : NativeSceneSemanticBackend {
    private val resolution = Regex("(\\d{2,5})\\s*[x×х]\\s*(\\d{2,5})", RegexOption.IGNORE_CASE)
    private val fps = Regex("(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:fps|կադր\\s*/\\s*վրկ|кадр(?:ов)?\\s*/\\s*с)", RegexOption.IGNORE_CASE)
    private val duration = Regex("(\\d{1,5}(?:[.,]\\d+)?)\\s*(?:seconds?|secs?|sec|վայրկյան(?:անոց)?|վրկ|секунд(?:а|ы)?|сек)", RegexOption.IGNORE_CASE)
    private val armenianSpeech = Regex("(?<![\\p{L}\\p{M}])(?:ասում|խոսում|արտասանում|արտասանել)(?![\\p{L}\\p{M}])")

    override fun infer(request: NativeSceneSemanticRequest): NativeSceneSemanticDocument {
        val original = request.originalText
        val normalized = original.trim().replace(Regex("\\s+"), " ")
        val language = detectLanguage(normalized)
        val output = NativeSceneOutput(
            width = resolution.find(normalized)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 1920,
            height = resolution.find(normalized)?.groupValues?.getOrNull(2)?.toIntOrNull() ?: 1080,
            frameRate = number(normalized, fps) ?: 24.0,
            durationSeconds = number(normalized, duration) ?: 10.0,
        )
        val actions = inferActions(normalized, language, request.actorId)
        return NativeSceneSemanticDocument(
            detectedLanguage = language,
            normalizedText = normalized,
            provider = "LOCAL_SUPPORTED_SUBSET",
            model = "m57-semantic-probe-v1",
            output = output,
            actions = actions,
            ambiguous = actions.isEmpty(),
            warnings = listOf("Offline supported-subset probe; broad multilingual semantics require a secure model backend."),
        )
    }

    private fun inferActions(text: String, language: NativeSceneLanguage, actorId: String): List<NativeSceneActionDraft> {
        val lower = text.lowercase(Locale.ROOT)
        val actions = mutableListOf<NativeSceneActionDraft>()
        fun add(concept: NativeSceneConcept, excerpt: String = text, dialogue: String? = null, target: String? = null) {
            if (actions.none { it.concept == concept && it.text == dialogue }) {
                actions += NativeSceneActionDraft(concept, actorId, targetId = target, text = dialogue, sourceExcerpt = excerpt.take(512))
            }
        }

        when (language) {
            NativeSceneLanguage.ARMENIAN, NativeSceneLanguage.MIXED -> {
                if (Regex("(?:սպաս|հանգիստ\\s+(?:մն|կանգ)|անշարժ)").containsMatchIn(lower)) add(NativeSceneConcept.WAIT)
                if (Regex("(?:նստ|նստում)").containsMatchIn(lower)) add(NativeSceneConcept.SIT)
                if (Regex("(?:զարմ|արձագանք)").containsMatchIn(lower)) add(NativeSceneConcept.REACT)
                if (armenianSpeech.containsMatchIn(lower)) add(NativeSceneConcept.SPEAK, dialogue = quotedDialogue(text))
                if (Regex("(?:քայլ|մոտեն|գնում\\s+է)").containsMatchIn(lower)) add(NativeSceneConcept.WALK_TO, target = "semantic-target")
                if (Regex("(?:վազ|վազում)").containsMatchIn(lower)) add(NativeSceneConcept.RUN_TO, target = "semantic-target")
                if (Regex("(?:վերցն|վերցնում)").containsMatchIn(lower)) add(NativeSceneConcept.PICK_UP, target = "semantic-target")
                if (Regex("(?:բաց|բացում)").containsMatchIn(lower)) add(NativeSceneConcept.OPEN, target = "semantic-target")
                if (Regex("(?:փակ|փակում)").containsMatchIn(lower)) add(NativeSceneConcept.CLOSE, target = "semantic-target")
            }
            NativeSceneLanguage.ENGLISH -> {
                if (Regex("\\b(?:wait|waits|waiting|remain still|stands quietly)\\b").containsMatchIn(lower)) add(NativeSceneConcept.WAIT)
                if (Regex("\\b(?:sit|sits|sitting)\\b").containsMatchIn(lower)) add(NativeSceneConcept.SIT)
                if (Regex("\\b(?:react|reacts|surprised)\\b").containsMatchIn(lower)) add(NativeSceneConcept.REACT)
                if (Regex("\\b(?:say|says|speak|speaks)\\b").containsMatchIn(lower)) add(NativeSceneConcept.SPEAK, dialogue = quotedDialogue(text))
                if (Regex("\\b(?:walk|walks|approach|approaches)\\b").containsMatchIn(lower)) add(NativeSceneConcept.WALK_TO, target = "semantic-target")
                if (Regex("\\b(?:run|runs)\\b").containsMatchIn(lower)) add(NativeSceneConcept.RUN_TO, target = "semantic-target")
                if (Regex("\\b(?:pick up|picks up)\\b").containsMatchIn(lower)) add(NativeSceneConcept.PICK_UP, target = "semantic-target")
                if (Regex("\\b(?:open|opens)\\b").containsMatchIn(lower)) add(NativeSceneConcept.OPEN, target = "semantic-target")
                if (Regex("\\b(?:close|closes)\\b").containsMatchIn(lower)) add(NativeSceneConcept.CLOSE, target = "semantic-target")
            }
            NativeSceneLanguage.RUSSIAN -> {
                if (Regex("(?:жд[её]т|ожидает|стоит\\s+спокойно|неподвижно)").containsMatchIn(lower)) add(NativeSceneConcept.WAIT)
                if (Regex("(?:садится|сидит)").containsMatchIn(lower)) add(NativeSceneConcept.SIT)
                if (Regex("(?:реагирует|удивля)").containsMatchIn(lower)) add(NativeSceneConcept.REACT)
                if (Regex("(?:говорит|произносит|скажет)").containsMatchIn(lower)) add(NativeSceneConcept.SPEAK, dialogue = quotedDialogue(text))
                if (Regex("(?:ид[её]т|подходит|шагает)").containsMatchIn(lower)) add(NativeSceneConcept.WALK_TO, target = "semantic-target")
                if (Regex("(?:бежит|побежит)").containsMatchIn(lower)) add(NativeSceneConcept.RUN_TO, target = "semantic-target")
                if (Regex("(?:бер[её]т|поднимает)").containsMatchIn(lower)) add(NativeSceneConcept.PICK_UP, target = "semantic-target")
                if (Regex("(?:открывает|открыть)").containsMatchIn(lower)) add(NativeSceneConcept.OPEN, target = "semantic-target")
                if (Regex("(?:закрывает|закрыть)").containsMatchIn(lower)) add(NativeSceneConcept.CLOSE, target = "semantic-target")
            }
            NativeSceneLanguage.UNKNOWN -> Unit
        }
        return actions
    }

    private fun quotedDialogue(text: String): String? {
        val patterns = listOf(
            Regex("[\"“”«»](.{1,512}?)[\"“”«»]"),
            Regex("՝\\s*([^։.!?]{1,512})"),
            Regex(":\\s*([^.!?]{1,512})"),
        )
        return patterns.asSequence().mapNotNull { it.find(text)?.groupValues?.getOrNull(1)?.trim() }.firstOrNull { it.isNotBlank() }
    }

    private fun detectLanguage(text: String): NativeSceneLanguage {
        val armenian = text.count { it.code in 0x0530..0x058F }
        val cyrillic = text.count { it.code in 0x0400..0x04FF }
        val latin = text.count { it in 'A'..'Z' || it in 'a'..'z' }
        val present = listOf(armenian > 0, cyrillic > 0, latin > 0).count { it }
        return when {
            present > 1 -> NativeSceneLanguage.MIXED
            armenian > 0 -> NativeSceneLanguage.ARMENIAN
            cyrillic > 0 -> NativeSceneLanguage.RUSSIAN
            latin > 0 -> NativeSceneLanguage.ENGLISH
            else -> NativeSceneLanguage.UNKNOWN
        }
    }

    private fun number(source: String, regex: Regex): Double? = regex.find(source)
        ?.groupValues
        ?.getOrNull(1)
        ?.replace(',', '.')
        ?.toDoubleOrNull()
}

internal object NativeSceneIrLowerer {
    fun lowerToLegacyDeterministicScript(ir: NativeSceneIrV1): String {
        require(NativeSceneCapabilityRegistry.unsupported(ir.actions).isEmpty()) { "Unsupported Scene IR cannot be lowered into executable legacy story commands." }
        val output = ir.output
        val lines = mutableListOf(
            "# M57 Scene IR v${ir.schemaVersion} ${output.durationSeconds} seconds ${output.width}x${output.height} ${output.frameRate} fps",
        )
        ir.actions.forEach { action ->
            when (action.concept) {
                NativeSceneConcept.WAIT -> lines += "ACTOR WAIT"
                NativeSceneConcept.SPEAK -> lines += "ACTOR SPEAK ${sanitizeLegacyText(action.text ?: "")}".trimEnd()
                NativeSceneConcept.REACT -> lines += "ACTOR REACT"
                NativeSceneConcept.SIT -> lines += "ACTOR SIT"
                NativeSceneConcept.STAND -> lines += "ACTOR STAND"
                else -> error("Unsupported Scene IR concept reached deterministic lowerer: ${action.concept}")
            }
        }
        return lines.joinToString("\n")
    }

    private fun sanitizeLegacyText(value: String): String = value
        .replace(Regex("[\\r\\n]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
        .take(1024)
}
