package com.aianimationstudio.runtime

import kotlin.math.abs

internal enum class NativeSemanticBoneRole {
    HIPS, SPINE, CHEST, NECK, HEAD,
    LEFT_SHOULDER, LEFT_UPPER_ARM, LEFT_LOWER_ARM, LEFT_HAND,
    RIGHT_SHOULDER, RIGHT_UPPER_ARM, RIGHT_LOWER_ARM, RIGHT_HAND,
    LEFT_UPPER_LEG, LEFT_LOWER_LEG, LEFT_FOOT, LEFT_TOE,
    RIGHT_UPPER_LEG, RIGHT_LOWER_LEG, RIGHT_FOOT, RIGHT_TOE,
}

internal data class NativeBoneDefinition(
    val id: String,
    val parentId: String? = null,
    val semanticRole: NativeSemanticBoneRole? = null,
)

internal data class NativeSkeletonDefinition(
    val id: String,
    val version: Int,
    val bones: List<NativeBoneDefinition>,
)

internal data class NativeCharacterRig(
    val actorId: String,
    val shotId: String,
    val sourceCommit: String,
    val referenceSha256: String,
    val skeleton: NativeSkeletonDefinition,
)

internal enum class NativePerformanceIntentType {
    LOCOMOTE, TURN, LOOK, REACH, GRASP, RELEASE, OPEN, CLOSE, SIT, STAND, GESTURE, REACT, IDLE,
}

internal data class NativePerformanceIntent(
    val type: NativePerformanceIntentType,
    val actorId: String,
    val targetId: String?,
    val sourceEventId: String,
)

internal enum class NativePerformanceTrackKind { ROOT, BODY, HEAD, FACE, GAZE, LEFT_HAND, RIGHT_HAND, SECONDARY }

internal data class NativeEulerDegrees(val x: Double = 0.0, val y: Double = 0.0, val z: Double = 0.0)

internal data class NativePerformancePoseKeyframe(
    val timeSeconds: Double,
    val rootPosition: NativeStagePoint,
    val rotations: Map<NativeSemanticBoneRole, NativeEulerDegrees>,
)

internal data class NativePerformanceTrack(
    val id: String,
    val kind: NativePerformanceTrackKind,
    val keyframes: List<NativePerformancePoseKeyframe>,
)

internal data class NativeActingPerformance(
    val actorId: String,
    val shotId: String,
    val sourceCommit: String,
    val story: NativeStoryIr,
    val intents: List<NativePerformanceIntent>,
    val tracks: List<NativePerformanceTrack>,
    val durationSeconds: Double,
)

internal sealed interface NativeRigResult {
    data class Ready(val rig: NativeCharacterRig) : NativeRigResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeRigResult
}

internal sealed interface NativePerformanceResult {
    data class Ready(
        val performance: NativeActingPerformance,
        val performanceGate: Boolean = true,
        val contactIkGate: Boolean = true,
        val physicsGate: Boolean = true,
    ) : NativePerformanceResult

    data class Rejected(
        val diagnostics: List<NativeDiagnostic>,
        val performanceGate: Boolean,
        val contactIkGate: Boolean,
        val physicsGate: Boolean,
    ) : NativePerformanceResult
}

internal object NativePerformanceEngine {
    private val requiredSemantics = setOf(
        NativeSemanticBoneRole.HIPS,
        NativeSemanticBoneRole.HEAD,
        NativeSemanticBoneRole.LEFT_HAND,
        NativeSemanticBoneRole.RIGHT_HAND,
        NativeSemanticBoneRole.LEFT_FOOT,
        NativeSemanticBoneRole.RIGHT_FOOT,
    )

    fun prepareRig(blocking: NativeSceneBlocking, shotId: String, sourceCommit: String): NativeRigResult {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        if (!isSha40(sourceCommit)) diagnostics += NativeDiagnostic("RIG_SOURCE_IDENTITY", "Character rig requires the exact 40-character Studio source commit.")
        if (shotId.isBlank()) diagnostics += NativeDiagnostic("RIG_SHOT_IDENTITY", "Character rig requires a non-empty shot identity.")
        if (blocking.reference.sizeBytes <= 0 || blocking.reference.width <= 0 || blocking.reference.height <= 0) {
            diagnostics += NativeDiagnostic("RIG_REFERENCE_IDENTITY", "Character rig requires a decoded, non-empty reference image identity.")
        }

        val skeleton = canonicalSkeleton(blocking.actorId)
        diagnostics += validateSkeleton(skeleton)
        if (diagnostics.isNotEmpty()) return NativeRigResult.Rejected(diagnostics)

        return NativeRigResult.Ready(
            NativeCharacterRig(
                actorId = blocking.actorId,
                shotId = shotId,
                sourceCommit = sourceCommit,
                referenceSha256 = blocking.reference.sha256,
                skeleton = skeleton,
            ),
        )
    }

    fun execute(
        blocking: NativeSceneBlocking,
        rig: NativeCharacterRig,
        story: NativeStoryCompileResult,
        sourceCommit: String,
    ): NativePerformanceResult {
        fun rejected(
            diagnostics: List<NativeDiagnostic>,
            performance: Boolean = false,
            contactIk: Boolean = false,
            physics: Boolean = false,
        ) = NativePerformanceResult.Rejected(diagnostics, performance, contactIk, physics)

        if (!isSha40(sourceCommit) || sourceCommit != rig.sourceCommit) {
            return rejected(listOf(NativeDiagnostic("PERF_SOURCE_IDENTITY", "Acting executor source identity does not match the prepared character rig.")))
        }
        if (blocking.actorId != rig.actorId || rig.shotId.isBlank() || blocking.reference.sha256 != rig.referenceSha256) {
            return rejected(listOf(NativeDiagnostic("PERF_CONTINUITY", "Acting executor actor/shot/reference identity does not match scene blocking.")))
        }
        if (validateSkeleton(rig.skeleton).isNotEmpty()) {
            return rejected(listOf(NativeDiagnostic("PERF_RIG_INVALID", "Prepared character rig is not semantically valid for performance execution.")))
        }
        if (!story.ok || story.ir.events.isEmpty()) {
            return rejected(
                story.diagnostics + NativeDiagnostic(
                    "PERF_NO_EXECUTABLE_STORY",
                    "Acting was not fabricated from unparsed natural language. Use deterministic action script syntax such as `ACTOR SPEAK Hello` or `ACTOR WAIT` until a semantic story parser is connected.",
                ),
            )
        }

        val intents = story.ir.events.flatMap(::lowerEvent)
        if (intents.isEmpty()) {
            return rejected(listOf(NativeDiagnostic("PERF_NO_INTENTS", "Story events produced no executable performance intents.")))
        }
        val duration = blocking.output.durationSeconds
        if (!duration.isFinite() || duration <= 0.0) {
            return rejected(listOf(NativeDiagnostic("PERF_DURATION", "Acting requires a positive shot duration.")))
        }

        val trackKinds = requestedTrackKinds(intents)
        val tracks = trackKinds.map { kind ->
            NativePerformanceTrack(
                id = "${rig.shotId}-${kind.name.lowercase()}-v1",
                kind = kind,
                keyframes = keyframesForTrack(kind, duration, blocking.actorOrigin, intents),
            )
        }
        val structuralDiagnostics = validateTracks(tracks, duration)
        val contactIk = intents.none { it.type in setOf(
            NativePerformanceIntentType.REACH,
            NativePerformanceIntentType.GRASP,
            NativePerformanceIntentType.RELEASE,
            NativePerformanceIntentType.OPEN,
            NativePerformanceIntentType.CLOSE,
        ) }
        val performanceGate = structuralDiagnostics.isEmpty()
        val physicsGate = performanceGate && tracks.all { track -> track.keyframes.all { finitePoint(it.rootPosition) } }

        if (!performanceGate || !contactIk || !physicsGate) {
            return rejected(
                buildList {
                    addAll(structuralDiagnostics)
                    if (!contactIk) add(NativeDiagnostic("PERF_CONTACT_IK_REQUIRED", "Interaction intents require real target anchors/contact IK; no contact was fabricated."))
                    if (!physicsGate) add(NativeDiagnostic("PERF_KINEMATIC_INVALID", "Deterministic skeletal poses failed bounded kinematic validation."))
                },
                performance = performanceGate,
                contactIk = contactIk,
                physics = physicsGate,
            )
        }

        return NativePerformanceResult.Ready(
            NativeActingPerformance(
                actorId = rig.actorId,
                shotId = rig.shotId,
                sourceCommit = sourceCommit,
                story = story.ir,
                intents = intents,
                tracks = tracks,
                durationSeconds = duration,
            ),
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

    private fun requestedTrackKinds(intents: List<NativePerformanceIntent>): List<NativePerformanceTrackKind> {
        val result = linkedSetOf(
            NativePerformanceTrackKind.ROOT,
            NativePerformanceTrackKind.BODY,
            NativePerformanceTrackKind.HEAD,
        )
        intents.forEach { intent ->
            if (intent.type == NativePerformanceIntentType.LOOK) result += NativePerformanceTrackKind.GAZE
            if (intent.type in setOf(
                    NativePerformanceIntentType.REACH,
                    NativePerformanceIntentType.GRASP,
                    NativePerformanceIntentType.RELEASE,
                    NativePerformanceIntentType.OPEN,
                    NativePerformanceIntentType.CLOSE,
                    NativePerformanceIntentType.GESTURE,
                    NativePerformanceIntentType.REACT,
                )
            ) result += NativePerformanceTrackKind.RIGHT_HAND
        }
        return result.toList()
    }

    private fun keyframesForTrack(
        kind: NativePerformanceTrackKind,
        duration: Double,
        origin: NativeStagePoint,
        intents: List<NativePerformanceIntent>,
    ): List<NativePerformancePoseKeyframe> {
        fun has(vararg types: NativePerformanceIntentType) = intents.any { it.type in types }
        val center = mutableMapOf<NativeSemanticBoneRole, NativeEulerDegrees>()
        when (kind) {
            NativePerformanceTrackKind.BODY -> {
                center[NativeSemanticBoneRole.CHEST] = when {
                    has(NativePerformanceIntentType.GESTURE) -> NativeEulerDegrees(0.0, 7.0, 2.5)
                    has(NativePerformanceIntentType.REACT) -> NativeEulerDegrees(-4.0, -8.0, -3.0)
                    has(NativePerformanceIntentType.SIT) -> NativeEulerDegrees(12.0, 0.0, 0.0)
                    has(NativePerformanceIntentType.STAND) -> NativeEulerDegrees(-4.0, 0.0, 0.0)
                    else -> NativeEulerDegrees(1.5, 0.0, 1.0)
                }
                center[NativeSemanticBoneRole.SPINE] = if (has(NativePerformanceIntentType.GESTURE, NativePerformanceIntentType.REACT)) NativeEulerDegrees(0.0, -3.0, -1.0) else NativeEulerDegrees(0.75, 0.0, -0.5)
            }
            NativePerformanceTrackKind.HEAD, NativePerformanceTrackKind.GAZE -> {
                center[NativeSemanticBoneRole.HEAD] = when {
                    has(NativePerformanceIntentType.LOOK) -> NativeEulerDegrees(-2.0, 14.0, 0.0)
                    has(NativePerformanceIntentType.REACT) -> NativeEulerDegrees(-7.0, -9.0, 2.0)
                    else -> NativeEulerDegrees(-2.0, 4.0, 0.0)
                }
                center[NativeSemanticBoneRole.NECK] = NativeEulerDegrees(0.0, if (has(NativePerformanceIntentType.LOOK)) 5.0 else 1.5, 0.0)
            }
            NativePerformanceTrackKind.RIGHT_HAND -> {
                center[NativeSemanticBoneRole.RIGHT_SHOULDER] = NativeEulerDegrees(0.0, 0.0, if (has(NativePerformanceIntentType.GESTURE, NativePerformanceIntentType.REACT)) -8.0 else -3.0)
                center[NativeSemanticBoneRole.RIGHT_UPPER_ARM] = when {
                    has(NativePerformanceIntentType.GESTURE) -> NativeEulerDegrees(-28.0, 12.0, -18.0)
                    has(NativePerformanceIntentType.REACT) -> NativeEulerDegrees(-18.0, -10.0, -12.0)
                    else -> NativeEulerDegrees(-12.0, 5.0, -8.0)
                }
                center[NativeSemanticBoneRole.RIGHT_LOWER_ARM] = if (has(NativePerformanceIntentType.GESTURE, NativePerformanceIntentType.REACT)) NativeEulerDegrees(-42.0, 0.0, 8.0) else NativeEulerDegrees(-22.0, 0.0, 4.0)
                center[NativeSemanticBoneRole.RIGHT_HAND] = NativeEulerDegrees(0.0, 0.0, if (has(NativePerformanceIntentType.GESTURE)) 14.0 else 5.0)
            }
            else -> Unit
        }

        return listOf(
            NativePerformancePoseKeyframe(0.0, origin, emptyMap()),
            NativePerformancePoseKeyframe(duration / 2.0, origin, center.toMap()),
            NativePerformancePoseKeyframe(duration, origin, emptyMap()),
        )
    }

    private fun validateTracks(tracks: List<NativePerformanceTrack>, duration: Double): List<NativeDiagnostic> {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        val ids = mutableSetOf<String>()
        val kinds = mutableSetOf<NativePerformanceTrackKind>()
        tracks.forEach { track ->
            if (!ids.add(track.id)) diagnostics += NativeDiagnostic("PERF_DUPLICATE_PAYLOAD", "Duplicate performance payload ${track.id}.")
            if (!kinds.add(track.kind)) diagnostics += NativeDiagnostic("PERF_DUPLICATE_TRACK", "Duplicate ${track.kind} track.")
            if (track.keyframes.size < 2) diagnostics += NativeDiagnostic("PERF_INSUFFICIENT_KEYFRAMES", "Performance payload ${track.id} requires at least two keyframes.")
            var previous = Double.NEGATIVE_INFINITY
            track.keyframes.forEach { keyframe ->
                if (!keyframe.timeSeconds.isFinite() || keyframe.timeSeconds < 0.0 || keyframe.timeSeconds > duration) diagnostics += NativeDiagnostic("PERF_KEYFRAME_RANGE", "Performance payload ${track.id} contains an out-of-range keyframe.")
                if (keyframe.timeSeconds < previous) diagnostics += NativeDiagnostic("PERF_KEYFRAME_ORDER", "Performance payload ${track.id} keyframes are not monotonic.")
                previous = keyframe.timeSeconds
                if (!finitePoint(keyframe.rootPosition)) diagnostics += NativeDiagnostic("PERF_ROOT_NONFINITE", "Performance payload ${track.id} contains a non-finite root position.")
                keyframe.rotations.values.forEach { rotation ->
                    if (listOf(rotation.x, rotation.y, rotation.z).any { !it.isFinite() || abs(it) > 120.0 }) {
                        diagnostics += NativeDiagnostic("PERF_ROTATION_BOUNDS", "Performance payload ${track.id} exceeds bounded skeletal rotation limits.")
                    }
                }
            }
        }
        return diagnostics
    }

    private fun validateSkeleton(skeleton: NativeSkeletonDefinition): List<NativeDiagnostic> {
        val diagnostics = mutableListOf<NativeDiagnostic>()
        val ids = mutableSetOf<String>()
        skeleton.bones.forEach { if (!ids.add(it.id)) diagnostics += NativeDiagnostic("PERF_DUPLICATE_BONE", "Duplicate bone ${it.id}.") }
        val semantics = mutableSetOf<NativeSemanticBoneRole>()
        skeleton.bones.forEach { bone ->
            if (bone.parentId != null && bone.parentId !in ids) diagnostics += NativeDiagnostic("PERF_MISSING_PARENT", "Bone ${bone.id} references missing parent ${bone.parentId}.")
            bone.semanticRole?.let { role -> if (!semantics.add(role)) diagnostics += NativeDiagnostic("PERF_DUPLICATE_SEMANTIC_BONE", "Semantic role $role is mapped more than once.") }
        }
        requiredSemantics.filterNot(semantics::contains).forEach { diagnostics += NativeDiagnostic("PERF_MISSING_REQUIRED_SEMANTIC_BONE", "Missing required semantic bone $it.") }
        return diagnostics
    }

    private fun canonicalSkeleton(actorId: String): NativeSkeletonDefinition {
        val prefix = "$actorId-rig"
        fun bone(name: String, parent: String? = null, role: NativeSemanticBoneRole) = NativeBoneDefinition("$prefix-$name", parent?.let { "$prefix-$it" }, role)
        return NativeSkeletonDefinition(
            id = "$prefix-v1",
            version = 1,
            bones = listOf(
                bone("hips", role = NativeSemanticBoneRole.HIPS),
                bone("spine", "hips", NativeSemanticBoneRole.SPINE),
                bone("chest", "spine", NativeSemanticBoneRole.CHEST),
                bone("neck", "chest", NativeSemanticBoneRole.NECK),
                bone("head", "neck", NativeSemanticBoneRole.HEAD),
                bone("l-shoulder", "chest", NativeSemanticBoneRole.LEFT_SHOULDER),
                bone("l-upper-arm", "l-shoulder", NativeSemanticBoneRole.LEFT_UPPER_ARM),
                bone("l-lower-arm", "l-upper-arm", NativeSemanticBoneRole.LEFT_LOWER_ARM),
                bone("l-hand", "l-lower-arm", NativeSemanticBoneRole.LEFT_HAND),
                bone("r-shoulder", "chest", NativeSemanticBoneRole.RIGHT_SHOULDER),
                bone("r-upper-arm", "r-shoulder", NativeSemanticBoneRole.RIGHT_UPPER_ARM),
                bone("r-lower-arm", "r-upper-arm", NativeSemanticBoneRole.RIGHT_LOWER_ARM),
                bone("r-hand", "r-lower-arm", NativeSemanticBoneRole.RIGHT_HAND),
                bone("l-upper-leg", "hips", NativeSemanticBoneRole.LEFT_UPPER_LEG),
                bone("l-lower-leg", "l-upper-leg", NativeSemanticBoneRole.LEFT_LOWER_LEG),
                bone("l-foot", "l-lower-leg", NativeSemanticBoneRole.LEFT_FOOT),
                bone("l-toe", "l-foot", NativeSemanticBoneRole.LEFT_TOE),
                bone("r-upper-leg", "hips", NativeSemanticBoneRole.RIGHT_UPPER_LEG),
                bone("r-lower-leg", "r-upper-leg", NativeSemanticBoneRole.RIGHT_LOWER_LEG),
                bone("r-foot", "r-lower-leg", NativeSemanticBoneRole.RIGHT_FOOT),
                bone("r-toe", "r-foot", NativeSemanticBoneRole.RIGHT_TOE),
            ),
        )
    }

    private fun finitePoint(value: NativeStagePoint): Boolean = value.x.isFinite() && value.y.isFinite() && value.z.isFinite()
    private fun isSha40(value: String): Boolean = Regex("^[0-9a-f]{40}$").matches(value)
}
