package com.aianimationstudio.runtime

import java.util.Locale
import kotlin.math.hypot
import kotlin.math.tan

internal data class NativeStagePoint(val x: Double, val y: Double, val z: Double)

internal data class NativeOutputSpec(
    val width: Int,
    val height: Int,
    val frameRate: Double,
    val durationSeconds: Double,
)

internal data class NativeCameraDraft(
    val start: NativeStagePoint,
    val end: NativeStagePoint,
    val target: NativeStagePoint,
    val framing: String = "MEDIUM_WIDE",
)

internal data class NativeSceneBlocking(
    val actorId: String,
    val reference: PersistedReferenceAsset,
    val actorOrigin: NativeStagePoint,
    val cameraDraft: NativeCameraDraft,
    val output: NativeOutputSpec,
    val prompt: String,
)

internal data class NativeDiagnostic(val code: String, val message: String, val line: Int? = null)

internal sealed interface NativeBlockingResult {
    data class Ready(val blocking: NativeSceneBlocking) : NativeBlockingResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeBlockingResult
}

internal object NativeSceneBlockingCompiler {
    private val resolution = Regex("(\\d{2,5})\\s*[x×х]\\s*(\\d{2,5})", setOf(RegexOption.IGNORE_CASE))
    private val fps = Regex("(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:fps|կադր\\s*/\\s*վրկ|кадр(?:ов)?\\s*/\\s*с)", setOf(RegexOption.IGNORE_CASE))
    private val duration = Regex("(\\d{1,5}(?:[.,]\\d+)?)\\s*(?:seconds?|secs?|sec|վայրկյան(?:անոց)?|վրկ|секунд(?:а|ы)?|сек)", setOf(RegexOption.IGNORE_CASE))

    fun compile(chatId: String, prompt: String, reference: PersistedReferenceAsset?): NativeBlockingResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (prompt.isBlank()) diagnostics += NativeDiagnostic("BLOCKING_EMPTY_PROMPT", "A story/shot prompt is required before scene blocking.")
        if (reference == null) diagnostics += NativeDiagnostic("BLOCKING_MISSING_REFERENCE", "A character image reference is required before scene blocking; Studio will not fabricate a character identity.")

        val resolutionMatch = resolution.find(prompt)
        val width = resolutionMatch?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 1920
        val height = resolutionMatch?.groupValues?.getOrNull(2)?.toIntOrNull() ?: 1080
        val frameRate = firstNumber(prompt, fps) ?: 24.0
        val durationSeconds = firstNumber(prompt, duration) ?: 10.0

        if (width !in 64..8192 || height !in 64..8192) {
            diagnostics += NativeDiagnostic("BLOCKING_INVALID_RESOLUTION", "Requested output resolution must be between 64 and 8192 pixels per side.")
        }
        if (!frameRate.isFinite() || frameRate !in 1.0..120.0) {
            diagnostics += NativeDiagnostic("BLOCKING_INVALID_FPS", "Requested frame rate must be between 1 and 120 fps.")
        }
        if (!durationSeconds.isFinite() || durationSeconds !in 0.1..3600.0) {
            diagnostics += NativeDiagnostic("BLOCKING_INVALID_DURATION", "Requested shot duration must be between 0.1 and 3600 seconds.")
        }
        if (diagnostics.isNotEmpty() || reference == null) return NativeBlockingResult.Rejected(diagnostics)

        return NativeBlockingResult.Ready(
            NativeSceneBlocking(
                actorId = "character-${safeId(chatId)}",
                reference = reference,
                actorOrigin = NativeStagePoint(0.0, 0.0, 0.0),
                cameraDraft = NativeCameraDraft(
                    start = NativeStagePoint(0.0, 1.15, 3.8),
                    end = NativeStagePoint(0.0, 1.1, 2.4),
                    target = NativeStagePoint(0.0, 0.95, 0.0),
                ),
                output = NativeOutputSpec(width, height, frameRate, durationSeconds),
                prompt = prompt,
            ),
        )
    }

    private fun firstNumber(source: String, regex: Regex): Double? = regex.find(source)
        ?.groupValues
        ?.getOrNull(1)
        ?.replace(',', '.')
        ?.toDoubleOrNull()

    private fun safeId(value: String): String {
        val normalized = value.lowercase(Locale.US)
            .replace(Regex("[^a-z0-9_-]+"), "-")
            .trim('-')
        return if (normalized.isBlank()) "runtime-character" else normalized.take(64)
    }
}

internal enum class NativeEntityKind { CHARACTER, PROP, LOCATION }

internal data class NativeStoryEntity(
    val id: String,
    val kind: NativeEntityKind,
    val aliases: List<String>,
)

internal enum class NativeStoryAction {
    ENTER, EXIT, MOVE_TO, WALK_TO, RUN_TO, TURN_TO, LOOK_AT, NOTICE, SEARCH_FOR,
    PICK_UP, PUT_DOWN, GIVE, RECEIVE, TOUCH, USE, OPEN, CLOSE, LOCK, UNLOCK,
    SIT, STAND, WAIT, SPEAK, RESPOND, REACT, CHANGE_STATE,
}

internal data class NativeStoryEvent(
    val id: String,
    val type: NativeStoryAction,
    val actorId: String,
    val targetId: String?,
    val parameters: Map<String, String>,
    val causes: List<String>,
    val line: Int,
    val sourceText: String,
)

internal data class NativeStoryIr(val source: String, val events: List<NativeStoryEvent>)

internal data class NativeStoryCompileResult(
    val ok: Boolean,
    val ir: NativeStoryIr,
    val diagnostics: List<NativeDiagnostic>,
)

internal object NativeStoryCompiler {
    private val noTarget = setOf(
        NativeStoryAction.SIT,
        NativeStoryAction.STAND,
        NativeStoryAction.WAIT,
        NativeStoryAction.SPEAK,
        NativeStoryAction.RESPOND,
        NativeStoryAction.REACT,
    )
    private val locationTarget = setOf(NativeStoryAction.ENTER, NativeStoryAction.EXIT)
    private val propTarget = setOf(
        NativeStoryAction.PICK_UP,
        NativeStoryAction.PUT_DOWN,
        NativeStoryAction.GIVE,
        NativeStoryAction.RECEIVE,
        NativeStoryAction.TOUCH,
        NativeStoryAction.USE,
        NativeStoryAction.OPEN,
        NativeStoryAction.CLOSE,
        NativeStoryAction.LOCK,
        NativeStoryAction.UNLOCK,
    )

    fun compile(source: String, registry: List<NativeStoryEntity>): NativeStoryCompileResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        val events = mutableListOf<NativeStoryEvent>()
        val aliases = buildAliasIndex(registry)
        val lastEventByEntity = mutableMapOf<String, String>()

        if (source.isBlank()) diagnostics += NativeDiagnostic("STORY_EMPTY_SOURCE", "Story source is empty.")

        source.split(Regex("\\r?\\n")).forEachIndexed { index, original ->
            val trimmed = original.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEachIndexed
            val line = index + 1
            val tokens = trimmed.split(Regex("\\s+"))
            if (tokens.size < 2) {
                diagnostics += NativeDiagnostic("STORY_INVALID_STATEMENT", "Expected ACTOR ACTION [TARGET].", line)
                return@forEachIndexed
            }

            val actorToken = tokens[0]
            val actionToken = normalize(tokens[1])
            val actor = aliases[normalize(actorToken)]
            if (actor == null || actor.kind != NativeEntityKind.CHARACTER) {
                diagnostics += NativeDiagnostic("STORY_UNKNOWN_ACTOR", "Unknown character alias: $actorToken.", line)
                return@forEachIndexed
            }

            val action = runCatching { NativeStoryAction.valueOf(actionToken) }.getOrNull()
            if (action == null) {
                diagnostics += NativeDiagnostic("STORY_UNKNOWN_ACTION", "Unknown story action: $actionToken.", line)
                return@forEachIndexed
            }

            val expectedKind = when {
                action in noTarget -> null
                action in locationTarget -> NativeEntityKind.LOCATION
                action in propTarget -> NativeEntityKind.PROP
                else -> NativeEntityKind.CHARACTER // sentinel overridden by allowAny below
            }
            val allowAny = action !in noTarget && action !in locationTarget && action !in propTarget
            val targetToken = if (action in noTarget || action == NativeStoryAction.SPEAK) null else tokens.getOrNull(2)
            var target: NativeStoryEntity? = null

            if (action !in noTarget) {
                if (targetToken == null) {
                    diagnostics += NativeDiagnostic("STORY_MISSING_TARGET", "$action requires a target.", line)
                    return@forEachIndexed
                }
                target = aliases[normalize(targetToken)]
                if (target == null) {
                    diagnostics += NativeDiagnostic("STORY_UNKNOWN_TARGET", "Unknown target alias: $targetToken.", line)
                    return@forEachIndexed
                }
                if (!allowAny && target.kind != expectedKind) {
                    diagnostics += NativeDiagnostic("STORY_INVALID_TARGET_KIND", "$action requires a ${expectedKind!!.name.lowercase(Locale.US)} target, received ${target.kind.name.lowercase(Locale.US)}.", line)
                    return@forEachIndexed
                }
            } else if (action != NativeStoryAction.SPEAK && tokens.getOrNull(2) != null) {
                diagnostics += NativeDiagnostic("STORY_UNEXPECTED_TARGET", "$action does not accept a target.", line)
                return@forEachIndexed
            }

            val parameters = when (action) {
                NativeStoryAction.SPEAK -> mapOf("text" to tokens.drop(2).joinToString(" "))
                NativeStoryAction.CHANGE_STATE -> tokens.getOrNull(3)?.let { mapOf("value" to tokens.drop(3).joinToString(" ")) } ?: emptyMap()
                else -> emptyMap()
            }
            if (action == NativeStoryAction.CHANGE_STATE && parameters["value"] == null) {
                diagnostics += NativeDiagnostic("STORY_MISSING_STATE_VALUE", "CHANGE_STATE requires a state value.", line)
                return@forEachIndexed
            }

            val id = "story_event_l$line"
            val touched = buildList {
                add(actor.id)
                target?.let { add(it.id) }
            }
            val causes = touched.mapNotNull(lastEventByEntity::get).distinct()
            events += NativeStoryEvent(id, action, actor.id, target?.id, parameters, causes, line, original)
            touched.forEach { lastEventByEntity[it] = id }
        }

        return NativeStoryCompileResult(
            ok = diagnostics.isEmpty(),
            ir = NativeStoryIr(source, events),
            diagnostics = diagnostics,
        )
    }

    private fun buildAliasIndex(registry: List<NativeStoryEntity>): Map<String, NativeStoryEntity> = buildMap {
        registry.forEach { entity ->
            put(normalize(entity.id), entity)
            entity.aliases.forEach { put(normalize(it), entity) }
        }
    }

    private fun normalize(value: String): String = value.trim().uppercase(Locale.US)
}

internal data class NativeCameraKeyframe(
    val timeSeconds: Double,
    val position: NativeStagePoint,
    val target: NativeStagePoint,
    val verticalFovDegrees: Double,
)

internal data class NativeCameraVisibilitySample(
    val timeSeconds: Double,
    val depthNear: Double,
    val minNdcX: Double,
    val maxNdcX: Double,
    val minNdcY: Double,
    val maxNdcY: Double,
    val visible: Boolean,
)

internal data class NativeCameraExecution(
    val sourceCommit: String,
    val keyframes: List<NativeCameraKeyframe>,
    val visibilitySamples: List<NativeCameraVisibilitySample>,
)

internal sealed interface NativeCameraResult {
    data class Ready(val execution: NativeCameraExecution) : NativeCameraResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCameraResult
}

internal object NativeCameraExecutor {
    private const val CAMERA_FOV_DEGREES = 50.0
    private const val VISIBILITY_MARGIN_NDC = 0.04
    private const val CHARACTER_HALF_WIDTH_METERS = 0.34
    private const val CHARACTER_HEIGHT_METERS = 1.8

    fun execute(blocking: NativeSceneBlocking, sourceCommit: String): NativeCameraResult {
        if (!Regex("^[0-9a-f]{40}$").matches(sourceCommit)) {
            return NativeCameraResult.Rejected(listOf(NativeDiagnostic("CAMERA_SOURCE_IDENTITY", "Camera executor requires the exact 40-character Studio source commit.")))
        }
        val duration = blocking.output.durationSeconds
        val aspect = blocking.output.width.toDouble() / blocking.output.height.toDouble()
        if (!duration.isFinite() || duration <= 0.0 || !aspect.isFinite() || aspect <= 0.0) {
            return NativeCameraResult.Rejected(listOf(NativeDiagnostic("CAMERA_OUTPUT_SPEC", "Camera execution requires a valid output duration and aspect ratio.")))
        }

        val draft = blocking.cameraDraft
        val keyframes = listOf(
            NativeCameraKeyframe(0.0, draft.start, draft.target, CAMERA_FOV_DEGREES),
            NativeCameraKeyframe(duration / 2.0, lerp(draft.start, draft.end, 0.5), draft.target, CAMERA_FOV_DEGREES),
            NativeCameraKeyframe(duration, draft.end, draft.target, CAMERA_FOV_DEGREES),
        )
        val samples = listOf(0.0, duration * 0.25, duration * 0.5, duration * 0.75, duration)
            .map { visibilitySample(cameraAt(keyframes, it), blocking.actorOrigin, aspect) }
        val firstFailure = samples.firstOrNull { !it.visible }
        if (firstFailure != null) {
            return NativeCameraResult.Rejected(
                listOf(
                    NativeDiagnostic(
                        "CAMERA_VISIBILITY",
                        "Camera visibility failed at %.3fs: depth=%.3f, ndc=[%.3f,%.3f]×[%.3f,%.3f].".format(
                            Locale.US,
                            firstFailure.timeSeconds,
                            firstFailure.depthNear,
                            firstFailure.minNdcX,
                            firstFailure.maxNdcX,
                            firstFailure.minNdcY,
                            firstFailure.maxNdcY,
                        ),
                    ),
                ),
            )
        }
        return NativeCameraResult.Ready(NativeCameraExecution(sourceCommit, keyframes, samples))
    }

    private fun cameraAt(keyframes: List<NativeCameraKeyframe>, time: Double): NativeCameraKeyframe {
        if (time <= keyframes.first().timeSeconds) return keyframes.first()
        if (time >= keyframes.last().timeSeconds) return keyframes.last()
        for (i in 1 until keyframes.size) {
            val right = keyframes[i]
            val left = keyframes[i - 1]
            if (time > right.timeSeconds) continue
            val span = right.timeSeconds - left.timeSeconds
            val amount = if (span <= 0.0) 0.0 else (time - left.timeSeconds) / span
            return NativeCameraKeyframe(
                time,
                lerp(left.position, right.position, amount),
                lerp(left.target, right.target, amount),
                left.verticalFovDegrees + (right.verticalFovDegrees - left.verticalFovDegrees) * amount,
            )
        }
        return keyframes.last()
    }

    private fun visibilitySample(camera: NativeCameraKeyframe, actorRoot: NativeStagePoint, aspect: Double): NativeCameraVisibilitySample {
        val forward = normalize(sub(camera.target, camera.position)) ?: return invisible(camera.timeSeconds)
        var right = normalize(cross(forward, NativeStagePoint(0.0, 1.0, 0.0)))
        if (right == null) right = normalize(cross(forward, NativeStagePoint(0.0, 0.0, 1.0)))
        right ?: return invisible(camera.timeSeconds)
        val up = normalize(cross(right, forward)) ?: return invisible(camera.timeSeconds)
        val tangent = tan(Math.toRadians(camera.verticalFovDegrees) / 2.0)

        var depthNear = Double.POSITIVE_INFINITY
        var minX = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        for (world in characterBounds(actorRoot)) {
            val relative = sub(world, camera.position)
            val depth = dot(relative, forward)
            depthNear = minOf(depthNear, depth)
            if (depth <= 1e-4 || !tangent.isFinite() || tangent <= 0.0 || !aspect.isFinite() || aspect <= 0.0) return invisible(camera.timeSeconds)
            val ndcX = dot(relative, right) / (depth * tangent * aspect)
            val ndcY = dot(relative, up) / (depth * tangent)
            minX = minOf(minX, ndcX); maxX = maxOf(maxX, ndcX)
            minY = minOf(minY, ndcY); maxY = maxOf(maxY, ndcY)
        }
        val limit = 1.0 - VISIBILITY_MARGIN_NDC
        val visible = depthNear > 0.0 && minX >= -limit && maxX <= limit && minY >= -limit && maxY <= limit
        return NativeCameraVisibilitySample(camera.timeSeconds, depthNear, minX, maxX, minY, maxY, visible)
    }

    private fun characterBounds(root: NativeStagePoint): List<NativeStagePoint> {
        val centerY = root.y + CHARACTER_HEIGHT_METERS / 2.0
        val halfHeight = CHARACTER_HEIGHT_METERS / 2.0
        return listOf(
            NativeStagePoint(root.x - CHARACTER_HALF_WIDTH_METERS, centerY - halfHeight, root.z),
            NativeStagePoint(root.x + CHARACTER_HALF_WIDTH_METERS, centerY - halfHeight, root.z),
            NativeStagePoint(root.x - CHARACTER_HALF_WIDTH_METERS, centerY + halfHeight, root.z),
            NativeStagePoint(root.x + CHARACTER_HALF_WIDTH_METERS, centerY + halfHeight, root.z),
            NativeStagePoint(root.x, centerY, root.z),
        )
    }

    private fun invisible(time: Double) = NativeCameraVisibilitySample(
        time,
        -1.0,
        Double.POSITIVE_INFINITY,
        Double.POSITIVE_INFINITY,
        Double.POSITIVE_INFINITY,
        Double.POSITIVE_INFINITY,
        false,
    )

    private fun sub(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x - b.x, a.y - b.y, a.z - b.z)
    private fun dot(a: NativeStagePoint, b: NativeStagePoint) = a.x * b.x + a.y * b.y + a.z * b.z
    private fun cross(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )
    private fun normalize(a: NativeStagePoint): NativeStagePoint? {
        val length = hypot(hypot(a.x, a.y), a.z)
        return if (length.isFinite() && length > 1e-6) NativeStagePoint(a.x / length, a.y / length, a.z / length) else null
    }
    private fun lerp(a: NativeStagePoint, b: NativeStagePoint, amount: Double) = NativeStagePoint(
        a.x + (b.x - a.x) * amount,
        a.y + (b.y - a.y) * amount,
        a.z + (b.z - a.z) * amount,
    )
}
