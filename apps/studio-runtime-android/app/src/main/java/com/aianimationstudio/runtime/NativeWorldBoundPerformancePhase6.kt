package com.aianimationstudio.runtime

import kotlin.math.abs

internal data class NativePhase6WorldBoundAcceptance(
    val canonicalTargetContactGate: Boolean,
    val rootRebaseGate: Boolean,
    val contactSolveGate: Boolean,
    val propInteractionContactGate: Boolean,
) {
    val done: Boolean
        get() = canonicalTargetContactGate && rootRebaseGate && contactSolveGate && propInteractionContactGate
}

internal data class NativePhase6WorldBoundPerformance(
    val sourceCommit: String,
    val actorId: String,
    val shotId: String,
    val tracks: List<NativePerformanceTrack>,
    val contacts: List<NativePhase4ContactConstraint>,
    val acceptance: NativePhase6WorldBoundAcceptance,
)

internal sealed interface NativePhase6WorldBoundResult {
    data class Ready(val performance: NativePhase6WorldBoundPerformance) : NativePhase6WorldBoundResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase6WorldBoundResult
}

/**
 * Binds the accepted Phase-4 actor performance to the canonical Phase-6 spatial solution.
 *
 * Phase 4 deliberately owns only rehearsal anchors. Phase 6 must not merely rename those anchors:
 * production root keyframes are rebased to the resolved world path, target hand/grasp constraints are
 * solved against the canonical semantic anchor, and foot contacts follow the same world-space root delta.
 */
internal object NativeWorldBoundPerformancePhase6Binder {
    fun bind(plan: NativePhase6ProductionPlan): NativePhase6WorldBoundResult {
        if (!plan.acceptance.done) {
            return NativePhase6WorldBoundResult.Rejected(
                listOf(NativeDiagnostic("PHASE6_WORLD_PLAN", "World-bound actor performance requires an accepted Phase-6 world/lighting plan.")),
            )
        }

        val original = plan.performance
        val canonicalAnchors = plan.world.anchors.associateBy { it.semanticId }
        val tracks = original.canonical.tracks.map { track ->
            track.copy(
                keyframes = track.keyframes.map { frame ->
                    val delta = rootDeltaAt(frame.timeSeconds, original.steps, plan.resolvedSteps)
                    frame.copy(rootPosition = add(frame.rootPosition, delta))
                },
            )
        }
        val contacts = original.contacts.map { contact ->
            val target = contact.targetId?.let { canonicalAnchors[it]?.position }
            if (target != null) {
                contact.copy(anchor = target, solvedPosition = target)
            } else {
                val sampleTime = (contact.startTimeSeconds + contact.endTimeSeconds) * 0.5
                val delta = rootDeltaAt(sampleTime, original.steps, plan.resolvedSteps)
                contact.copy(
                    anchor = add(contact.anchor, delta),
                    solvedPosition = add(contact.solvedPosition, delta),
                )
            }
        }

        val targetedOriginal = original.contacts.filter { it.targetId != null }
        val targetedBound = contacts.filter { it.targetId != null }
        val canonicalTargetContactGate = targetedBound.isNotEmpty() && targetedBound.all { contact ->
            val canonical = contact.targetId?.let { canonicalAnchors[it]?.position }
            canonical != null && distance(contact.anchor, canonical) <= 1e-9 && distance(contact.solvedPosition, canonical) <= 1e-9
        } && targetedOriginal.zip(targetedBound).any { (before, after) -> distance(before.anchor, after.anchor) > 0.05 }

        val rootRebaseGate = tracks.isNotEmpty() && tracks.zip(original.canonical.tracks).all { (boundTrack, originalTrack) ->
            boundTrack.keyframes.size == originalTrack.keyframes.size && boundTrack.keyframes.all { frame ->
                val expected = resolvedRootAt(frame.timeSeconds, plan.resolvedSteps)
                distance(frame.rootPosition, expected) <= 1e-6
            }
        } && tracks.zip(original.canonical.tracks).any { (boundTrack, originalTrack) ->
            boundTrack.keyframes.zip(originalTrack.keyframes).any { (after, before) -> distance(after.rootPosition, before.rootPosition) > 0.05 }
        }

        val contactSolveGate = contacts.isNotEmpty() && contacts.all { contact ->
            contact.maxErrorMeters.isFinite() && contact.maxErrorMeters <= 0.03 &&
                distance(contact.anchor, contact.solvedPosition) <= contact.maxErrorMeters
        }

        val propIds = plan.world.props.map { it.semanticId }.toSet()
        val propActions = plan.resolvedSteps.filter { it.action in setOf(NativeStoryAction.PICK_UP, NativeStoryAction.RECEIVE, NativeStoryAction.USE) }
        val propInteractionContactGate = propActions.isNotEmpty() && propActions.all { step ->
            step.targetId in propIds &&
                contacts.any { it.targetId == step.targetId && it.kind == NativePhase4ContactKind.RIGHT_HAND && overlaps(it, step) } &&
                contacts.any { it.targetId == step.targetId && it.kind == NativePhase4ContactKind.PROP_GRASP && overlaps(it, step) }
        }

        val acceptance = NativePhase6WorldBoundAcceptance(
            canonicalTargetContactGate = canonicalTargetContactGate,
            rootRebaseGate = rootRebaseGate,
            contactSolveGate = contactSolveGate,
            propInteractionContactGate = propInteractionContactGate,
        )
        if (!acceptance.done) {
            val failed = buildList {
                if (!acceptance.canonicalTargetContactGate) add("canonical-target-contact")
                if (!acceptance.rootRebaseGate) add("root-rebase")
                if (!acceptance.contactSolveGate) add("contact-solve")
                if (!acceptance.propInteractionContactGate) add("prop-interaction-contact")
            }
            return NativePhase6WorldBoundResult.Rejected(
                listOf(NativeDiagnostic("PHASE6_WORLD_BOUND_ACTOR", "World-bound actor acceptance failed: ${failed.joinToString(", ")}.")),
            )
        }

        return NativePhase6WorldBoundResult.Ready(
            NativePhase6WorldBoundPerformance(
                sourceCommit = plan.world.sourceCommit,
                actorId = plan.world.actorId,
                shotId = plan.world.shotId,
                tracks = tracks,
                contacts = contacts,
                acceptance = acceptance,
            ),
        )
    }

    private fun overlaps(contact: NativePhase4ContactConstraint, step: NativePhase6ResolvedStep): Boolean =
        contact.endTimeSeconds >= step.midpointTimeSeconds && contact.startTimeSeconds <= step.endTimeSeconds

    private fun rootDeltaAt(
        timeSeconds: Double,
        original: List<NativePhase4Step>,
        resolved: List<NativePhase6ResolvedStep>,
    ): NativeStagePoint = sub(resolvedRootAt(timeSeconds, resolved), originalRootAt(timeSeconds, original))

    private fun originalRootAt(timeSeconds: Double, steps: List<NativePhase4Step>): NativeStagePoint {
        val step = stepAt(timeSeconds, steps.map { TimeStep(it.startTimeSeconds, it.endTimeSeconds, it.rootStart, it.rootEnd) })
        return interpolate(step.startRoot, step.endRoot, normalized(timeSeconds, step.startTime, step.endTime))
    }

    private fun resolvedRootAt(timeSeconds: Double, steps: List<NativePhase6ResolvedStep>): NativeStagePoint {
        val step = stepAt(timeSeconds, steps.map { TimeStep(it.startTimeSeconds, it.endTimeSeconds, it.rootStart, it.rootEnd) })
        return interpolate(step.startRoot, step.endRoot, normalized(timeSeconds, step.startTime, step.endTime))
    }

    private data class TimeStep(
        val startTime: Double,
        val endTime: Double,
        val startRoot: NativeStagePoint,
        val endRoot: NativeStagePoint,
    )

    private fun stepAt(timeSeconds: Double, steps: List<TimeStep>): TimeStep =
        steps.firstOrNull { timeSeconds <= it.endTime + 1e-9 } ?: steps.last()

    private fun normalized(time: Double, start: Double, end: Double): Double {
        val duration = end - start
        if (duration <= 1e-9) return 1.0
        return ((time - start) / duration).coerceIn(0.0, 1.0)
    }

    private fun interpolate(a: NativeStagePoint, b: NativeStagePoint, t: Double) = NativeStagePoint(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
    )

    private fun add(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x + b.x, a.y + b.y, a.z + b.z)
    private fun sub(a: NativeStagePoint, b: NativeStagePoint) = NativeStagePoint(a.x - b.x, a.y - b.y, a.z - b.z)
    private fun distance(a: NativeStagePoint, b: NativeStagePoint): Double {
        val dx = a.x - b.x
        val dy = a.y - b.y
        val dz = a.z - b.z
        return kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
    }
}
