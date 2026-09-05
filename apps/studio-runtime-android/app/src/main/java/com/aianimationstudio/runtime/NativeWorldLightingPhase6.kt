package com.aianimationstudio.runtime

import kotlin.math.acos
import kotlin.math.max
import kotlin.math.sqrt

internal enum class NativePhase6AnchorKind { ACTOR_MARK, PROP, LIGHT, ENVIRONMENT }
internal enum class NativePhase6PropMode { STAGED, HELD, IN_USE, PLACED, OPEN, CLOSED, LOCKED, UNLOCKED }
internal enum class NativePhase6LightRole { KEY, FILL, RIM, ENVIRONMENT }

internal data class NativePhase6Anchor(
    val id: String,
    val semanticId: String,
    val kind: NativePhase6AnchorKind,
    val position: NativeStagePoint,
)

internal data class NativePhase6Obstacle(
    val id: String,
    val center: NativeStagePoint,
    val radiusMeters: Double,
)

internal data class NativePhase6Environment(
    val id: String,
    val min: NativeStagePoint,
    val max: NativeStagePoint,
    val obstacles: List<NativePhase6Obstacle>,
)

internal data class NativePhase6PropState(
    val mode: NativePhase6PropMode,
    val ownerActorId: String?,
    val anchorId: String,
)

internal data class NativePhase6Prop(
    val id: String,
    val semanticId: String,
    val radiusMeters: Double,
    val initialState: NativePhase6PropState,
)

internal data class NativePhase6Light(
    val id: String,
    val role: NativePhase6LightRole,
    val anchorId: String?,
    val intensityLux: Double,
)

internal data class NativePhase6WorldState(
    val sourceCommit: String,
    val shotId: String,
    val actorId: String,
    val environment: NativePhase6Environment,
    val anchors: List<NativePhase6Anchor>,
    val props: List<NativePhase6Prop>,
    val lights: List<NativePhase6Light>,
)

internal data class NativePhase6ResolvedStep(
    val sourceEventId: String,
    val action: NativeStoryAction,
    val targetId: String?,
    val startTimeSeconds: Double,
    val midpointTimeSeconds: Double,
    val endTimeSeconds: Double,
    val rootStart: NativeStagePoint,
    val rootEnd: NativeStagePoint,
    val targetAnchor: NativeStagePoint?,
)

internal data class NativePhase6ResolvedShot(
    val sourceShot: NativePhase5Shot,
    val startPose: NativePhase5CameraPose,
    val endPose: NativePhase5CameraPose,
)

internal data class NativePhase6PropTransition(
    val timeSeconds: Double,
    val propId: String,
    val before: NativePhase6PropState,
    val after: NativePhase6PropState,
    val action: NativeStoryAction,
)

internal data class NativePhase6CollisionSample(
    val entityId: String,
    val timeSeconds: Double,
    val minimumClearanceMeters: Double,
    val insideEnvironment: Boolean,
    val safe: Boolean,
)

internal data class NativePhase6LightingSample(
    val shotId: String,
    val timeSeconds: Double,
    val exposureScore: Double,
    val keyCameraAngleDegrees: Double,
    val rimCameraAngleDegrees: Double,
    val cameraAware: Boolean,
    val subjectVisible: Boolean,
)

internal data class NativePhase6Acceptance(
    val canonicalAnchorsGate: Boolean,
    val worldAnchorReplacementGate: Boolean,
    val propStateGate: Boolean,
    val collisionGate: Boolean,
    val lightingRigGate: Boolean,
    val exposureVisibilityGate: Boolean,
    val cameraAwareLightingGate: Boolean,
    val deterministicSpatialStateGate: Boolean,
) {
    val done: Boolean
        get() = canonicalAnchorsGate && worldAnchorReplacementGate && propStateGate && collisionGate &&
            lightingRigGate && exposureVisibilityGate && cameraAwareLightingGate && deterministicSpatialStateGate
}

internal data class NativePhase6ProductionPlan(
    val world: NativePhase6WorldState,
    val performance: NativePhase4ActorPerformance,
    val cameraPlan: NativePhase5CameraPlan,
    val resolvedSteps: List<NativePhase6ResolvedStep>,
    val resolvedShots: List<NativePhase6ResolvedShot>,
    val propTransitions: List<NativePhase6PropTransition>,
    val finalPropStates: Map<String, NativePhase6PropState>,
    val collisionSamples: List<NativePhase6CollisionSample>,
    val lightingSamples: List<NativePhase6LightingSample>,
    val acceptance: NativePhase6Acceptance,
)

internal sealed interface NativePhase6WorldLightingResult {
    data class Ready(val plan: NativePhase6ProductionPlan) : NativePhase6WorldLightingResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase6WorldLightingResult
}

/**
 * Phase-6 canonical world + lighting integration.
 *
 * Phase 4 and Phase 5 remain immutable source contracts. This layer resolves their shot-local rehearsal
 * anchors into canonical world anchors, rebases the accepted camera coverage onto that resolved spatial
 * state, applies deterministic prop state transitions, verifies actor/camera collision clearance, and
 * evaluates a deterministic camera-aware key/fill/rim/environment lighting rig.
 */
internal object NativeWorldLightingPhase6Engine {
    private const val ACTOR_RADIUS_METERS = 0.32
    private const val CAMERA_RADIUS_METERS = 0.15
    private const val MIN_CLEARANCE_METERS = 0.08
    private const val TARGET_STOP_DISTANCE_METERS = 0.85

    private val locomotionActions = setOf(
        NativeStoryAction.ENTER,
        NativeStoryAction.EXIT,
        NativeStoryAction.MOVE_TO,
        NativeStoryAction.WALK_TO,
        NativeStoryAction.RUN_TO,
    )

    private val propActions = setOf(
        NativeStoryAction.PICK_UP,
        NativeStoryAction.PUT_DOWN,
        NativeStoryAction.GIVE,
        NativeStoryAction.RECEIVE,
        NativeStoryAction.USE,
        NativeStoryAction.OPEN,
        NativeStoryAction.CLOSE,
        NativeStoryAction.LOCK,
        NativeStoryAction.UNLOCK,
    )

    fun execute(
        performance: NativePhase4ActorPerformance,
        cameraPlan: NativePhase5CameraPlan,
        world: NativePhase6WorldState,
    ): NativePhase6WorldLightingResult {
        val diagnostics = validateInputs(performance, cameraPlan, world)
        if (diagnostics.isNotEmpty()) return NativePhase6WorldLightingResult.Rejected(diagnostics)

        val anchorBySemantic = world.anchors.associateBy { it.semanticId }
        val resolvedSteps = resolveSteps(performance, anchorBySemantic)
        val resolvedShots = resolveShots(performance, cameraPlan, resolvedSteps)
        val (transitions, finalPropStates, propStateGate) = resolvePropStates(performance.canonical.actorId, world, resolvedSteps)
        val collisionSamples = buildCollisionSamples(world, resolvedSteps, resolvedShots)
        val lightingSamples = buildLightingSamples(world, resolvedSteps, resolvedShots)

        val targeted = performance.steps.filter { it.targetId != null }
        val canonicalAnchorsGate = targeted.all { step -> anchorBySemantic.containsKey(requireNotNull(step.targetId)) }
        val worldAnchorReplacementGate = targeted.isNotEmpty() && targeted.all { step ->
            val resolved = resolvedSteps.first { it.sourceEventId == step.sourceEventId }
            resolved.targetAnchor == anchorBySemantic[requireNotNull(step.targetId)]?.position
        } && targeted.any { step ->
            val resolved = resolvedSteps.first { it.sourceEventId == step.sourceEventId }
            val rehearsal = step.targetAnchor
            rehearsal != null && resolved.targetAnchor != null && distance(rehearsal, resolved.targetAnchor) > 0.05
        }
        val collisionGate = collisionSamples.isNotEmpty() && collisionSamples.all { it.safe }
        val lightingRigGate = NativePhase6LightRole.entries.all { role -> world.lights.count { it.role == role } == 1 }
        val exposureVisibilityGate = lightingSamples.isNotEmpty() && lightingSamples.all { it.subjectVisible }
        val cameraAwareLightingGate = lightingSamples.isNotEmpty() && lightingSamples.all { it.cameraAware }
        val deterministicSpatialStateGate = resolvedSteps.size == performance.steps.size &&
            resolvedShots.size == cameraPlan.shots.size &&
            resolvedSteps.all { finite(it.rootStart) && finite(it.rootEnd) && (it.targetAnchor == null || finite(it.targetAnchor)) }

        val acceptance = NativePhase6Acceptance(
            canonicalAnchorsGate = canonicalAnchorsGate,
            worldAnchorReplacementGate = worldAnchorReplacementGate,
            propStateGate = propStateGate,
            collisionGate = collisionGate,
            lightingRigGate = lightingRigGate,
            exposureVisibilityGate = exposureVisibilityGate,
            cameraAwareLightingGate = cameraAwareLightingGate,
            deterministicSpatialStateGate = deterministicSpatialStateGate,
        )
        if (!acceptance.done) {
            val failed = buildList {
                if (!acceptance.canonicalAnchorsGate) add("canonical-anchors")
                if (!acceptance.worldAnchorReplacementGate) add("world-anchor-replacement")
                if (!acceptance.propStateGate) add("prop-state")
                if (!acceptance.collisionGate) add("collision")
                if (!acceptance.lightingRigGate) add("lighting-rig")
                if (!acceptance.exposureVisibilityGate) add("exposure/visibility")
                if (!acceptance.cameraAwareLightingGate) add("camera-aware-lighting")
                if (!acceptance.deterministicSpatialStateGate) add("deterministic-spatial-state")
            }
            return NativePhase6WorldLightingResult.Rejected(
                listOf(NativeDiagnostic("PHASE6_ACCEPTANCE", "World + lighting acceptance failed: ${failed.joinToString(", ")}.") ),
            )
        }

        return NativePhase6WorldLightingResult.Ready(
            NativePhase6ProductionPlan(
                world = world,
                performance = performance,
                cameraPlan = cameraPlan,
                resolvedSteps = resolvedSteps,
                resolvedShots = resolvedShots,
                propTransitions = transitions,
                finalPropStates = finalPropStates,
                collisionSamples = collisionSamples,
                lightingSamples = lightingSamples,
                acceptance = acceptance,
            ),
        )
    }

    private fun validateInputs(
        performance: NativePhase4ActorPerformance,
        cameraPlan: NativePhase5CameraPlan,
        world: NativePhase6WorldState,
    ): List<NativeDiagnostic> {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (!performance.acceptance.done) diagnostics += NativeDiagnostic("PHASE6_PERFORMANCE", "Phase 6 requires an accepted Phase-4 performance.")
        if (!cameraPlan.acceptance.done) diagnostics += NativeDiagnostic("PHASE6_CAMERA", "Phase 6 requires an accepted Phase-5 camera plan.")
        if (world.sourceCommit != performance.canonical.sourceCommit || world.sourceCommit != cameraPlan.sourceCommit) {
            diagnostics += NativeDiagnostic("PHASE6_SOURCE_IDENTITY", "World, performance and camera plan must share the same exact source commit.")
        }
        if (world.actorId != performance.canonical.actorId || world.actorId != cameraPlan.actorId) {
            diagnostics += NativeDiagnostic("PHASE6_ACTOR_IDENTITY", "World, performance and camera plan actor identities must match.")
        }
        if (world.shotId != performance.canonical.shotId || world.shotId != cameraPlan.shotId) {
            diagnostics += NativeDiagnostic("PHASE6_SHOT_IDENTITY", "World, performance and camera plan shot identities must match.")
        }
        val anchorIds = world.anchors.map { it.id }
        val semanticIds = world.anchors.map { it.semanticId }
        if (anchorIds.any { it.isBlank() } || anchorIds.toSet().size != anchorIds.size || semanticIds.any { it.isBlank() } || semanticIds.toSet().size != semanticIds.size) {
            diagnostics += NativeDiagnostic("PHASE6_ANCHOR_IDENTITY", "Canonical world anchors require unique non-empty ids and semantic ids.")
        }
        if (!finite(world.environment.min) || !finite(world.environment.max) ||
            world.environment.min.x >= world.environment.max.x || world.environment.min.y >= world.environment.max.y || world.environment.min.z >= world.environment.max.z) {
            diagnostics += NativeDiagnostic("PHASE6_ENVIRONMENT", "Environment bounds must be finite and ordered.")
        }
        if (world.anchors.any { !finite(it.position) || !inside(world.environment, it.position) }) {
            diagnostics += NativeDiagnostic("PHASE6_ANCHOR_BOUNDS", "Every canonical anchor must be finite and inside the environment bounds.")
        }
        if (world.environment.obstacles.any { !finite(it.center) || !it.radiusMeters.isFinite() || it.radiusMeters <= 0.0 || !inside(world.environment, it.center) }) {
            diagnostics += NativeDiagnostic("PHASE6_OBSTACLE", "Every world obstacle requires a finite in-bounds center and positive radius.")
        }
        val anchorsById = world.anchors.associateBy { it.id }
        if (world.props.any { it.id.isBlank() || it.semanticId.isBlank() || !it.radiusMeters.isFinite() || it.radiusMeters <= 0.0 || anchorsById[it.initialState.anchorId]?.kind != NativePhase6AnchorKind.PROP }) {
            diagnostics += NativeDiagnostic("PHASE6_PROP", "Every prop requires a valid canonical PROP anchor and positive collision radius.")
        }
        if (world.lights.any { it.id.isBlank() || !it.intensityLux.isFinite() || it.intensityLux <= 0.0 || (it.role != NativePhase6LightRole.ENVIRONMENT && anchorsById[it.anchorId]?.kind != NativePhase6AnchorKind.LIGHT) }) {
            diagnostics += NativeDiagnostic("PHASE6_LIGHT", "Key/fill/rim lights require canonical LIGHT anchors and all light intensities must be positive.")
        }
        return diagnostics.distinctBy { it.code to it.message }
    }

    private fun resolveSteps(
        performance: NativePhase4ActorPerformance,
        anchorBySemantic: Map<String, NativePhase6Anchor>,
    ): List<NativePhase6ResolvedStep> {
        var root = performance.steps.first().rootStart
        return performance.steps.map { step ->
            val target = step.targetId?.let { anchorBySemantic[it]?.position }
            val endRoot = if (step.action in locomotionActions && target != null) approachPoint(root, target, TARGET_STOP_DISTANCE_METERS) else root
            NativePhase6ResolvedStep(
                sourceEventId = step.sourceEventId,
                action = step.action,
                targetId = step.targetId,
                startTimeSeconds = step.startTimeSeconds,
                midpointTimeSeconds = step.midpointTimeSeconds,
                endTimeSeconds = step.endTimeSeconds,
                rootStart = root,
                rootEnd = endRoot,
                targetAnchor = target,
            ).also { root = endRoot }
        }
    }

    private fun resolveShots(
        performance: NativePhase4ActorPerformance,
        cameraPlan: NativePhase5CameraPlan,
        resolvedSteps: List<NativePhase6ResolvedStep>,
    ): List<NativePhase6ResolvedShot> = cameraPlan.shots.map { shot ->
        val original = performance.steps.first { it.sourceEventId == shot.sourceEventId }
        val resolved = resolvedSteps.first { it.sourceEventId == shot.sourceEventId }
        val startDelta = sub(resolved.rootStart, original.rootStart)
        val endDelta = sub(resolved.rootEnd, original.rootEnd)
        NativePhase6ResolvedShot(
            sourceShot = shot,
            startPose = shot.startPose.copy(
                position = add(shot.startPose.position, startDelta),
                target = add(shot.startPose.target, startDelta),
            ),
            endPose = shot.endPose.copy(
                position = add(shot.endPose.position, endDelta),
                target = add(shot.endPose.target, endDelta),
            ),
        )
    }

    private fun resolvePropStates(
        actorId: String,
        world: NativePhase6WorldState,
        steps: List<NativePhase6ResolvedStep>,
    ): Triple<List<NativePhase6PropTransition>, Map<String, NativePhase6PropState>, Boolean> {
        val propsBySemantic = world.props.associateBy { it.semanticId }
        val states = world.props.associate { it.id to it.initialState }.toMutableMap()
        val transitions = mutableListOf<NativePhase6PropTransition>()
        var valid = true
        steps.filter { it.action in propActions }.forEach { step ->
            val prop = step.targetId?.let { propsBySemantic[it] }
            if (prop == null) {
                valid = false
                return@forEach
            }
            val before = requireNotNull(states[prop.id])
            val after = when (step.action) {
                NativeStoryAction.PICK_UP, NativeStoryAction.RECEIVE -> before.copy(mode = NativePhase6PropMode.HELD, ownerActorId = actorId)
                NativeStoryAction.USE -> {
                    if (before.ownerActorId != actorId) valid = false
                    before.copy(mode = NativePhase6PropMode.IN_USE, ownerActorId = actorId)
                }
                NativeStoryAction.PUT_DOWN, NativeStoryAction.GIVE -> before.copy(mode = NativePhase6PropMode.PLACED, ownerActorId = null)
                NativeStoryAction.OPEN -> before.copy(mode = NativePhase6PropMode.OPEN)
                NativeStoryAction.CLOSE -> before.copy(mode = NativePhase6PropMode.CLOSED)
                NativeStoryAction.LOCK -> before.copy(mode = NativePhase6PropMode.LOCKED)
                NativeStoryAction.UNLOCK -> before.copy(mode = NativePhase6PropMode.UNLOCKED)
                else -> before
            }
            states[prop.id] = after
            transitions += NativePhase6PropTransition(step.endTimeSeconds, prop.id, before, after, step.action)
        }
        return Triple(transitions, states.toMap(), valid && transitions.isNotEmpty())
    }

    private fun buildCollisionSamples(
        world: NativePhase6WorldState,
        steps: List<NativePhase6ResolvedStep>,
        shots: List<NativePhase6ResolvedShot>,
    ): List<NativePhase6CollisionSample> {
        val propCenters = world.props.mapNotNull { prop ->
            val anchor = world.anchors.firstOrNull { it.id == prop.initialState.anchorId } ?: return@mapNotNull null
            Triple(prop.id, anchor.position, prop.radiusMeters)
        }
        val actorSamples = steps.flatMap { step ->
            listOf(
                step.startTimeSeconds to step.rootStart,
                step.midpointTimeSeconds to midpoint(step.rootStart, step.rootEnd),
                step.endTimeSeconds to step.rootEnd,
            )
        }.distinctBy { it.first }
        val cameraSamples = shots.flatMap { shot ->
            listOf(
                shot.startPose.timeSeconds to shot.startPose.position,
                shot.endPose.timeSeconds to shot.endPose.position,
            )
        }
        return buildList {
            actorSamples.forEach { (time, point) ->
                val clearance = minimumClearance(point, ACTOR_RADIUS_METERS, world, propCenters)
                add(NativePhase6CollisionSample("actor:${world.actorId}", time, clearance, inside(world.environment, point), inside(world.environment, point) && clearance >= MIN_CLEARANCE_METERS))
            }
            cameraSamples.forEach { (time, point) ->
                val clearance = minimumClearance(point, CAMERA_RADIUS_METERS, world, propCenters)
                add(NativePhase6CollisionSample("camera", time, clearance, inside(world.environment, point), inside(world.environment, point) && clearance >= MIN_CLEARANCE_METERS))
            }
        }
    }

    private fun minimumClearance(
        point: NativeStagePoint,
        radius: Double,
        world: NativePhase6WorldState,
        props: List<Triple<String, NativeStagePoint, Double>>,
    ): Double {
        val obstacleClearance = world.environment.obstacles.minOfOrNull { distance(point, it.center) - radius - it.radiusMeters } ?: Double.POSITIVE_INFINITY
        val propClearance = props.minOfOrNull { (_, center, propRadius) -> distance(point, center) - radius - propRadius } ?: Double.POSITIVE_INFINITY
        return minOf(obstacleClearance, propClearance)
    }

    private fun buildLightingSamples(
        world: NativePhase6WorldState,
        steps: List<NativePhase6ResolvedStep>,
        shots: List<NativePhase6ResolvedShot>,
    ): List<NativePhase6LightingSample> {
        val anchors = world.anchors.associateBy { it.id }
        val key = world.lights.single { it.role == NativePhase6LightRole.KEY }
        val fill = world.lights.single { it.role == NativePhase6LightRole.FILL }
        val rim = world.lights.single { it.role == NativePhase6LightRole.RIM }
        val environment = world.lights.single { it.role == NativePhase6LightRole.ENVIRONMENT }
        val keyPosition = requireNotNull(anchors[key.anchorId]).position
        val rimPosition = requireNotNull(anchors[rim.anchorId]).position
        return shots.flatMap { shot ->
            val step = steps.first { it.sourceEventId == shot.sourceShot.sourceEventId }
            listOf(0.0, 0.5, 1.0).map { t ->
                val time = lerp(shot.startPose.timeSeconds, shot.endPose.timeSeconds, t)
                val actor = interpolate(step.rootStart, step.rootEnd, t)
                val camera = interpolate(shot.startPose.position, shot.endPose.position, t)
                val keyAngle = angleDegrees(sub(camera, actor), sub(keyPosition, actor))
                val rimAngle = angleDegrees(sub(camera, actor), sub(rimPosition, actor))
                val keyShape = max(0.25, 1.0 - kotlin.math.abs(keyAngle - 45.0) / 120.0)
                val exposure = (key.intensityLux / 1000.0) * keyShape +
                    (fill.intensityLux / 1000.0) * 0.55 +
                    (rim.intensityLux / 1000.0) * 0.25 +
                    (environment.intensityLux / 1000.0) * 0.35
                val cameraAware = keyAngle in 15.0..120.0 && rimAngle in 85.0..180.0 && fill.intensityLux <= key.intensityLux
                NativePhase6LightingSample(
                    shotId = shot.sourceShot.id,
                    timeSeconds = time,
                    exposureScore = exposure,
                    keyCameraAngleDegrees = keyAngle,
                    rimCameraAngleDegrees = rimAngle,
                    cameraAware = cameraAware,
                    subjectVisible = exposure in 0.45..1.60,
                )
            }
        }
    }

    private fun inside(environment: NativePhase6Environment, point: NativeStagePoint): Boolean =
        point.x in environment.min.x..environment.max.x &&
            point.y in environment.min.y..environment.max.y &&
            point.z in environment.min.z..environment.max.z

    private fun approachPoint(from: NativeStagePoint, target: NativeStagePoint, stopDistance: Double): NativeStagePoint {
        val delta = sub(target, from)
        val planar = sqrt(delta.x * delta.x + delta.z * delta.z)
        if (!planar.isFinite() || planar <= stopDistance) return from
        val scale = (planar - stopDistance) / planar
        return NativeStagePoint(from.x + delta.x * scale, from.y, from.z + delta.z * scale)
    }

    private fun angleDegrees(a: NativeStagePoint, b: NativeStagePoint): Double {
        val aLength = length(a)
        val bLength = length(b)
        if (aLength <= 1e-9 || bLength <= 1e-9) return Double.NaN
        val cosine = (dot(a, b) / (aLength * bLength)).coerceIn(-1.0, 1.0)
        return Math.toDegrees(acos(cosine))
    }

    private fun interpolate(a: NativeStagePoint, b: NativeStagePoint, t: Double) = NativeStagePoint(
        lerp(a.x, b.x, t),
        lerp(a.y, b.y, t),
        lerp(a.z, b.z, t),
    )

    private fun midpoint(a: NativeStagePoint, b: NativeStagePoint) = interpolate(a, b, 0.5)
    private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * t
    private fun add(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x + b.x, a.y + b.y, a.z + b.z)
    private fun sub(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x - b.x, a.y - b.y, a.z - b.z)
    private fun dot(a: NativeStagePoint, b: NativeStagePoint) = a.x * b.x + a.y * b.y + a.z * b.z
    private fun length(a: NativeStagePoint) = sqrt(dot(a, a))
    private fun distance(a: NativeStagePoint, b: NativeStagePoint) = length(sub(a, b))
    private fun finite(point: NativeStagePoint?) = point != null && point.x.isFinite() && point.y.isFinite() && point.z.isFinite()
}
