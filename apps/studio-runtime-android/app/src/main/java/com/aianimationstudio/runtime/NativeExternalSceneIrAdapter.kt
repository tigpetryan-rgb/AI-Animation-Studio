package com.aianimationstudio.runtime

import java.nio.charset.StandardCharsets
import java.util.Locale
import kotlin.math.abs

private const val M57_MAX_EXTERNAL_RESPONSE_BYTES = M57_MAX_SCRIPT_BYTES * 4
private const val M57_MAX_JSON_DEPTH = 24
private const val M57_EXTERNAL_TIMING_EPSILON_SECONDS = 0.001

internal class NativeExternalSceneIrException(
    val diagnosticCode: String,
    message: String,
) : IllegalArgumentException(message)

/**
 * Raw structured response boundary for a controlled server-side semantic compiler/proxy.
 *
 * The provider response is treated as untrusted data. Unknown or duplicate JSON fields, identity
 * drift, invalid values, unresolved references and unsupported capability names are rejected before
 * a NativeSceneSemanticDocument can reach the compiler. The adapter intentionally narrows the
 * canonical docs/m57/scene-ir-v1.schema.json contract to the currently executable native surface.
 */
internal object NativeExternalSceneIrV1Adapter {
    fun decode(
        response: String,
        request: NativeSceneSemanticRequest,
        expectedRequestId: String? = null,
    ): NativeSceneSemanticDocument {
        val responseBytes = response.toByteArray(StandardCharsets.UTF_8).size
        if (responseBytes <= 0 || responseBytes > M57_MAX_EXTERNAL_RESPONSE_BYTES) {
            reject("SCENE_EXTERNAL_RESPONSE_SIZE", "External Scene IR response exceeds the bounded response-size contract.")
        }
        val root = StrictJsonParser(response).parse().asObject("$")
        root.requireShape(
            path = "$",
            required = setOf(
                "scene_ir_version",
                "source",
                "project_id",
                "scene_id",
                "entities",
                "shots",
                "output",
                "required_capabilities",
                "warnings",
                "unresolved_terms",
            ),
            optional = setOf("continuity", "lighting", "environment"),
        )
        if (root.int("scene_ir_version", "$") != M57_SCENE_IR_SCHEMA_VERSION) {
            reject("SCENE_EXTERNAL_SCHEMA_VERSION", "External Scene IR must use scene_ir_version=$M57_SCENE_IR_SCHEMA_VERSION.")
        }
        stableId(root.string("project_id", "$"), "$.project_id")
        stableId(root.string("scene_id", "$"), "$.scene_id")

        val source = root.objectValue("source", "$")
        source.requireShape(
            "$.source",
            required = setOf(
                "language",
                "original_text",
                "normalized_text",
                "script_sha256",
                "build_sha",
                "reference_sha256",
                "provider",
                "model",
                "request_id",
            ),
        )
        val originalText = boundedString(source.string("original_text", "$.source"), 1, M57_MAX_SCRIPT_BYTES, "$.source.original_text")
        val normalizedText = boundedString(source.string("normalized_text", "$.source"), 1, M57_MAX_SCRIPT_BYTES, "$.source.normalized_text")
        val buildSha = source.string("build_sha", "$.source")
        val referenceSha = source.string("reference_sha256", "$.source")
        val scriptSha = source.string("script_sha256", "$.source")
        val provider = boundedString(source.string("provider", "$.source"), 1, 128, "$.source.provider")
        val model = boundedString(source.string("model", "$.source"), 1, 128, "$.source.model")
        val requestId = boundedString(source.string("request_id", "$.source"), 1, 128, "$.source.request_id")
        if (originalText != request.originalText) reject("SCENE_EXTERNAL_SCRIPT_IDENTITY", "External Scene IR original_text does not match the submitted script bytes.")
        if (scriptSha != NativeSceneCompilerSecurity.sha256(request.originalText)) reject("SCENE_EXTERNAL_SCRIPT_IDENTITY", "External Scene IR script_sha256 does not match the submitted script.")
        if (buildSha != request.sourceCommit) reject("SCENE_EXTERNAL_BUILD_IDENTITY", "External Scene IR build_sha does not match the exact native source commit.")
        if (referenceSha != request.referenceSha256) reject("SCENE_EXTERNAL_REFERENCE_IDENTITY", "External Scene IR reference_sha256 does not match the admitted exact reference.")
        if (expectedRequestId != null && requestId != expectedRequestId) reject("SCENE_EXTERNAL_REQUEST_IDENTITY", "External Scene IR request_id does not match the controlled proxy request.")
        val language = enumValue<NativeSceneLanguage>(source.string("language", "$.source"), "$.source.language")
        if (language == NativeSceneLanguage.UNKNOWN) reject("SCENE_EXTERNAL_LANGUAGE", "External Scene IR cannot use UNKNOWN language.")

        val entities = root.arrayValue("entities", "$").values
        if (entities.isEmpty() || entities.size > 64) reject("SCENE_EXTERNAL_ENTITIES", "External Scene IR must contain 1..64 entities.")
        var exactActorPresent = false
        entities.forEachIndexed { index, value ->
            val path = "$.entities[$index]"
            val entity = value.asObject(path)
            entity.requireShape(path, required = setOf("id", "kind", "source_bound"), optional = setOf("aliases", "material", "color"))
            val id = stableId(entity.string("id", path), "$path.id")
            val kind = entity.string("kind", path)
            if (kind !in setOf("ACTOR", "OBJECT", "LOCATION")) reject("SCENE_EXTERNAL_ENTITY_KIND", "$path.kind is not an admitted entity kind.")
            val sourceBound = entity.boolean("source_bound", path)
            entity.optionalArray("aliases", path)?.let { aliases ->
                if (aliases.values.size > 32) reject("SCENE_EXTERNAL_ENTITIES", "$path.aliases exceeds 32 entries.")
                aliases.values.forEachIndexed { aliasIndex, alias -> boundedString(alias.asString("$path.aliases[$aliasIndex]"), 0, 128, "$path.aliases[$aliasIndex]") }
            }
            entity.optionalNullableString("material", path)?.let { boundedString(it, 0, 128, "$path.material") }
            entity.optionalNullableString("color", path)?.let { boundedString(it, 0, 128, "$path.color") }
            if (kind == "ACTOR" && sourceBound && id == request.actorId) exactActorPresent = true
        }
        if (!exactActorPresent) reject("SCENE_EXTERNAL_ACTOR_IDENTITY", "External Scene IR does not contain the exact admitted source-bound actor identity.")

        val outputObject = root.objectValue("output", "$")
        outputObject.requireShape("$.output", required = setOf("width", "height", "fps", "duration_seconds"), optional = setOf("aspect"))
        val output = NativeSceneOutput(
            width = outputObject.int("width", "$.output").also { if (it !in 64..8192) reject("SCENE_EXTERNAL_OUTPUT", "$.output.width is outside 64..8192.") },
            height = outputObject.int("height", "$.output").also { if (it !in 64..8192) reject("SCENE_EXTERNAL_OUTPUT", "$.output.height is outside 64..8192.") },
            frameRate = outputObject.number("fps", "$.output").also { if (!it.isFinite() || it !in 1.0..120.0) reject("SCENE_EXTERNAL_OUTPUT", "$.output.fps is outside 1..120.") },
            durationSeconds = outputObject.number("duration_seconds", "$.output").also { if (!it.isFinite() || it <= 0.0 || it > 3600.0) reject("SCENE_EXTERNAL_OUTPUT", "$.output.duration_seconds is outside (0, 3600].") },
        )
        outputObject.optionalNullableString("aspect", "$.output")?.let { boundedString(it, 0, 32, "$.output.aspect") }

        val topCapabilities = capabilityArray(root.arrayValue("required_capabilities", "$"), "$.required_capabilities", 128)
        val warnings = stringArray(root.arrayValue("warnings", "$"), "$.warnings", 64, 512)
        val unresolved = root.arrayValue("unresolved_terms", "$")
        if (unresolved.values.size > 64) reject("SCENE_EXTERNAL_UNRESOLVED", "$.unresolved_terms exceeds 64 entries.")
        unresolved.values.forEachIndexed { index, value ->
            val path = "$.unresolved_terms[$index]"
            val item = value.asObject(path)
            item.requireShape(path, required = setOf("source_excerpt", "reason"))
            boundedString(item.string("source_excerpt", path), 1, 512, "$path.source_excerpt")
            boundedString(item.string("reason", path), 1, 512, "$path.reason")
        }

        root.optionalArray("continuity", "$")?.let { continuity ->
            if (continuity.values.size > 128) reject("SCENE_EXTERNAL_CONTINUITY", "$.continuity exceeds 128 entries.")
            continuity.values.forEachIndexed { index, value ->
                val path = "$.continuity[$index]"
                val item = value.asObject(path)
                item.requireShape(path, required = setOf("entity_id", "rule"))
                stableId(item.string("entity_id", path), "$path.entity_id")
                boundedString(item.string("rule", path), 1, 512, "$path.rule")
            }
        }

        var lightingRequested = false
        root.optionalObject("lighting", "$")?.let { lighting ->
            lighting.requireShape("$.lighting", required = emptySet(), optional = setOf("intent", "time_of_day"))
            val intent = lighting.optionalNullableString("intent", "$.lighting")?.let { boundedString(it, 0, 256, "$.lighting.intent") }
            val time = lighting.optionalNullableString("time_of_day", "$.lighting")?.let { boundedString(it, 0, 128, "$.lighting.time_of_day") }
            lightingRequested = !intent.isNullOrBlank() || !time.isNullOrBlank()
        }
        var environmentRequested = false
        root.optionalObject("environment", "$")?.let { environment ->
            environment.requireShape("$.environment", required = emptySet(), optional = setOf("location_intent", "weather"))
            val location = environment.optionalNullableString("location_intent", "$.environment")?.let { boundedString(it, 0, 256, "$.environment.location_intent") }
            val weather = environment.optionalNullableString("weather", "$.environment")?.let { boundedString(it, 0, 128, "$.environment.weather") }
            environmentRequested = !location.isNullOrBlank() || !weather.isNullOrBlank()
        }

        val shots = root.arrayValue("shots", "$").values
        if (shots.isEmpty() || shots.size > M57_MAX_SHOTS) reject("SCENE_EXTERNAL_SHOTS", "External Scene IR must contain 1..$M57_MAX_SHOTS shots.")
        val actionDrafts = mutableListOf<NativeSceneActionDraft>()
        val actionIds = mutableSetOf<String>()
        val seenShotIds = mutableSetOf<String>()
        var previousEnd = 0.0
        var unsupportedCameraPlan = shots.size != 1
        val actionConcepts = mutableSetOf<NativeSceneConcept>()
        val declaredCapabilities = topCapabilities.toMutableSet()

        shots.forEachIndexed { shotIndex, value ->
            val path = "$.shots[$shotIndex]"
            val shot = value.asObject(path)
            shot.requireShape(path, required = setOf("id", "start_seconds", "duration_seconds", "camera", "actions"))
            val shotId = stableId(shot.string("id", path), "$path.id")
            if (!seenShotIds.add(shotId)) reject("SCENE_EXTERNAL_SHOT_ID", "Duplicate shot id $shotId.")
            val start = shot.number("start_seconds", path)
            val duration = shot.number("duration_seconds", path)
            if (!start.isFinite() || start < 0.0 || start > 3600.0) reject("SCENE_EXTERNAL_TIMELINE", "$path.start_seconds is invalid.")
            if (!duration.isFinite() || duration <= 0.0 || duration > 3600.0) reject("SCENE_EXTERNAL_TIMELINE", "$path.duration_seconds is invalid.")
            if (shotIndex == 0 && abs(start) > M57_EXTERNAL_TIMING_EPSILON_SECONDS) reject("SCENE_EXTERNAL_TIMELINE", "External timeline must begin at 0 seconds.")
            if (shotIndex > 0 && abs(start - previousEnd) > M57_EXTERNAL_TIMING_EPSILON_SECONDS) reject("SCENE_EXTERNAL_TIMELINE", "External shots must be contiguous without gaps or overlaps.")
            previousEnd = start + duration

            val camera = shot.objectValue("camera", path)
            camera.requireShape("$path.camera", required = setOf("shot_size", "angle", "movement", "focus_target_id"), optional = setOf("lens_mm"))
            val shotSize = enumValue<NativeCameraShotSize>(camera.string("shot_size", "$path.camera"), "$path.camera.shot_size")
            val angle = enumValue<NativeCameraAngle>(camera.string("angle", "$path.camera"), "$path.camera.angle")
            val movement = enumValue<NativeCameraMovement>(camera.string("movement", "$path.camera"), "$path.camera.movement")
            val focus = stableId(camera.string("focus_target_id", "$path.camera"), "$path.camera.focus_target_id")
            camera.optionalNullableNumber("lens_mm", "$path.camera")?.let { lens -> if (!lens.isFinite() || lens !in 8.0..600.0) reject("SCENE_EXTERNAL_CAMERA", "$path.camera.lens_mm is outside 8..600.") }
            if (focus != request.actorId) reject("SCENE_EXTERNAL_CAMERA_TARGET", "External camera focus must remain bound to the admitted actor identity.")
            if (shotSize != NativeCameraShotSize.FULL || angle != NativeCameraAngle.EYE_LEVEL || movement != NativeCameraMovement.LOCKED) unsupportedCameraPlan = true

            val actions = shot.arrayValue("actions", path)
            if (actions.values.size > M57_MAX_TIMELINE_EVENTS) reject("SCENE_EXTERNAL_ACTIONS", "$path.actions exceeds $M57_MAX_TIMELINE_EVENTS entries.")
            actions.values.forEachIndexed { actionIndex, actionValue ->
                val actionPath = "$path.actions[$actionIndex]"
                val action = actionValue.asObject(actionPath)
                action.requireShape(
                    actionPath,
                    required = setOf("id", "concept", "actor_id", "source_excerpt", "required_capabilities"),
                    optional = setOf(
                        "target_id",
                        "start_seconds",
                        "duration_seconds",
                        "emotion",
                        "expression",
                        "pose",
                        "gesture",
                        "spatial_relation",
                        "dialogue",
                    ),
                )
                val actionId = stableId(action.string("id", actionPath), "$actionPath.id")
                if (!actionIds.add(actionId)) reject("SCENE_EXTERNAL_ACTION_ID", "Duplicate action id $actionId.")
                val concept = enumValue<NativeSceneConcept>(action.string("concept", actionPath), "$actionPath.concept")
                actionConcepts += concept
                val actorId = stableId(action.string("actor_id", actionPath), "$actionPath.actor_id")
                if (actorId != request.actorId) reject("SCENE_EXTERNAL_ACTOR_IDENTITY", "$actionPath.actor_id is outside the admitted exact actor identity.")
                val targetId = action.optionalNullableString("target_id", actionPath)?.let { stableId(it, "$actionPath.target_id") }
                val actionStart = action.optionalNullableNumber("start_seconds", actionPath)
                val actionDuration = action.optionalNullableNumber("duration_seconds", actionPath)
                if (actionStart != null && (!actionStart.isFinite() || actionStart < 0.0 || actionStart > output.durationSeconds)) reject("SCENE_EXTERNAL_ACTION_TIME", "$actionPath.start_seconds is outside scene duration.")
                if (actionDuration != null && (!actionDuration.isFinite() || actionDuration < 0.0 || actionDuration > output.durationSeconds)) reject("SCENE_EXTERNAL_ACTION_TIME", "$actionPath.duration_seconds is outside scene duration.")
                listOf("emotion", "expression", "pose", "gesture").forEach { key -> action.optionalNullableString(key, actionPath)?.let { boundedString(it, 0, 128, "$actionPath.$key") } }
                action.optionalNullableString("spatial_relation", actionPath)?.let { boundedString(it, 0, 256, "$actionPath.spatial_relation") }
                val sourceExcerpt = boundedString(action.string("source_excerpt", actionPath), 1, 512, "$actionPath.source_excerpt")
                val actionCapabilities = capabilityArray(action.arrayValue("required_capabilities", actionPath), "$actionPath.required_capabilities", 32)
                declaredCapabilities += actionCapabilities
                val dialogue = action.optionalValue("dialogue")?.let { dialogueValue ->
                    if (dialogueValue === JsonValue.Null) null else {
                        val dialoguePath = "$actionPath.dialogue"
                        val dialogueObject = dialogueValue.asObject(dialoguePath)
                        dialogueObject.requireShape(dialoguePath, required = setOf("text", "intent"), optional = setOf("narration"))
                        val text = boundedString(dialogueObject.string("text", dialoguePath), 0, M57_MAX_DIALOGUE_BYTES, "$dialoguePath.text")
                        boundedString(dialogueObject.string("intent", dialoguePath), 0, 256, "$dialoguePath.intent")
                        dialogueObject.optionalBoolean("narration", dialoguePath)
                        text
                    }
                }
                actionDrafts += NativeSceneActionDraft(
                    concept = concept,
                    actorId = actorId,
                    targetId = targetId,
                    text = dialogue,
                    startSeconds = actionStart,
                    durationSeconds = actionDuration,
                    sourceExcerpt = sourceExcerpt,
                )
            }
        }
        if (abs(previousEnd - output.durationSeconds) > M57_EXTERNAL_TIMING_EPSILON_SECONDS) reject("SCENE_EXTERNAL_TIMELINE", "External shot timeline does not exactly preserve output.duration_seconds.")
        if (actionDrafts.isEmpty()) reject("SCENE_EXTERNAL_ACTIONS", "External Scene IR contains no actions.")
        if (actionDrafts.size > M57_MAX_MODEL_ACTIONS) reject("SCENE_EXTERNAL_ACTIONS", "External Scene IR exceeds the bounded $M57_MAX_MODEL_ACTIONS semantic-action limit.")

        declaredCapabilities.forEach { capability ->
            val concept = runCatching { NativeSceneConcept.valueOf(capability.uppercase(Locale.ROOT)) }.getOrNull()
                ?: reject("SCENE_EXTERNAL_UNKNOWN_CAPABILITY", "External required capability '$capability' is not known by the current native capability registry.")
            if (concept !in actionConcepts) reject("SCENE_EXTERNAL_CAPABILITY_MISMATCH", "External required capability '$capability' has no corresponding canonical action.")
        }

        fun appendUnsupported(concept: NativeSceneConcept, reason: String) {
            if (actionDrafts.none { it.concept == concept }) {
                actionDrafts += NativeSceneActionDraft(
                    concept = concept,
                    actorId = request.actorId,
                    sourceExcerpt = request.originalText.take(512),
                )
            }
            if (reason !in warnings) {
                // Local copy is used below; canonical warnings remain bounded separately.
            }
        }
        val adapterWarnings = warnings.toMutableList()
        if (unsupportedCameraPlan) {
            appendUnsupported(NativeSceneConcept.CAMERA_MOVE, "External camera/multi-shot plan is outside the currently verified native camera mapping.")
            adapterWarnings += "External camera/multi-shot plan requires an unsupported current native capability."
        }
        if (lightingRequested) {
            appendUnsupported(NativeSceneConcept.LIGHTING_CHANGE, "External lighting plan is outside the currently verified native lighting mapping.")
            adapterWarnings += "External lighting plan requires an unsupported current native capability."
        }
        if (environmentRequested) {
            appendUnsupported(NativeSceneConcept.ENVIRONMENT_CHANGE, "External environment plan is outside the currently verified native environment mapping.")
            adapterWarnings += "External environment plan requires an unsupported current native capability."
        }
        if (adapterWarnings.size > 64) reject("SCENE_EXTERNAL_WARNINGS", "Combined external/adaptation warnings exceed the bounded 64-entry limit.")

        return NativeSceneSemanticDocument(
            detectedLanguage = language,
            normalizedText = normalizedText,
            provider = provider,
            model = model,
            output = output,
            actions = actionDrafts,
            ambiguous = unresolved.values.isNotEmpty(),
            warnings = adapterWarnings,
        )
    }

    private fun capabilityArray(array: JsonValue.ArrayValue, path: String, max: Int): Set<String> {
        if (array.values.size > max) reject("SCENE_EXTERNAL_CAPABILITIES", "$path exceeds $max entries.")
        val result = linkedSetOf<String>()
        array.values.forEachIndexed { index, value ->
            val capability = boundedString(value.asString("$path[$index]"), 1, 96, "$path[$index]")
            if (!result.add(capability)) reject("SCENE_EXTERNAL_CAPABILITIES", "$path contains duplicate capability '$capability'.")
        }
        return result
    }

    private fun stringArray(array: JsonValue.ArrayValue, path: String, max: Int, maxChars: Int): List<String> {
        if (array.values.size > max) reject("SCENE_EXTERNAL_ARRAY", "$path exceeds $max entries.")
        return array.values.mapIndexed { index, value -> boundedString(value.asString("$path[$index]"), 0, maxChars, "$path[$index]") }
    }

    private fun boundedString(value: String, minChars: Int, maxChars: Int, path: String): String {
        if (value.length !in minChars..maxChars) reject("SCENE_EXTERNAL_STRING", "$path length is outside $minChars..$maxChars characters.")
        return value
    }

    private fun stableId(value: String, path: String): String {
        if (!Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$").matches(value)) reject("SCENE_EXTERNAL_STABLE_ID", "$path is not a valid stable ID.")
        return value
    }

    private inline fun <reified T : Enum<T>> enumValue(value: String, path: String): T =
        enumValues<T>().firstOrNull { it.name == value }
            ?: reject("SCENE_EXTERNAL_ENUM", "$path contains unsupported enum value '$value'.")

    private fun reject(code: String, message: String): Nothing = throw NativeExternalSceneIrException(code, message)
}

/**
 * First-party proxy transport seam. The implementation talks only to the controlled Studio proxy;
 * provider credentials are deliberately absent from both this interface and its request envelope.
 */
internal fun interface NativeSceneProxyTransport {
    fun compileScene(requestJson: String): String
}

internal class NativeSceneProxySemanticBackend(
    private val transport: NativeSceneProxyTransport,
) : NativeSceneSemanticBackend {
    override fun infer(request: NativeSceneSemanticRequest): NativeSceneSemanticDocument {
        val requestId = controlledRequestId(request)
        val payload = buildString {
            append('{')
            append("\"schema\":\"m57-scene-compile-request-v1\",")
            append("\"request_id\":\"").append(jsonEscape(requestId)).append("\",")
            append("\"source_commit\":\"").append(jsonEscape(request.sourceCommit)).append("\",")
            append("\"reference_sha256\":\"").append(jsonEscape(request.referenceSha256)).append("\",")
            append("\"actor_id\":\"").append(jsonEscape(request.actorId)).append("\",")
            append("\"original_text\":\"").append(jsonEscape(request.originalText)).append("\"")
            append('}')
        }
        val response = transport.compileScene(payload)
        return try {
            NativeExternalSceneIrV1Adapter.decode(response, request, expectedRequestId = requestId)
        } catch (failure: NativeExternalSceneIrException) {
            throw IllegalArgumentException("${failure.diagnosticCode}: strict external Scene IR response rejected.", failure)
        }
    }

    internal fun controlledRequestId(request: NativeSceneSemanticRequest): String =
        "m57-" + NativeSceneCompilerSecurity.sha256(
            listOf(request.sourceCommit, request.referenceSha256, request.actorId, NativeSceneCompilerSecurity.sha256(request.originalText)).joinToString(":"),
        ).take(32)

    private fun jsonEscape(value: String): String = buildString(value.length + 16) {
        value.forEach { ch ->
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) append("\\u%04x".format(Locale.ROOT, ch.code)) else append(ch)
            }
        }
    }
}

private sealed interface JsonValue {
    data class ObjectValue(val values: LinkedHashMap<String, JsonValue>) : JsonValue
    data class ArrayValue(val values: List<JsonValue>) : JsonValue
    data class StringValue(val value: String) : JsonValue
    data class NumberValue(val raw: String) : JsonValue
    data class BooleanValue(val value: Boolean) : JsonValue
    data object Null : JsonValue
}

private class StrictJsonParser(private val source: String) {
    private var index = 0

    fun parse(): JsonValue {
        skipWhitespace()
        val value = parseValue(0)
        skipWhitespace()
        if (index != source.length) fail("Unexpected trailing JSON data at byte/char offset $index.")
        return value
    }

    private fun parseValue(depth: Int): JsonValue {
        if (depth > M57_MAX_JSON_DEPTH) fail("JSON nesting exceeds the bounded $M57_MAX_JSON_DEPTH-level limit.")
        skipWhitespace()
        if (index >= source.length) fail("Unexpected end of JSON input.")
        return when (source[index]) {
            '{' -> parseObject(depth + 1)
            '[' -> parseArray(depth + 1)
            '"' -> JsonValue.StringValue(parseString())
            't' -> literal("true", JsonValue.BooleanValue(true))
            'f' -> literal("false", JsonValue.BooleanValue(false))
            'n' -> literal("null", JsonValue.Null)
            '-', in '0'..'9' -> JsonValue.NumberValue(parseNumber())
            else -> fail("Unexpected JSON token at offset $index.")
        }
    }

    private fun parseObject(depth: Int): JsonValue.ObjectValue {
        expect('{')
        skipWhitespace()
        val values = linkedMapOf<String, JsonValue>()
        if (peek('}')) {
            index++
            return JsonValue.ObjectValue(values)
        }
        while (true) {
            skipWhitespace()
            if (!peek('"')) fail("JSON object key must be a string at offset $index.")
            val key = parseString()
            if (values.containsKey(key)) fail("Duplicate JSON object field '$key'.")
            skipWhitespace()
            expect(':')
            values[key] = parseValue(depth)
            skipWhitespace()
            when {
                peek(',') -> index++
                peek('}') -> {
                    index++
                    return JsonValue.ObjectValue(values)
                }
                else -> fail("Expected ',' or '}' at offset $index.")
            }
        }
    }

    private fun parseArray(depth: Int): JsonValue.ArrayValue {
        expect('[')
        skipWhitespace()
        val values = mutableListOf<JsonValue>()
        if (peek(']')) {
            index++
            return JsonValue.ArrayValue(values)
        }
        while (true) {
            values += parseValue(depth)
            skipWhitespace()
            when {
                peek(',') -> index++
                peek(']') -> {
                    index++
                    return JsonValue.ArrayValue(values)
                }
                else -> fail("Expected ',' or ']' at offset $index.")
            }
        }
    }

    private fun parseString(): String {
        expect('"')
        val result = StringBuilder()
        while (index < source.length) {
            val ch = source[index++]
            when {
                ch == '"' -> return result.toString()
                ch == '\\' -> {
                    if (index >= source.length) fail("Unterminated JSON escape.")
                    when (val escaped = source[index++]) {
                        '"', '\\', '/' -> result.append(escaped)
                        'b' -> result.append('\b')
                        'f' -> result.append('\u000C')
                        'n' -> result.append('\n')
                        'r' -> result.append('\r')
                        't' -> result.append('\t')
                        'u' -> result.append(parseUnicodeEscape())
                        else -> fail("Unsupported JSON escape \\$escaped.")
                    }
                }
                ch.code < 0x20 -> fail("Unescaped JSON control character in string.")
                else -> result.append(ch)
            }
        }
        fail("Unterminated JSON string.")
    }

    private fun parseUnicodeEscape(): Char {
        if (index + 4 > source.length) fail("Incomplete JSON unicode escape.")
        val hex = source.substring(index, index + 4)
        index += 4
        val code = hex.toIntOrNull(16) ?: fail("Invalid JSON unicode escape.")
        return code.toChar()
    }

    private fun parseNumber(): String {
        val start = index
        if (peek('-')) index++
        if (index >= source.length) fail("Invalid JSON number.")
        if (peek('0')) {
            index++
        } else {
            if (source[index] !in '1'..'9') fail("Invalid JSON number.")
            while (index < source.length && source[index].isDigit()) index++
        }
        if (peek('.')) {
            index++
            val fractionStart = index
            while (index < source.length && source[index].isDigit()) index++
            if (index == fractionStart) fail("JSON fraction requires digits.")
        }
        if (index < source.length && (source[index] == 'e' || source[index] == 'E')) {
            index++
            if (peek('+') || peek('-')) index++
            val exponentStart = index
            while (index < source.length && source[index].isDigit()) index++
            if (index == exponentStart) fail("JSON exponent requires digits.")
        }
        return source.substring(start, index)
    }

    private fun <T : JsonValue> literal(token: String, value: T): T {
        if (!source.startsWith(token, index)) fail("Invalid JSON literal at offset $index.")
        index += token.length
        return value
    }

    private fun expect(expected: Char) {
        if (index >= source.length || source[index] != expected) fail("Expected '$expected' at offset $index.")
        index++
    }

    private fun peek(ch: Char): Boolean = index < source.length && source[index] == ch

    private fun skipWhitespace() {
        while (index < source.length && source[index] in listOf(' ', '\t', '\r', '\n')) index++
    }

    private fun fail(message: String): Nothing = throw NativeExternalSceneIrException("SCENE_EXTERNAL_JSON", message)
}

private fun JsonValue.asObject(path: String): JsonValue.ObjectValue = this as? JsonValue.ObjectValue
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path must be an object.")

private fun JsonValue.asString(path: String): String = (this as? JsonValue.StringValue)?.value
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path must be a string.")

private fun JsonValue.ObjectValue.requireShape(path: String, required: Set<String>, optional: Set<String> = emptySet()) {
    val allowed = required + optional
    val unknown = values.keys - allowed
    if (unknown.isNotEmpty()) throw NativeExternalSceneIrException("SCENE_EXTERNAL_UNKNOWN_FIELD", "$path contains unknown field(s): ${unknown.sorted().joinToString()}.")
    val missing = required - values.keys
    if (missing.isNotEmpty()) throw NativeExternalSceneIrException("SCENE_EXTERNAL_MISSING_FIELD", "$path is missing required field(s): ${missing.sorted().joinToString()}.")
}

private fun JsonValue.ObjectValue.optionalValue(key: String): JsonValue? = values[key]

private fun JsonValue.ObjectValue.string(key: String, path: String): String = values[key]?.asString("$path.$key")
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_MISSING_FIELD", "$path.$key is required.")

private fun JsonValue.ObjectValue.objectValue(key: String, path: String): JsonValue.ObjectValue = values[key]?.asObject("$path.$key")
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_MISSING_FIELD", "$path.$key is required.")

private fun JsonValue.ObjectValue.arrayValue(key: String, path: String): JsonValue.ArrayValue = values[key] as? JsonValue.ArrayValue
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be an array.")

private fun JsonValue.ObjectValue.optionalArray(key: String, path: String): JsonValue.ArrayValue? {
    val value = values[key] ?: return null
    return value as? JsonValue.ArrayValue ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be an array.")
}

private fun JsonValue.ObjectValue.optionalObject(key: String, path: String): JsonValue.ObjectValue? {
    val value = values[key] ?: return null
    if (value === JsonValue.Null) return null
    return value.asObject("$path.$key")
}

private fun JsonValue.ObjectValue.boolean(key: String, path: String): Boolean = (values[key] as? JsonValue.BooleanValue)?.value
    ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be a boolean.")

private fun JsonValue.ObjectValue.optionalBoolean(key: String, path: String): Boolean? {
    val value = values[key] ?: return null
    return (value as? JsonValue.BooleanValue)?.value ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be a boolean.")
}

private fun JsonValue.ObjectValue.number(key: String, path: String): Double {
    val raw = (values[key] as? JsonValue.NumberValue)?.raw ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be a number.")
    return raw.toDoubleOrNull()?.takeIf { it.isFinite() } ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_NUMBER", "$path.$key is not a finite number.")
}

private fun JsonValue.ObjectValue.int(key: String, path: String): Int {
    val raw = (values[key] as? JsonValue.NumberValue)?.raw ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be an integer.")
    if (raw.contains('.') || raw.contains('e', ignoreCase = true)) throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be an integer.")
    return raw.toIntOrNull() ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_NUMBER", "$path.$key is outside integer range.")
}

private fun JsonValue.ObjectValue.optionalNullableNumber(key: String, path: String): Double? {
    val value = values[key] ?: return null
    if (value === JsonValue.Null) return null
    val raw = (value as? JsonValue.NumberValue)?.raw ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_TYPE", "$path.$key must be a number or null.")
    return raw.toDoubleOrNull()?.takeIf { it.isFinite() } ?: throw NativeExternalSceneIrException("SCENE_EXTERNAL_NUMBER", "$path.$key is not a finite number.")
}

private fun JsonValue.ObjectValue.optionalNullableString(key: String, path: String): String? {
    val value = values[key] ?: return null
    if (value === JsonValue.Null) return null
    return value.asString("$path.$key")
}
