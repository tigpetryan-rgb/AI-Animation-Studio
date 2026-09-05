package com.aianimationstudio.runtime

import kotlin.math.atan
import kotlin.math.hypot
import kotlin.math.tan

internal enum class NativePhase5ShotSize { WIDE, FULL, MEDIUM, MEDIUM_CLOSE, CLOSE_UP }
internal enum class NativePhase5CameraAngle { EYE_LEVEL, LOW, HIGH, THREE_QUARTER }
internal enum class NativePhase5CameraMotion { STATIC, DOLLY_IN, DOLLY_OUT, PAN, TILT, ORBIT, TRACKING }
internal enum class NativePhase5CameraZone { FRONT_LEFT, FRONT_RIGHT, CENTER }

internal data class NativePhase5CameraPose(
    val timeSeconds: Double,
    val position: NativeStagePoint,
    val target: NativeStagePoint,
    val verticalFovDegrees: Double,
)

internal data class NativePhase5Shot(
    val id: String,
    val sourceEventId: String,
    val action: NativeStoryAction,
    val startTimeSeconds: Double,
    val endTimeSeconds: Double,
    val size: NativePhase5ShotSize,
    val lensMm: Double,
    val angle: NativePhase5CameraAngle,
    val zone: NativePhase5CameraZone,
    val motion: NativePhase5CameraMotion,
    val startPose: NativePhase5CameraPose,
    val endPose: NativePhase5CameraPose,
    val intent: String,
)

internal data class NativePhase5CameraSafetySample(
    val shotId: String,
    val timeSeconds: Double,
    val visible: Boolean,
    val actorClearanceMeters: Double,
    val targetClearanceMeters: Double?,
    val eyelineSide: Int,
)

internal data class NativePhase5Acceptance(
    val shotLanguageGate: Boolean,
    val framingLensGate: Boolean,
    val motionGate: Boolean,
    val visibilityGate: Boolean,
    val collisionGate: Boolean,
    val eyelineContinuityGate: Boolean,
    val onePerformanceManyCamerasGate: Boolean,
    val storyIntentSelectionGate: Boolean,
) {
    val done: Boolean
        get() = shotLanguageGate && framingLensGate && motionGate && visibilityGate && collisionGate &&
            eyelineContinuityGate && onePerformanceManyCamerasGate && storyIntentSelectionGate
}

internal data class NativePhase5CameraPlan(
    val assetId: String,
    val actorId: String,
    val shotId: String,
    val sourceCommit: String,
    val performance: NativePhase4ActorPerformance,
    val shots: List<NativePhase5Shot>,
    val safetySamples: List<NativePhase5CameraSafetySample>,
    val acceptance: NativePhase5Acceptance,
)

internal sealed interface NativePhase5DirectorResult {
    data class Ready(val plan: NativePhase5CameraPlan) : NativePhase5DirectorResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase5DirectorResult
}

/**
 * Phase-5 deterministic virtual director.
 *
 * It consumes the accepted Phase-4 master performance and never mutates it. World geometry is still
 * Phase-6 scope, so collision checks are intentionally limited to the actor and explicit Phase-4
 * rehearsal target anchors. Phase 6 can supply canonical world obstacles without reopening this
 * camera-language/continuity contract.
 */
internal object NativeVirtualDirectorPhase5Engine {
    private const val MIN_ACTOR_CLEARANCE_METERS = 0.72
    private const val MIN_TARGET_CLEARANCE_METERS = 0.45
    private const val FRAME_MARGIN_NDC = 0.04

    private val locomotion = setOf(
        NativeStoryAction.ENTER,
        NativeStoryAction.EXIT,
        NativeStoryAction.MOVE_TO,
        NativeStoryAction.WALK_TO,
        NativeStoryAction.RUN_TO,
    )
    private val interaction = setOf(
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

    fun execute(
        performance: NativePhase4ActorPerformance,
        aspectRatio: Double = 16.0 / 9.0,
    ): NativePhase5DirectorResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (!performance.acceptance.done) {
            diagnostics += NativeDiagnostic("PHASE5_PERFORMANCE", "Phase 5 requires a Phase-4 performance that has passed its DONE gate.")
        }
        if (!Regex("^[0-9a-f]{40}$").matches(performance.canonical.sourceCommit)) {
            diagnostics += NativeDiagnostic("PHASE5_SOURCE_IDENTITY", "Phase 5 requires the exact 40-character source commit from the accepted performance.")
        }
        if (!aspectRatio.isFinite() || aspectRatio <= 0.0) {
            diagnostics += NativeDiagnostic("PHASE5_ASPECT", "Phase 5 requires a positive finite output aspect ratio.")
        }
        if (performance.steps.isEmpty() || !performance.canonical.durationSeconds.isFinite() || performance.canonical.durationSeconds <= 0.0) {
            diagnostics += NativeDiagnostic("PHASE5_TIMELINE", "Phase 5 requires a non-empty finite Phase-4 performance timeline.")
        }
        if (diagnostics.isNotEmpty()) return NativePhase5DirectorResult.Rejected(diagnostics)

        val shots = performance.steps.mapIndexed { index, step -> buildShot(index, step) }
        val samples = shots.flatMap { shot ->
            val step = performance.steps.first { it.sourceEventId == shot.sourceEventId }
            listOf(
                safetySample(shot, shot.startPose, step.rootStart, step.targetAnchor, aspectRatio),
                safetySample(shot, interpolatePose(shot, 0.5), midpoint(step.rootStart, step.rootEnd), step.targetAnchor, aspectRatio),
                safetySample(shot, shot.endPose, step.rootEnd, step.targetAnchor, aspectRatio),
            )
        }
        val acceptance = validate(performance, shots, samples)
        if (!acceptance.done) {
            val failed = buildList {
                if (!acceptance.shotLanguageGate) add("shot-language")
                if (!acceptance.framingLensGate) add("framing/lens")
                if (!acceptance.motionGate) add("motion")
                if (!acceptance.visibilityGate) add("visibility")
                if (!acceptance.collisionGate) add("collision")
                if (!acceptance.eyelineContinuityGate) add("eyeline-continuity")
                if (!acceptance.onePerformanceManyCamerasGate) add("one-performance-many-cameras")
                if (!acceptance.storyIntentSelectionGate) add("story-intent-selection")
            }
            return NativePhase5DirectorResult.Rejected(
                listOf(NativeDiagnostic("PHASE5_ACCEPTANCE", "Virtual director acceptance failed: ${failed.joinToString(", ")}.") ),
            )
        }

        return NativePhase5DirectorResult.Ready(
            NativePhase5CameraPlan(
                assetId = performance.assetId,
                actorId = performance.canonical.actorId,
                shotId = performance.canonical.shotId,
                sourceCommit = performance.canonical.sourceCommit,
                performance = performance,
                shots = shots,
                safetySamples = samples,
                acceptance = acceptance,
            ),
        )
    }

    private data class Language(
        val size: NativePhase5ShotSize,
        val lensMm: Double,
        val angle: NativePhase5CameraAngle,
        val motion: NativePhase5CameraMotion,
        val distance: Double,
        val targetY: Double,
        val intent: String,
    )

    private fun languageFor(action: NativeStoryAction): Language = when {
        action in locomotion -> Language(
            NativePhase5ShotSize.WIDE, 35.0, NativePhase5CameraAngle.THREE_QUARTER,
            NativePhase5CameraMotion.TRACKING, 6.0, 1.0, "preserve blocking geography during locomotion",
        )
        action == NativeStoryAction.WAIT -> Language(
            NativePhase5ShotSize.FULL, 40.0, NativePhase5CameraAngle.EYE_LEVEL,
            NativePhase5CameraMotion.STATIC, 4.8, 1.0, "hold full-body continuity during pause",
        )
        action == NativeStoryAction.TURN_TO -> Language(
            NativePhase5ShotSize.MEDIUM, 50.0, NativePhase5CameraAngle.THREE_QUARTER,
            NativePhase5CameraMotion.ORBIT, 3.8, 1.18, "reveal turn direction while preserving screen side",
        )
        action == NativeStoryAction.LOOK_AT || action == NativeStoryAction.NOTICE || action == NativeStoryAction.SEARCH_FOR -> Language(
            NativePhase5ShotSize.MEDIUM, 55.0, NativePhase5CameraAngle.EYE_LEVEL,
            NativePhase5CameraMotion.PAN, 3.7, 1.30, "prioritize gaze and eyeline readability",
        )
        action in interaction -> Language(
            NativePhase5ShotSize.MEDIUM_CLOSE, 65.0, NativePhase5CameraAngle.THREE_QUARTER,
            NativePhase5CameraMotion.DOLLY_IN, 3.35, 1.38, "show hand-to-prop interaction clearly",
        )
        action == NativeStoryAction.REACT || action == NativeStoryAction.RESPOND -> Language(
            NativePhase5ShotSize.CLOSE_UP, 85.0, NativePhase5CameraAngle.EYE_LEVEL,
            NativePhase5CameraMotion.DOLLY_IN, 3.10, 1.53, "prioritize reaction and facial performance",
        )
        else -> Language(
            NativePhase5ShotSize.MEDIUM, 50.0, NativePhase5CameraAngle.EYE_LEVEL,
            NativePhase5CameraMotion.STATIC, 3.8, 1.25, "neutral coverage",
        )
    }

    private fun buildShot(index: Int, step: NativePhase4Step): NativePhase5Shot {
        val language = languageFor(step.action)
        val zone = NativePhase5CameraZone.FRONT_LEFT
        val sideOffset = when (language.size) {
            NativePhase5ShotSize.WIDE -> 1.05
            NativePhase5ShotSize.FULL -> 0.85
            NativePhase5ShotSize.MEDIUM -> 0.72
            NativePhase5ShotSize.MEDIUM_CLOSE -> 0.58
            NativePhase5ShotSize.CLOSE_UP -> 0.42
        }
        val cameraY = when (language.angle) {
            NativePhase5CameraAngle.LOW -> 0.95
            NativePhase5CameraAngle.HIGH -> 2.20
            NativePhase5CameraAngle.EYE_LEVEL -> 1.55
            NativePhase5CameraAngle.THREE_QUARTER -> 1.60
        }
        val startRoot = step.rootStart
        val endRoot = step.rootEnd
        val startDistance = language.distance
        val endDistance = when (language.motion) {
            NativePhase5CameraMotion.DOLLY_IN -> language.distance - 0.22
            NativePhase5CameraMotion.DOLLY_OUT -> language.distance + 0.22
            else -> language.distance
        }
        val orbitDelta = if (language.motion == NativePhase5CameraMotion.ORBIT) 0.22 else 0.0
        val followEndRoot = language.motion == NativePhase5CameraMotion.TRACKING
        val endCameraRoot = if (followEndRoot) endRoot else startRoot
        val fov = verticalFovDegrees(language.lensMm)
        val startTarget = NativeStagePoint(startRoot.x, startRoot.y + language.targetY, startRoot.z)
        val endTargetRoot = if (language.motion in setOf(NativePhase5CameraMotion.TRACKING, NativePhase5CameraMotion.PAN, NativePhase5CameraMotion.ORBIT)) endRoot else startRoot
        val endTarget = NativeStagePoint(endTargetRoot.x, endTargetRoot.y + language.targetY, endTargetRoot.z)
        val startPose = NativePhase5CameraPose(
            step.startTimeSeconds,
            NativeStagePoint(startRoot.x + sideOffset, startRoot.y + cameraY, startRoot.z + startDistance),
            startTarget,
            fov,
        )
        val endPose = NativePhase5CameraPose(
            step.endTimeSeconds,
            NativeStagePoint(endCameraRoot.x + sideOffset + orbitDelta, endCameraRoot.y + cameraY, endCameraRoot.z + endDistance),
            endTarget,
            fov,
        )
        return NativePhase5Shot(
            id = "phase5-shot-${index + 1}-${step.action.name.lowercase()}",
            sourceEventId = step.sourceEventId,
            action = step.action,
            startTimeSeconds = step.startTimeSeconds,
            endTimeSeconds = step.endTimeSeconds,
            size = language.size,
            lensMm = language.lensMm,
            angle = language.angle,
            zone = zone,
            motion = language.motion,
            startPose = startPose,
            endPose = endPose,
            intent = language.intent,
        )
    }

    private fun verticalFovDegrees(lensMm: Double): Double = Math.toDegrees(2.0 * atan(12.0 / lensMm))

    private fun safetySample(
        shot: NativePhase5Shot,
        pose: NativePhase5CameraPose,
        actorRoot: NativeStagePoint,
        targetAnchor: NativeStagePoint?,
        aspect: Double,
    ): NativePhase5CameraSafetySample {
        val actorClearance = distance(pose.position, actorRoot)
        val targetClearance = targetAnchor?.let { distance(pose.position, it) }
        return NativePhase5CameraSafetySample(
            shotId = shot.id,
            timeSeconds = pose.timeSeconds,
            visible = framed(pose, actorRoot, shot.size, aspect),
            actorClearanceMeters = actorClearance,
            targetClearanceMeters = targetClearance,
            eyelineSide = sideOfActor(pose.position, actorRoot),
        )
    }

    private fun framed(
        pose: NativePhase5CameraPose,
        root: NativeStagePoint,
        size: NativePhase5ShotSize,
        aspect: Double,
    ): Boolean {
        val bounds = subjectBounds(root, size)
        val forward = normalize(sub(pose.target, pose.position)) ?: return false
        var right = normalize(cross(forward, NativeStagePoint(0.0, 1.0, 0.0)))
        if (right == null) right = normalize(cross(forward, NativeStagePoint(0.0, 0.0, 1.0)))
        right ?: return false
        val up = normalize(cross(right, forward)) ?: return false
        val tangent = tan(Math.toRadians(pose.verticalFovDegrees) / 2.0)
        if (!tangent.isFinite() || tangent <= 0.0) return false
        val limit = 1.0 - FRAME_MARGIN_NDC
        for (world in bounds) {
            val relative = sub(world, pose.position)
            val depth = dot(relative, forward)
            if (!depth.isFinite() || depth <= 0.05) return false
            val x = dot(relative, right) / (depth * tangent * aspect)
            val y = dot(relative, up) / (depth * tangent)
            if (!x.isFinite() || !y.isFinite() || x !in -limit..limit || y !in -limit..limit) return false
        }
        return true
    }

    private fun subjectBounds(root: NativeStagePoint, size: NativePhase5ShotSize): List<NativeStagePoint> {
        val (bottom, top, halfWidth) = when (size) {
            NativePhase5ShotSize.WIDE, NativePhase5ShotSize.FULL -> Triple(0.0, 1.80, 0.34)
            NativePhase5ShotSize.MEDIUM -> Triple(0.68, 1.80, 0.32)
            NativePhase5ShotSize.MEDIUM_CLOSE -> Triple(0.92, 1.80, 0.29)
            NativePhase5ShotSize.CLOSE_UP -> Triple(1.28, 1.80, 0.23)
        }
        return listOf(
            NativeStagePoint(root.x - halfWidth, root.y + bottom, root.z),
            NativeStagePoint(root.x + halfWidth, root.y + bottom, root.z),
            NativeStagePoint(root.x - halfWidth, root.y + top, root.z),
            NativeStagePoint(root.x + halfWidth, root.y + top, root.z),
            NativeStagePoint(root.x, root.y + (bottom + top) * 0.5, root.z),
        )
    }

    private fun validate(
        performance: NativePhase4ActorPerformance,
        shots: List<NativePhase5Shot>,
        samples: List<NativePhase5CameraSafetySample>,
    ): NativePhase5Acceptance {
        val ordered = shots.sortedBy { it.startTimeSeconds }
        val coversTimeline = ordered.size == performance.steps.size && ordered.zip(performance.steps).all { (shot, step) ->
            shot.sourceEventId == step.sourceEventId &&
                kotlin.math.abs(shot.startTimeSeconds - step.startTimeSeconds) < 1e-6 &&
                kotlin.math.abs(shot.endTimeSeconds - step.endTimeSeconds) < 1e-6
        }
        val shotLanguage = coversTimeline && shots.map { it.size }.distinct().size >= 4 && shots.all { it.intent.isNotBlank() }
        val framingLens = shots.all { it.lensMm in 24.0..120.0 && it.startPose.verticalFovDegrees in 10.0..60.0 } && samples.all { it.visible }
        val motionGate = shots.any { it.motion == NativePhase5CameraMotion.TRACKING } &&
            shots.any { it.motion == NativePhase5CameraMotion.ORBIT } &&
            shots.any { it.motion == NativePhase5CameraMotion.PAN } &&
            shots.any { it.motion == NativePhase5CameraMotion.DOLLY_IN }
        val collision = samples.all { sample ->
            sample.actorClearanceMeters >= MIN_ACTOR_CLEARANCE_METERS &&
                (sample.targetClearanceMeters == null || sample.targetClearanceMeters >= MIN_TARGET_CLEARANCE_METERS)
        }
        val nonZeroSides = samples.map { it.eyelineSide }.filter { it != 0 }
        val eyeline = nonZeroSides.isNotEmpty() && nonZeroSides.distinct().size == 1
        val manyCameras = shots.size >= 4 && shots.map { Triple(it.size, it.lensMm, it.motion) }.distinct().size >= 4
        val storyIntent = shots.any { it.action in locomotion && it.size == NativePhase5ShotSize.WIDE && it.motion == NativePhase5CameraMotion.TRACKING } &&
            shots.any { it.action in interaction && it.size == NativePhase5ShotSize.MEDIUM_CLOSE } &&
            shots.any { it.action == NativeStoryAction.REACT && it.size == NativePhase5ShotSize.CLOSE_UP }
        return NativePhase5Acceptance(
            shotLanguageGate = shotLanguage,
            framingLensGate = framingLens,
            motionGate = motionGate,
            visibilityGate = samples.all { it.visible },
            collisionGate = collision,
            eyelineContinuityGate = eyeline,
            onePerformanceManyCamerasGate = manyCameras,
            storyIntentSelectionGate = storyIntent,
        )
    }

    private fun interpolatePose(shot: NativePhase5Shot, amount: Double): NativePhase5CameraPose = NativePhase5CameraPose(
        timeSeconds = shot.startTimeSeconds + (shot.endTimeSeconds - shot.startTimeSeconds) * amount,
        position = lerp(shot.startPose.position, shot.endPose.position, amount),
        target = lerp(shot.startPose.target, shot.endPose.target, amount),
        verticalFovDegrees = shot.startPose.verticalFovDegrees + (shot.endPose.verticalFovDegrees - shot.startPose.verticalFovDegrees) * amount,
    )

    private fun sideOfActor(camera: NativeStagePoint, actor: NativeStagePoint): Int {
        val delta = camera.x - actor.x
        return when {
            delta > 1e-4 -> 1
            delta < -1e-4 -> -1
            else -> 0
        }
    }

    private fun midpoint(a: NativeStagePoint, b: NativeStagePoint) = lerp(a, b, 0.5)
    private fun lerp(a: NativeStagePoint, b: NativeStagePoint, amount: Double) = NativeStagePoint(
        a.x + (b.x - a.x) * amount,
        a.y + (b.y - a.y) * amount,
        a.z + (b.z - a.z) * amount,
    )
    private fun sub(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x - b.x, a.y - b.y, a.z - b.z)
    private fun dot(a: NativeStagePoint, b: NativeStagePoint) = a.x * b.x + a.y * b.y + a.z * b.z
    private fun cross(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )
    private fun normalize(value: NativeStagePoint): NativeStagePoint? {
        val length = hypot(hypot(value.x, value.y), value.z)
        return if (length.isFinite() && length > 1e-7) NativeStagePoint(value.x / length, value.y / length, value.z / length) else null
    }
    private fun distance(a: NativeStagePoint, b: NativeStagePoint): Double = hypot(hypot(a.x - b.x, a.y - b.y), a.z - b.z)
}
