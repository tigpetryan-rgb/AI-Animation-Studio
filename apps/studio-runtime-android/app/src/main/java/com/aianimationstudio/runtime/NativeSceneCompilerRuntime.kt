package com.aianimationstudio.runtime

import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.min

internal const val M57_MAX_SHOTS = 32
internal const val M57_MAX_TIMELINE_EVENTS = 128
private const val M57_TIMING_EPSILON_SECONDS = 0.001

internal enum class NativeSceneBackendFailureCategory(val diagnosticCode: String) {
    TIMEOUT("SCENE_BACKEND_TIMEOUT"),
    CANCELLED("SCENE_BACKEND_CANCELLED"),
    UNAVAILABLE("SCENE_BACKEND_UNAVAILABLE"),
    RESPONSE_TOO_LARGE("SCENE_BACKEND_RESPONSE_TOO_LARGE"),
}

internal class NativeSceneBackendException(
    val category: NativeSceneBackendFailureCategory,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

internal data class NativeSceneBackendPolicy(
    val timeoutMillis: Long = 15_000,
    val maxAttempts: Int = 2,
    val retryBackoffMillis: Long = 100,
    val pollMillis: Long = 25,
) {
    init {
        require(timeoutMillis in 1..120_000) { "Scene compiler timeout must be between 1 ms and 120 seconds." }
        require(maxAttempts in 1..4) { "Scene compiler attempts must be between 1 and 4." }
        require(retryBackoffMillis in 0..10_000) { "Scene compiler retry backoff must be between 0 and 10 seconds." }
        require(pollMillis in 1..250) { "Scene compiler cancellation polling must be between 1 and 250 ms." }
    }
}

internal class NativeSceneCancellationToken {
    private val cancelled = AtomicBoolean(false)
    fun cancel() { cancelled.set(true) }
    fun isCancelled(): Boolean = cancelled.get()
}

/**
 * Enforces timeout/retry/cancellation outside the semantic provider. This wrapper never fabricates
 * a semantic response: exhausted backend failures surface as deterministic failure categories.
 */
internal class BoundedNativeSceneSemanticBackend(
    private val delegate: NativeSceneSemanticBackend,
    private val policy: NativeSceneBackendPolicy = NativeSceneBackendPolicy(),
    private val cancellation: NativeSceneCancellationToken = NativeSceneCancellationToken(),
) : NativeSceneSemanticBackend {
    override fun infer(request: NativeSceneSemanticRequest): NativeSceneSemanticDocument {
        var lastFailure: Throwable? = null
        for (attempt in 1..policy.maxAttempts) {
            ensureNotCancelled()
            val executor = Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "m57-scene-compiler").apply { isDaemon = true }
            }
            val future = executor.submit<NativeSceneSemanticDocument> { delegate.infer(request) }
            try {
                val deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(policy.timeoutMillis)
                while (true) {
                    ensureNotCancelled(future)
                    val remainingNanos = deadlineNanos - System.nanoTime()
                    if (remainingNanos <= 0L) {
                        future.cancel(true)
                        throw NativeSceneBackendException(
                            NativeSceneBackendFailureCategory.TIMEOUT,
                            "Semantic backend exceeded the bounded ${policy.timeoutMillis} ms timeout on attempt $attempt.",
                        )
                    }
                    try {
                        val waitNanos = min(remainingNanos, TimeUnit.MILLISECONDS.toNanos(policy.pollMillis))
                        val document = future.get(waitNanos, TimeUnit.NANOSECONDS)
                        enforceResponseBounds(document)
                        return document
                    } catch (_: TimeoutException) {
                        // Short polling timeout; loop so cancellation can stop an in-flight request.
                    }
                }
            } catch (failure: NativeSceneBackendException) {
                if (failure.category == NativeSceneBackendFailureCategory.CANCELLED) throw failure
                lastFailure = failure
            } catch (failure: ExecutionException) {
                val cause = failure.cause ?: failure
                if (cause is NativeSceneBackendException && cause.category == NativeSceneBackendFailureCategory.CANCELLED) throw cause
                lastFailure = cause
            } catch (failure: InterruptedException) {
                Thread.currentThread().interrupt()
                future.cancel(true)
                throw NativeSceneBackendException(
                    NativeSceneBackendFailureCategory.CANCELLED,
                    "Semantic compilation thread was interrupted.",
                    failure,
                )
            } finally {
                future.cancel(true)
                executor.shutdownNow()
            }

            if (attempt < policy.maxAttempts) {
                sleepBackoff()
            }
        }
        if (lastFailure is NativeSceneBackendException) throw lastFailure
        throw NativeSceneBackendException(
            NativeSceneBackendFailureCategory.UNAVAILABLE,
            "Semantic backend failed after ${policy.maxAttempts} bounded attempt(s).",
            lastFailure,
        )
    }

    private fun enforceResponseBounds(document: NativeSceneSemanticDocument) {
        val normalizedBytes = document.normalizedText.toByteArray(Charsets.UTF_8).size
        val warningBytes = document.warnings.sumOf { it.toByteArray(Charsets.UTF_8).size }
        val sourceExcerptBytes = document.actions.sumOf { it.sourceExcerpt.toByteArray(Charsets.UTF_8).size }
        val dialogueBytes = document.actions.sumOf { it.text?.toByteArray(Charsets.UTF_8)?.size ?: 0 }
        val totalSemanticBytes = normalizedBytes + warningBytes + sourceExcerptBytes + dialogueBytes
        if (document.actions.size > M57_MAX_MODEL_ACTIONS || totalSemanticBytes > M57_MAX_SCRIPT_BYTES * 4) {
            throw NativeSceneBackendException(
                NativeSceneBackendFailureCategory.RESPONSE_TOO_LARGE,
                "Semantic backend response exceeded bounded action/text limits.",
            )
        }
    }

    private fun sleepBackoff() {
        var remaining = policy.retryBackoffMillis
        while (remaining > 0) {
            ensureNotCancelled()
            val chunk = min(remaining, policy.pollMillis)
            Thread.sleep(chunk)
            remaining -= chunk
        }
    }

    private fun ensureNotCancelled(future: java.util.concurrent.Future<*>? = null) {
        if (cancellation.isCancelled()) {
            future?.cancel(true)
            throw NativeSceneBackendException(
                NativeSceneBackendFailureCategory.CANCELLED,
                "Semantic compilation was cancelled.",
            )
        }
    }
}

internal enum class NativeCameraShotSize { EXTREME_CLOSE_UP, CLOSE_UP, MEDIUM, FULL, WIDE }
internal enum class NativeCameraAngle { EYE_LEVEL, HIGH, LOW, TOP_DOWN }
internal enum class NativeCameraMovement { LOCKED, PAN, TILT, DOLLY, TRACK, ZOOM }

internal data class NativeSceneCameraPlan(
    val shotSize: NativeCameraShotSize,
    val angle: NativeCameraAngle,
    val movement: NativeCameraMovement,
    val focusTargetId: String,
)

internal data class NativeSceneShotDraft(
    val id: String,
    val startSeconds: Double,
    val durationSeconds: Double,
    val actionIds: List<String>,
    val camera: NativeSceneCameraPlan,
)

internal data class NativeSceneShot(
    val id: String,
    val startSeconds: Double,
    val endSeconds: Double,
    val actionIds: List<String>,
    val camera: NativeSceneCameraPlan,
)

internal data class NativeSceneTimelinePlan(
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val durationSeconds: Double,
    val shots: List<NativeSceneShot>,
)

internal sealed interface NativeSceneTimelineResult {
    data class Ready(val timeline: NativeSceneTimelinePlan) : NativeSceneTimelineResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeSceneTimelineResult
}

/**
 * Deterministic shot/timing gate. It validates an explicit shot plan; it never invents camera or
 * timing semantics from prose. Multi-shot plans therefore must come from schema-bound semantic IR.
 */
internal object NativeSceneTimelineCompiler {
    fun singleShot(ir: NativeSceneIrV1): NativeSceneTimelineResult = compile(
        ir,
        listOf(
            NativeSceneShotDraft(
                id = "shot-1",
                startSeconds = 0.0,
                durationSeconds = ir.output.durationSeconds,
                actionIds = ir.actions.map { it.id },
                camera = NativeSceneCameraPlan(
                    shotSize = NativeCameraShotSize.FULL,
                    angle = NativeCameraAngle.EYE_LEVEL,
                    movement = NativeCameraMovement.LOCKED,
                    focusTargetId = ir.actorId,
                ),
            ),
        ),
    )

    fun compile(ir: NativeSceneIrV1, shots: List<NativeSceneShotDraft>): NativeSceneTimelineResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (shots.isEmpty()) diagnostics += NativeDiagnostic("SCENE_TIMELINE_EMPTY", "Scene timeline requires at least one explicit shot.")
        if (shots.size > M57_MAX_SHOTS) diagnostics += NativeDiagnostic("SCENE_TOO_MANY_SHOTS", "Scene timeline exceeds the bounded $M57_MAX_SHOTS-shot limit.")
        val totalActionRefs = shots.sumOf { it.actionIds.size }
        if (totalActionRefs > M57_MAX_TIMELINE_EVENTS) diagnostics += NativeDiagnostic("SCENE_TOO_MANY_TIMELINE_EVENTS", "Scene timeline exceeds the bounded $M57_MAX_TIMELINE_EVENTS-event reference limit.")

        val knownActions = ir.actions.associateBy { it.id }
        val seenShotIds = mutableSetOf<String>()
        val compiled = shots.sortedBy { it.startSeconds }.mapIndexed { index, shot ->
            if (shot.id.isBlank() || !seenShotIds.add(shot.id)) diagnostics += NativeDiagnostic("SCENE_SHOT_ID", "Shot ${index + 1} requires a unique non-empty stable ID.")
            if (!shot.startSeconds.isFinite() || shot.startSeconds < 0.0) diagnostics += NativeDiagnostic("SCENE_SHOT_START", "Shot ${shot.id} has an invalid start time.")
            if (!shot.durationSeconds.isFinite() || shot.durationSeconds <= 0.0) diagnostics += NativeDiagnostic("SCENE_SHOT_DURATION", "Shot ${shot.id} has an invalid duration.")
            if (shot.camera.focusTargetId != ir.actorId) diagnostics += NativeDiagnostic("SCENE_CAMERA_TARGET", "Shot ${shot.id} camera focus target is outside the admitted exact actor identity.")
            shot.actionIds.forEach { actionId ->
                if (actionId !in knownActions) diagnostics += NativeDiagnostic("SCENE_UNKNOWN_ACTION_REF", "Shot ${shot.id} references unknown action $actionId.")
            }
            NativeSceneShot(
                id = shot.id,
                startSeconds = shot.startSeconds,
                endSeconds = shot.startSeconds + shot.durationSeconds,
                actionIds = shot.actionIds,
                camera = shot.camera,
            )
        }

        compiled.forEachIndexed { index, shot ->
            if (index == 0 && abs(shot.startSeconds) > M57_TIMING_EPSILON_SECONDS) {
                diagnostics += NativeDiagnostic("SCENE_TIMELINE_GAP", "Timeline must begin at 0 seconds.")
            }
            if (index > 0) {
                val previous = compiled[index - 1]
                val delta = shot.startSeconds - previous.endSeconds
                if (abs(delta) > M57_TIMING_EPSILON_SECONDS) {
                    diagnostics += NativeDiagnostic(
                        if (delta < 0) "SCENE_TIMELINE_OVERLAP" else "SCENE_TIMELINE_GAP",
                        "Shot ${shot.id} does not continue exactly from ${previous.id}.",
                    )
                }
            }
        }
        val finalEnd = compiled.lastOrNull()?.endSeconds ?: 0.0
        if (abs(finalEnd - ir.output.durationSeconds) > M57_TIMING_EPSILON_SECONDS) {
            diagnostics += NativeDiagnostic("SCENE_TIMING_BUDGET", "Explicit shot timeline must exactly preserve requested scene duration ${ir.output.durationSeconds} seconds.")
        }

        val referenced = compiled.flatMap { it.actionIds }
        val missingActions = knownActions.keys - referenced.toSet()
        if (missingActions.isNotEmpty()) {
            diagnostics += NativeDiagnostic("SCENE_UNSCHEDULED_ACTION", "Scene actions are not silently dropped; unscheduled action IDs: ${missingActions.sorted().joinToString()}.")
        }

        if (diagnostics.isNotEmpty()) return NativeSceneTimelineResult.Rejected(diagnostics)
        return NativeSceneTimelineResult.Ready(
            NativeSceneTimelinePlan(
                sourceCommit = ir.sourceCommit,
                referenceSha256 = ir.referenceSha256,
                scriptSha256 = ir.scriptSha256,
                durationSeconds = ir.output.durationSeconds,
                shots = compiled,
            ),
        )
    }
}
