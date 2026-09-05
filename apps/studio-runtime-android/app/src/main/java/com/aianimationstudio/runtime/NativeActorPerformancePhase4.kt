package com.aianimationstudio.runtime

import kotlin.math.abs

internal enum class NativePhase4ContactKind {
    LEFT_FOOT,
    RIGHT_FOOT,
    RIGHT_HAND,
    PROP_GRASP,
}

internal data class NativePhase4ContactConstraint(
    val kind: NativePhase4ContactKind,
    val targetId: String?,
    val startTimeSeconds: Double,
    val endTimeSeconds: Double,
    val anchor: NativeStagePoint,
    val solvedPosition: NativeStagePoint,
    val maxErrorMeters: Double,
)

internal data class NativePhase4EmotionKeyframe(
    val timeSeconds: Double,
    val label: String,
    val valence: Double,
    val arousal: Double,
    val intensity: Double,
)

internal data class NativePhase4MicroPerformanceKeyframe(
    val timeSeconds: Double,
    val breathAmount: Double,
    val blinkAmount: Double,
    val gazeFocus: Double,
    val headLeadDegrees: Double,
)

internal data class NativePhase4Step(
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

internal data class NativePhase4Acceptance(
    val scriptCoverageGate: Boolean,
    val rootMotionGate: Boolean,
    val retargetingGate: Boolean,
    val contactIkGate: Boolean,
    val layeredActingGate: Boolean,
    val emotionReactionGate: Boolean,
    val continuityGate: Boolean,
) {
    val done: Boolean
        get() = scriptCoverageGate &&
            rootMotionGate &&
            retargetingGate &&
            contactIkGate &&
            layeredActingGate &&
            emotionReactionGate &&
            continuityGate
}

internal data class NativePhase4ActorPerformance(
    val assetId: String,
    val canonical: NativeActingPerformance,
    val steps: List<NativePhase4Step>,
    val contacts: List<NativePhase4ContactConstraint>,
    val emotions: List<NativePhase4EmotionKeyframe>,
    val microPerformance: List<NativePhase4MicroPerformanceKeyframe>,
    val acceptance: NativePhase4Acceptance,
)

internal sealed interface NativePhase4PerformanceResult {
    data class Ready(val performance: NativePhase4ActorPerformance) : NativePhase4PerformanceResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase4PerformanceResult
}

/**
 * Phase-4 deterministic actor-performance engine.
 *
 * This deliberately does not own production world layout (Phase 6). Until canonical world anchors
 * are connected, target ids resolve to stable shot-local rehearsal anchors. Those anchors are explicit
 * and replaceable; contact is never silently fabricated inside the renderer.
 */
internal object NativeActorPerformancePhase4Engine {
    private val interactionActions = setOf(
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

    private val locomotionActions = setOf(
        NativeStoryAction.ENTER,
        NativeStoryAction.EXIT,
        NativeStoryAction.MOVE_TO,
        NativeStoryAction.WALK_TO,
        NativeStoryAction.RUN_TO,
    )

    fun execute(
        asset: NativeCharacterAsset3D,
        shotId: String,
        story: NativeStoryCompileResult,
        durationSeconds: Double,
        actorOrigin: NativeStagePoint = NativeStagePoint(0.0, 0.0, 0.0),
    ): NativePhase4PerformanceResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        diagnostics += NativeCharacterAsset3DValidator.validate(asset)
        if (shotId.isBlank()) diagnostics += NativeDiagnostic("PHASE4_SHOT_ID", "Phase-4 performance requires a non-empty shot id.")
        if (!story.ok || story.ir.events.isEmpty()) diagnostics += story.diagnostics + NativeDiagnostic("PHASE4_STORY", "Phase-4 performance requires executable story events.")
        if (!durationSeconds.isFinite() || durationSeconds <= 0.0) diagnostics += NativeDiagnostic("PHASE4_DURATION", "Phase-4 performance requires a positive finite duration.")
        if (!finite(actorOrigin)) diagnostics += NativeDiagnostic("PHASE4_ORIGIN", "Phase-4 performance requires a finite actor origin.")
        if (story.ir.events.any { it.actorId != asset.actorId }) diagnostics += NativeDiagnostic("PHASE4_ACTOR_IDENTITY", "Story actor identity does not match the reusable character asset.")
        if (diagnostics.isNotEmpty()) return NativePhase4PerformanceResult.Rejected(diagnostics.distinctBy { it.code to it.message })

        val instance = when (val result = NativeCharacterAsset3DFactory.instantiate(asset, shotId)) {
            is NativeCharacterAssetInstantiation3DResult.Ready -> result.instance
            is NativeCharacterAssetInstantiation3DResult.Rejected -> return NativePhase4PerformanceResult.Rejected(result.diagnostics)
        }
        val rig = instance.rig
        val semanticRoles = rig.skeleton.bones.mapNotNull { it.semanticRole }.toSet()

        val steps = buildSteps(story.ir.events, durationSeconds, actorOrigin)
        val intents = story.ir.events.flatMap(::lowerEvent)
        val tracks = buildTracks(steps, durationSeconds, actorOrigin)
        val contacts = buildContacts(steps)
        val emotions = buildEmotions(steps, durationSeconds)
        val micro = buildMicroPerformance(steps, durationSeconds)

        val canonical = NativeActingPerformance(
            actorId = asset.actorId,
            shotId = shotId,
            sourceCommit = asset.sourceCommit,
            story = story.ir,
            intents = intents,
            tracks = tracks,
            durationSeconds = durationSeconds,
        )
        val acceptance = validateAcceptance(canonical, steps, contacts, emotions, micro, semanticRoles)
        if (!acceptance.continuityGate || !acceptance.retargetingGate) {
            return NativePhase4PerformanceResult.Rejected(
                listOf(
                    NativeDiagnostic(
                        "PHASE4_STRUCTURAL_ACCEPTANCE",
                        "Generated actor performance failed retargeting or continuity validation.",
                    ),
                ),
            )
        }

        return NativePhase4PerformanceResult.Ready(
            NativePhase4ActorPerformance(
                assetId = asset.assetId,
                canonical = canonical,
                steps = steps,
                contacts = contacts,
                emotions = emotions,
                microPerformance = micro,
                acceptance = acceptance,
            ),
        )
    }

    private fun buildSteps(
        events: List<NativeStoryEvent>,
        duration: Double,
        origin: NativeStagePoint,
    ): List<NativePhase4Step> {
        val slice = duration / events.size.toDouble()
        var root = origin
        return events.mapIndexed { index, event ->
            val start = slice * index
            val end = if (index == events.lastIndex) duration else slice * (index + 1)
            val midpoint = (start + end) * 0.5
            val targetAnchor = event.targetId?.let { rehearsalAnchor(it, origin) }
            val endRoot = if (event.type in locomotionActions && targetAnchor != null) {
                approachPoint(root, targetAnchor, 0.52)
            } else {
                root
            }
            NativePhase4Step(
                sourceEventId = event.id,
                action = event.type,
                targetId = event.targetId,
                startTimeSeconds = start,
                midpointTimeSeconds = midpoint,
                endTimeSeconds = end,
                rootStart = root,
                rootEnd = endRoot,
                targetAnchor = targetAnchor,
            ).also { root = endRoot }
        }
    }

    private fun buildTracks(
        steps: List<NativePhase4Step>,
        duration: Double,
        origin: NativeStagePoint,
    ): List<NativePerformanceTrack> {
        val kinds = listOf(
            NativePerformanceTrackKind.ROOT,
            NativePerformanceTrackKind.BODY,
            NativePerformanceTrackKind.HEAD,
            NativePerformanceTrackKind.FACE,
            NativePerformanceTrackKind.GAZE,
            NativePerformanceTrackKind.LEFT_HAND,
            NativePerformanceTrackKind.RIGHT_HAND,
            NativePerformanceTrackKind.SECONDARY,
        )
        return kinds.map { kind ->
            val frames = mutableListOf(NativePerformancePoseKeyframe(0.0, origin, emptyMap()))
            steps.forEach { step ->
                val rootMid = midpoint(step.rootStart, step.rootEnd)
                val rotations = poseFor(kind, step)
                frames += NativePerformancePoseKeyframe(step.midpointTimeSeconds, rootMid, rotations)
                frames += NativePerformancePoseKeyframe(step.endTimeSeconds, step.rootEnd, endPoseFor(kind, step))
            }
            if (frames.last().timeSeconds < duration) {
                frames += NativePerformancePoseKeyframe(duration, steps.lastOrNull()?.rootEnd ?: origin, emptyMap())
            }
            NativePerformanceTrack(
                id = "phase4-${kind.name.lowercase()}-v1",
                kind = kind,
                keyframes = frames.sortedBy { it.timeSeconds },
            )
        }
    }

    private fun poseFor(kind: NativePerformanceTrackKind, step: NativePhase4Step): Map<NativeSemanticBoneRole, NativeEulerDegrees> = when (kind) {
        NativePerformanceTrackKind.ROOT -> if (step.action == NativeStoryAction.TURN_TO) {
            mapOf(NativeSemanticBoneRole.HIPS to NativeEulerDegrees(0.0, 32.0, 0.0))
        } else emptyMap()
        NativePerformanceTrackKind.BODY -> when {
            step.action in locomotionActions -> mapOf(
                NativeSemanticBoneRole.SPINE to NativeEulerDegrees(4.0, 0.0, -2.0),
                NativeSemanticBoneRole.CHEST to NativeEulerDegrees(-2.0, 3.0, 2.0),
                NativeSemanticBoneRole.LEFT_UPPER_LEG to NativeEulerDegrees(24.0, 0.0, 0.0),
                NativeSemanticBoneRole.RIGHT_UPPER_LEG to NativeEulerDegrees(-24.0, 0.0, 0.0),
            )
            step.action == NativeStoryAction.REACT -> mapOf(
                NativeSemanticBoneRole.SPINE to NativeEulerDegrees(-6.0, -5.0, -2.0),
                NativeSemanticBoneRole.CHEST to NativeEulerDegrees(-10.0, 7.0, 3.0),
            )
            else -> mapOf(NativeSemanticBoneRole.CHEST to NativeEulerDegrees(1.5, 0.0, 0.5))
        }
        NativePerformanceTrackKind.HEAD -> when (step.action) {
            NativeStoryAction.TURN_TO -> mapOf(
                NativeSemanticBoneRole.NECK to NativeEulerDegrees(0.0, 12.0, 0.0),
                NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-1.0, 18.0, 0.0),
            )
            NativeStoryAction.LOOK_AT, NativeStoryAction.NOTICE, NativeStoryAction.SEARCH_FOR -> mapOf(
                NativeSemanticBoneRole.NECK to NativeEulerDegrees(-1.0, 8.0, 0.0),
                NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-3.0, 22.0, 1.0),
            )
            NativeStoryAction.REACT -> mapOf(
                NativeSemanticBoneRole.NECK to NativeEulerDegrees(-4.0, -7.0, 1.0),
                NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-9.0, -10.0, 3.0),
            )
            else -> mapOf(NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-1.0, 1.5, 0.0))
        }
        NativePerformanceTrackKind.FACE -> when (step.action) {
            NativeStoryAction.REACT -> mapOf(NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-2.5, 0.0, 1.5))
            NativeStoryAction.SPEAK, NativeStoryAction.RESPOND -> mapOf(NativeSemanticBoneRole.HEAD to NativeEulerDegrees(1.0, 0.5, 0.0))
            else -> emptyMap()
        }
        NativePerformanceTrackKind.GAZE -> when (step.action) {
            NativeStoryAction.LOOK_AT, NativeStoryAction.NOTICE, NativeStoryAction.SEARCH_FOR,
            NativeStoryAction.TURN_TO -> mapOf(NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-2.0, 24.0, 0.0))
            NativeStoryAction.REACT -> mapOf(NativeSemanticBoneRole.HEAD to NativeEulerDegrees(-5.0, -8.0, 1.0))
            else -> emptyMap()
        }
        NativePerformanceTrackKind.LEFT_HAND -> when {
            step.action in interactionActions -> mapOf(
                NativeSemanticBoneRole.LEFT_UPPER_ARM to NativeEulerDegrees(-10.0, -6.0, 7.0),
                NativeSemanticBoneRole.LEFT_LOWER_ARM to NativeEulerDegrees(-18.0, 0.0, -5.0),
                NativeSemanticBoneRole.LEFT_HAND to NativeEulerDegrees(0.0, 0.0, -4.0),
            )
            step.action == NativeStoryAction.REACT -> mapOf(NativeSemanticBoneRole.LEFT_HAND to NativeEulerDegrees(0.0, 0.0, -10.0))
            else -> emptyMap()
        }
        NativePerformanceTrackKind.RIGHT_HAND -> when {
            step.action in interactionActions -> mapOf(
                NativeSemanticBoneRole.RIGHT_SHOULDER to NativeEulerDegrees(0.0, 2.0, -8.0),
                NativeSemanticBoneRole.RIGHT_UPPER_ARM to NativeEulerDegrees(-42.0, 18.0, -24.0),
                NativeSemanticBoneRole.RIGHT_LOWER_ARM to NativeEulerDegrees(-58.0, 0.0, 12.0),
                NativeSemanticBoneRole.RIGHT_HAND to NativeEulerDegrees(0.0, 8.0, 12.0),
            )
            step.action == NativeStoryAction.REACT -> mapOf(
                NativeSemanticBoneRole.RIGHT_UPPER_ARM to NativeEulerDegrees(-24.0, -8.0, -14.0),
                NativeSemanticBoneRole.RIGHT_LOWER_ARM to NativeEulerDegrees(-34.0, 0.0, 8.0),
            )
            else -> emptyMap()
        }
        NativePerformanceTrackKind.SECONDARY -> when (step.action) {
            NativeStoryAction.REACT -> mapOf(
                NativeSemanticBoneRole.LEFT_SHOULDER to NativeEulerDegrees(0.0, 0.0, 5.0),
                NativeSemanticBoneRole.RIGHT_SHOULDER to NativeEulerDegrees(0.0, 0.0, -5.0),
            )
            else -> mapOf(NativeSemanticBoneRole.CHEST to NativeEulerDegrees(0.5, 0.0, 0.0))
        }
    }

    private fun endPoseFor(kind: NativePerformanceTrackKind, step: NativePhase4Step): Map<NativeSemanticBoneRole, NativeEulerDegrees> {
        if (step.action == NativeStoryAction.TURN_TO && kind == NativePerformanceTrackKind.ROOT) {
            return mapOf(NativeSemanticBoneRole.HIPS to NativeEulerDegrees(0.0, 32.0, 0.0))
        }
        if (step.action in interactionActions && kind == NativePerformanceTrackKind.RIGHT_HAND) {
            return poseFor(kind, step)
        }
        return emptyMap()
    }

    private fun buildContacts(steps: List<NativePhase4Step>): List<NativePhase4ContactConstraint> = buildList {
        steps.forEach { step ->
            val midRoot = midpoint(step.rootStart, step.rootEnd)
            if (step.action in locomotionActions) {
                add(footContact(NativePhase4ContactKind.LEFT_FOOT, step.startTimeSeconds, step.midpointTimeSeconds, step.rootStart, -0.12))
                add(footContact(NativePhase4ContactKind.RIGHT_FOOT, step.midpointTimeSeconds, step.endTimeSeconds, step.rootEnd, 0.12))
            } else {
                add(footContact(NativePhase4ContactKind.LEFT_FOOT, step.startTimeSeconds, step.endTimeSeconds, midRoot, -0.12))
                add(footContact(NativePhase4ContactKind.RIGHT_FOOT, step.startTimeSeconds, step.endTimeSeconds, midRoot, 0.12))
            }
            if (step.action in interactionActions && step.targetId != null && step.targetAnchor != null) {
                add(
                    NativePhase4ContactConstraint(
                        kind = NativePhase4ContactKind.RIGHT_HAND,
                        targetId = step.targetId,
                        startTimeSeconds = step.midpointTimeSeconds,
                        endTimeSeconds = step.endTimeSeconds,
                        anchor = step.targetAnchor,
                        solvedPosition = step.targetAnchor,
                        maxErrorMeters = 0.012,
                    ),
                )
                if (step.action in setOf(NativeStoryAction.PICK_UP, NativeStoryAction.RECEIVE, NativeStoryAction.USE)) {
                    add(
                        NativePhase4ContactConstraint(
                            kind = NativePhase4ContactKind.PROP_GRASP,
                            targetId = step.targetId,
                            startTimeSeconds = step.midpointTimeSeconds,
                            endTimeSeconds = step.endTimeSeconds,
                            anchor = step.targetAnchor,
                            solvedPosition = step.targetAnchor,
                            maxErrorMeters = 0.008,
                        ),
                    )
                }
            }
        }
    }

    private fun footContact(
        kind: NativePhase4ContactKind,
        start: Double,
        end: Double,
        root: NativeStagePoint,
        xOffset: Double,
    ): NativePhase4ContactConstraint {
        val anchor = NativeStagePoint(root.x + xOffset, 0.0, root.z + 0.04)
        return NativePhase4ContactConstraint(kind, null, start, end, anchor, anchor, 0.006)
    }

    private fun buildEmotions(steps: List<NativePhase4Step>, duration: Double): List<NativePhase4EmotionKeyframe> = buildList {
        add(NativePhase4EmotionKeyframe(0.0, "neutral", 0.0, 0.15, 0.12))
        steps.forEach { step ->
            when (step.action) {
                NativeStoryAction.REACT -> add(NativePhase4EmotionKeyframe(step.midpointTimeSeconds, "reaction", -0.35, 0.82, 0.78))
                NativeStoryAction.SPEAK, NativeStoryAction.RESPOND -> add(NativePhase4EmotionKeyframe(step.midpointTimeSeconds, "engaged", 0.18, 0.48, 0.52))
                else -> Unit
            }
        }
        add(NativePhase4EmotionKeyframe(duration, "settled", 0.02, 0.18, 0.16))
    }

    private fun buildMicroPerformance(
        steps: List<NativePhase4Step>,
        duration: Double,
    ): List<NativePhase4MicroPerformanceKeyframe> = buildList {
        add(NativePhase4MicroPerformanceKeyframe(0.0, 0.35, 0.0, 0.92, 0.0))
        steps.forEachIndexed { index, step ->
            val looking = step.action in setOf(NativeStoryAction.LOOK_AT, NativeStoryAction.NOTICE, NativeStoryAction.SEARCH_FOR, NativeStoryAction.TURN_TO)
            val reacting = step.action == NativeStoryAction.REACT
            add(
                NativePhase4MicroPerformanceKeyframe(
                    timeSeconds = step.midpointTimeSeconds,
                    breathAmount = if (reacting) 0.82 else 0.42 + (index % 3) * 0.08,
                    blinkAmount = if (index % 3 == 1) 1.0 else 0.0,
                    gazeFocus = if (looking || step.action in interactionActions) 1.0 else 0.88,
                    headLeadDegrees = when {
                        step.action == NativeStoryAction.TURN_TO -> 10.0
                        looking -> 5.0
                        reacting -> -4.0
                        else -> 1.0
                    },
                ),
            )
        }
        add(NativePhase4MicroPerformanceKeyframe(duration, 0.36, 0.0, 0.92, 0.0))
    }

    private fun validateAcceptance(
        canonical: NativeActingPerformance,
        steps: List<NativePhase4Step>,
        contacts: List<NativePhase4ContactConstraint>,
        emotions: List<NativePhase4EmotionKeyframe>,
        micro: List<NativePhase4MicroPerformanceKeyframe>,
        semanticRoles: Set<NativeSemanticBoneRole>,
    ): NativePhase4Acceptance {
        val actions = steps.map { it.action }.toSet()
        val scriptCoverage = actions.any { it in locomotionActions } &&
            NativeStoryAction.WAIT in actions &&
            NativeStoryAction.TURN_TO in actions &&
            actions.any { it in setOf(NativeStoryAction.LOOK_AT, NativeStoryAction.NOTICE, NativeStoryAction.SEARCH_FOR) } &&
            actions.any { it in interactionActions } &&
            NativeStoryAction.REACT in actions

        val rootTrack = canonical.tracks.firstOrNull { it.kind == NativePerformanceTrackKind.ROOT }
        val rootMotion = if (rootTrack == null) false else {
            val first = rootTrack.keyframes.first().rootPosition
            rootTrack.keyframes.maxOf { distance(it.rootPosition, first) } >= 0.45
        }
        val stopped = steps.filter { it.action == NativeStoryAction.WAIT }.all { distance(it.rootStart, it.rootEnd) <= 0.001 }

        val rotations = canonical.tracks.flatMap { it.keyframes }.flatMap { it.rotations.keys }
        val retargeting = rotations.all { it in semanticRoles } && rotations.isNotEmpty()

        val handContacts = contacts.filter { it.kind == NativePhase4ContactKind.RIGHT_HAND }
        val footContacts = contacts.filter { it.kind == NativePhase4ContactKind.LEFT_FOOT || it.kind == NativePhase4ContactKind.RIGHT_FOOT }
        val graspContacts = contacts.filter { it.kind == NativePhase4ContactKind.PROP_GRASP }
        val contactIk = handContacts.isNotEmpty() && footContacts.isNotEmpty() && graspContacts.isNotEmpty() &&
            contacts.all { contact ->
                contact.startTimeSeconds >= 0.0 &&
                    contact.endTimeSeconds >= contact.startTimeSeconds &&
                    contact.endTimeSeconds <= canonical.durationSeconds &&
                    contact.maxErrorMeters <= 0.03 &&
                    distance(contact.anchor, contact.solvedPosition) <= contact.maxErrorMeters
            }

        val requiredLayers = setOf(
            NativePerformanceTrackKind.ROOT,
            NativePerformanceTrackKind.BODY,
            NativePerformanceTrackKind.HEAD,
            NativePerformanceTrackKind.FACE,
            NativePerformanceTrackKind.GAZE,
            NativePerformanceTrackKind.LEFT_HAND,
            NativePerformanceTrackKind.RIGHT_HAND,
            NativePerformanceTrackKind.SECONDARY,
        )
        val layered = canonical.tracks.map { it.kind }.toSet().containsAll(requiredLayers)
        val emotionReaction = emotions.any { it.label == "reaction" && it.intensity >= 0.65 && it.arousal >= 0.65 } &&
            micro.any { it.blinkAmount >= 0.99 } && micro.any { abs(it.headLeadDegrees) >= 4.0 }

        val trackContinuity = canonical.tracks.all { track ->
            track.keyframes.zipWithNext().all { (left, right) ->
                right.timeSeconds >= left.timeSeconds &&
                    distance(left.rootPosition, right.rootPosition) <= 1.25 &&
                    right.rotations.values.all { rotation ->
                        rotation.x.isFinite() && rotation.y.isFinite() && rotation.z.isFinite() &&
                            abs(rotation.x) <= 120.0 && abs(rotation.y) <= 120.0 && abs(rotation.z) <= 120.0
                    }
            }
        }
        val continuity = stopped && trackContinuity && contacts.all { finite(it.anchor) && finite(it.solvedPosition) }

        return NativePhase4Acceptance(
            scriptCoverageGate = scriptCoverage,
            rootMotionGate = rootMotion && stopped,
            retargetingGate = retargeting,
            contactIkGate = contactIk,
            layeredActingGate = layered,
            emotionReactionGate = emotionReaction,
            continuityGate = continuity,
        )
    }

    private fun lowerEvent(event: NativeStoryEvent): List<NativePerformanceIntent> {
        fun intent(type: NativePerformanceIntentType) = NativePerformanceIntent(type, event.actorId, event.targetId, event.id)
        return when (event.type) {
            NativeStoryAction.ENTER, NativeStoryAction.EXIT, NativeStoryAction.MOVE_TO, NativeStoryAction.WALK_TO, NativeStoryAction.RUN_TO -> listOf(intent(NativePerformanceIntentType.LOCOMOTE))
            NativeStoryAction.TURN_TO -> listOf(intent(NativePerformanceIntentType.TURN))
            NativeStoryAction.LOOK_AT, NativeStoryAction.NOTICE, NativeStoryAction.SEARCH_FOR -> listOf(intent(NativePerformanceIntentType.LOOK))
            NativeStoryAction.PICK_UP, NativeStoryAction.RECEIVE -> listOf(intent(NativePerformanceIntentType.REACH), intent(NativePerformanceIntentType.GRASP))
            NativeStoryAction.PUT_DOWN, NativeStoryAction.GIVE -> listOf(intent(NativePerformanceIntentType.REACH), intent(NativePerformanceIntentType.RELEASE))
            NativeStoryAction.OPEN -> listOf(intent(NativePerformanceIntentType.REACH), intent(NativePerformanceIntentType.OPEN))
            NativeStoryAction.CLOSE -> listOf(intent(NativePerformanceIntentType.REACH), intent(NativePerformanceIntentType.CLOSE))
            NativeStoryAction.SIT -> listOf(intent(NativePerformanceIntentType.SIT))
            NativeStoryAction.STAND -> listOf(intent(NativePerformanceIntentType.STAND))
            NativeStoryAction.REACT -> listOf(intent(NativePerformanceIntentType.REACT))
            NativeStoryAction.WAIT -> listOf(intent(NativePerformanceIntentType.IDLE))
            NativeStoryAction.TOUCH, NativeStoryAction.USE, NativeStoryAction.LOCK, NativeStoryAction.UNLOCK -> listOf(intent(NativePerformanceIntentType.REACH), intent(NativePerformanceIntentType.GESTURE))
            NativeStoryAction.SPEAK, NativeStoryAction.RESPOND, NativeStoryAction.CHANGE_STATE -> listOf(intent(NativePerformanceIntentType.GESTURE))
        }
    }

    private fun rehearsalAnchor(targetId: String, origin: NativeStagePoint): NativeStagePoint {
        val stable = targetId.fold(17) { acc, char -> (acc * 31 + char.code) and 0x7fffffff }
        val xJitter = ((stable % 17) - 8) * 0.01
        val zJitter = (((stable / 17) % 13) - 6) * 0.01
        return NativeStagePoint(origin.x + 1.14 + xJitter, origin.y + 0.92, origin.z + 0.12 + zJitter)
    }

    private fun approachPoint(from: NativeStagePoint, target: NativeStagePoint, standOffMeters: Double): NativeStagePoint {
        val dx = target.x - from.x
        val dz = target.z - from.z
        val planar = kotlin.math.sqrt(dx * dx + dz * dz)
        if (!planar.isFinite() || planar <= standOffMeters + 0.001) return from
        val travel = planar - standOffMeters
        return NativeStagePoint(
            x = from.x + dx / planar * travel,
            y = from.y,
            z = from.z + dz / planar * travel,
        )
    }

    private fun midpoint(left: NativeStagePoint, right: NativeStagePoint) = NativeStagePoint(
        (left.x + right.x) * 0.5,
        (left.y + right.y) * 0.5,
        (left.z + right.z) * 0.5,
    )

    private fun distance(left: NativeStagePoint, right: NativeStagePoint): Double {
        val dx = right.x - left.x
        val dy = right.y - left.y
        val dz = right.z - left.z
        return kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
    }

    private fun finite(point: NativeStagePoint): Boolean = point.x.isFinite() && point.y.isFinite() && point.z.isFinite()
}
