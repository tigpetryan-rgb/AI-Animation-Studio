package com.aianimationstudio.runtime

import kotlin.math.abs
import kotlin.math.roundToInt

internal enum class NativePhase7EntityKind { CHARACTER, PROP, LOCATION }
internal enum class NativePhase7JobKind { PREPARE_CANONICAL_SCENE, RENDER_SHOT }

internal data class NativePhase7Entity(
    val id: String,
    val kind: NativePhase7EntityKind,
)

internal data class NativePhase7TimelineSegment(
    val shotId: String,
    val sourceEventId: String,
    val startFrame: Int,
    val endFrameExclusive: Int,
    val startSeconds: Double,
    val endSeconds: Double,
)

internal data class NativePhase7ProductionTimeline(
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val width: Int,
    val height: Int,
    val frameRate: Double,
    val totalFrames: Int,
    val segments: List<NativePhase7TimelineSegment>,
)

internal data class NativePhase7RenderJob(
    val id: String,
    val kind: NativePhase7JobKind,
    val shotId: String?,
    val sourceEventId: String?,
    val startFrame: Int,
    val endFrameExclusive: Int,
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val dependencies: List<String>,
)

internal data class NativePhase7RenderGraph(
    val jobs: List<NativePhase7RenderJob>,
)

internal data class NativePhase7Acceptance(
    val semanticIdentityGate: Boolean,
    val entityStateGate: Boolean,
    val characterPerformanceGate: Boolean,
    val cameraWorldLightingGate: Boolean,
    val controlCoverageGate: Boolean,
    val exactTimelineGate: Boolean,
    val renderDagGate: Boolean,
) {
    val done: Boolean
        get() = semanticIdentityGate && entityStateGate && characterPerformanceGate &&
            cameraWorldLightingGate && controlCoverageGate && exactTimelineGate && renderDagGate
}

internal data class NativePhase7ProductionPlan(
    val sourceSemanticStatus: NativeSceneSemanticStatus,
    val productionSemanticStatus: NativeSceneSemanticStatus,
    val ir: NativeSceneIrV1,
    val entities: List<NativePhase7Entity>,
    val characterAsset: NativeCharacterAsset3D,
    val story: NativeStoryCompileResult,
    val performance: NativePhase4ActorPerformance,
    val cameraPlan: NativePhase5CameraPlan,
    val worldPlan: NativePhase6ProductionPlan,
    val worldBoundPerformance: NativePhase6WorldBoundPerformance,
    val controlConcepts: Set<NativeSceneConcept>,
    val timeline: NativePhase7ProductionTimeline,
    val renderGraph: NativePhase7RenderGraph,
    val acceptance: NativePhase7Acceptance,
    val deterministicFingerprint: String,
)

internal sealed interface NativePhase7OrchestrationResult {
    data class Ready(val plan: NativePhase7ProductionPlan) : NativePhase7OrchestrationResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase7OrchestrationResult
}

/**
 * Phase-7 Scene IR -> full production orchestration.
 *
 * This is intentionally not a renderer. It consumes natural-language semantic IR and directly binds
 * it to the accepted Phase-3/4/5/6 contracts, then produces a frame-exact production timeline and a
 * deterministic render-job DAG for Phase 8. It never lowers Scene IR back through the legacy textual
 * production coordinator and it never requires developer-authored internal JSON/state.
 */
internal object NativeProductionOrchestrationPhase7Engine {
    private val controlConcepts = setOf(
        NativeSceneConcept.CAMERA_MOVE,
        NativeSceneConcept.LIGHTING_CHANGE,
        NativeSceneConcept.ENVIRONMENT_CHANGE,
    )

    fun execute(
        chatId: String,
        prompt: String,
        reference: PersistedReferenceAsset?,
        sourceCommit: String,
        backend: NativeSceneSemanticBackend,
        shotId: String = "phase7-master-performance",
    ): NativePhase7OrchestrationResult {
        val preliminary = when (val result = NativeSceneBlockingCompiler.compile(chatId, prompt, reference)) {
            is NativeBlockingResult.Ready -> result.blocking
            is NativeBlockingResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val exactReference = reference ?: return NativePhase7OrchestrationResult.Rejected(
            listOf(NativeDiagnostic("PHASE7_REFERENCE_IDENTITY", "Phase 7 requires an exact persisted character reference.")),
        )
        val compilation = NaturalLanguageSceneCompiler(backend).compile(
            NativeSceneSemanticRequest(
                originalText = prompt,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                actorId = preliminary.actorId,
            ),
        )
        val ir = compilation.ir ?: return NativePhase7OrchestrationResult.Rejected(compilation.diagnostics)
        if (!compilation.matchesIdentity(prompt, exactReference.sha256, sourceCommit)) {
            return NativePhase7OrchestrationResult.Rejected(
                listOf(NativeDiagnostic("PHASE7_SCENE_IDENTITY", "Scene IR does not match the exact prompt/reference/source identity.")),
            )
        }
        val unsupported = ir.actions.map { it.concept }.filterNot(::phase7Supports).toSet()
        if (unsupported.isNotEmpty()) {
            return NativePhase7OrchestrationResult.Rejected(
                unsupported.sortedBy { it.name }.map {
                    NativeDiagnostic("PHASE7_UNSUPPORTED_CONCEPT", "Phase 7 cannot execute Scene IR concept ${it.name}.")
                },
            )
        }

        val blocking = preliminary.copy(
            output = NativeOutputSpec(
                width = ir.output.width,
                height = ir.output.height,
                frameRate = ir.output.frameRate,
                durationSeconds = ir.output.durationSeconds,
            ),
        )
        val rig = when (val result = NativePerformanceEngine.prepareRig(blocking, shotId, sourceCommit)) {
            is NativeRigResult.Ready -> result.rig
            is NativeRigResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val model = when (val result = NativeReferenceDrivenCharacterModel3DBuilder.build(blocking, rig)) {
            is NativeCharacterModel3DResult.Ready -> result.model
            is NativeCharacterModel3DResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val asset = when (val result = NativeCharacterAsset3DFactory.capture(model, rig)) {
            is NativeCharacterAsset3DResult.Ready -> result.asset
            is NativeCharacterAsset3DResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }

        val entities = entities(ir)
        val story = projectStory(ir, entities)
        if (!story.ok) return NativePhase7OrchestrationResult.Rejected(story.diagnostics)

        val performance = when (
            val result = NativeActorPerformancePhase4Engine.execute(
                asset = asset,
                shotId = shotId,
                story = story,
                durationSeconds = ir.output.durationSeconds,
            )
        ) {
            is NativePhase4PerformanceResult.Ready -> result.performance
            is NativePhase4PerformanceResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val aspect = ir.output.width.toDouble() / ir.output.height.toDouble()
        val camera = when (val result = NativeVirtualDirectorPhase5Engine.execute(performance, aspect)) {
            is NativePhase5DirectorResult.Ready -> result.plan
            is NativePhase5DirectorResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val controls = ir.actions.map { it.concept }.filter { it in controlConcepts }.toSet()
        val world = buildWorld(ir, performance, entities, controls)
        val worldPlan = when (val result = NativeWorldLightingPhase6Engine.execute(performance, camera, world)) {
            is NativePhase6WorldLightingResult.Ready -> result.plan
            is NativePhase6WorldLightingResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val worldBound = when (val result = NativeWorldBoundPerformancePhase6Binder.bind(worldPlan)) {
            is NativePhase6WorldBoundResult.Ready -> result.performance
            is NativePhase6WorldBoundResult.Rejected -> return NativePhase7OrchestrationResult.Rejected(result.diagnostics)
        }
        val timeline = buildTimeline(ir, worldPlan) ?: return NativePhase7OrchestrationResult.Rejected(
            listOf(NativeDiagnostic("PHASE7_EXACT_TIMELINE", "Phase-7 camera coverage cannot be represented as a contiguous frame-exact timeline.")),
        )
        val renderGraph = buildRenderGraph(timeline)

        val semanticIdentityGate = ir.sourceCommit == sourceCommit &&
            ir.referenceSha256 == exactReference.sha256 &&
            ir.scriptSha256 == NativeSceneCompilerSecurity.sha256(prompt) &&
            compilation.status in setOf(
                NativeSceneSemanticStatus.VALID_EXECUTABLE,
                NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY,
            )
        val entityStateGate = entities.any { it.id == ir.actorId && it.kind == NativePhase7EntityKind.CHARACTER } &&
            ir.actions.filter { it.targetId != null }.all { action -> entities.any { it.id == action.targetId } } &&
            worldPlan.propTransitions.isNotEmpty()
        val characterPerformanceGate = asset.sourceCommit == sourceCommit &&
            asset.referenceSha256 == exactReference.sha256 &&
            NativeCharacterAsset3DValidator.validate(asset).isEmpty() &&
            performance.acceptance.done && worldBound.acceptance.done
        val cameraWorldLightingGate = camera.acceptance.done && worldPlan.acceptance.done
        val controlCoverageGate = controls.all { concept ->
            when (concept) {
                NativeSceneConcept.CAMERA_MOVE -> camera.shots.any { it.motion != NativePhase5CameraMotion.STATIC }
                NativeSceneConcept.LIGHTING_CHANGE -> world.lights.any { it.role == NativePhase6LightRole.KEY && it.intensityLux > 600.0 }
                NativeSceneConcept.ENVIRONMENT_CHANGE -> world.environment.id.startsWith("phase7-semantic-environment-")
                else -> true
            }
        }
        val exactTimelineGate = validateTimeline(timeline, worldPlan)
        val renderDagGate = validateRenderGraph(renderGraph, timeline)
        val acceptance = NativePhase7Acceptance(
            semanticIdentityGate = semanticIdentityGate,
            entityStateGate = entityStateGate,
            characterPerformanceGate = characterPerformanceGate,
            cameraWorldLightingGate = cameraWorldLightingGate,
            controlCoverageGate = controlCoverageGate,
            exactTimelineGate = exactTimelineGate,
            renderDagGate = renderDagGate,
        )
        if (!acceptance.done) {
            val failed = buildList {
                if (!acceptance.semanticIdentityGate) add("semantic-identity")
                if (!acceptance.entityStateGate) add("entities/state")
                if (!acceptance.characterPerformanceGate) add("character/performance")
                if (!acceptance.cameraWorldLightingGate) add("camera/world/lighting")
                if (!acceptance.controlCoverageGate) add("semantic-controls")
                if (!acceptance.exactTimelineGate) add("exact-timeline")
                if (!acceptance.renderDagGate) add("render-dag")
            }
            return NativePhase7OrchestrationResult.Rejected(
                listOf(NativeDiagnostic("PHASE7_ACCEPTANCE", "Production orchestration acceptance failed: ${failed.joinToString(", ")}.")),
            )
        }

        val fingerprint = fingerprint(ir, entities, story, worldPlan, worldBound, timeline, renderGraph)
        return NativePhase7OrchestrationResult.Ready(
            NativePhase7ProductionPlan(
                sourceSemanticStatus = compilation.status,
                productionSemanticStatus = NativeSceneSemanticStatus.VALID_EXECUTABLE,
                ir = ir,
                entities = entities,
                characterAsset = asset,
                story = story,
                performance = performance,
                cameraPlan = camera,
                worldPlan = worldPlan,
                worldBoundPerformance = worldBound,
                controlConcepts = controls,
                timeline = timeline,
                renderGraph = renderGraph,
                acceptance = acceptance,
                deterministicFingerprint = fingerprint,
            ),
        )
    }

    private fun phase7Supports(concept: NativeSceneConcept): Boolean = when (concept) {
        NativeSceneConcept.WAIT,
        NativeSceneConcept.SPEAK,
        NativeSceneConcept.REACT,
        NativeSceneConcept.SIT,
        NativeSceneConcept.STAND,
        NativeSceneConcept.WALK_TO,
        NativeSceneConcept.RUN_TO,
        NativeSceneConcept.LOOK_AT,
        NativeSceneConcept.PICK_UP,
        NativeSceneConcept.OPEN,
        NativeSceneConcept.CLOSE,
        NativeSceneConcept.CAMERA_MOVE,
        NativeSceneConcept.LIGHTING_CHANGE,
        NativeSceneConcept.ENVIRONMENT_CHANGE -> true
    }

    private fun entities(ir: NativeSceneIrV1): List<NativePhase7Entity> {
        val propTargets = ir.actions.filter {
            it.concept in setOf(NativeSceneConcept.PICK_UP, NativeSceneConcept.OPEN, NativeSceneConcept.CLOSE)
        }.mapNotNull { it.targetId }.toSet()
        val targets = ir.actions.mapNotNull { it.targetId }.distinct().sorted()
        return buildList {
            add(NativePhase7Entity(ir.actorId, NativePhase7EntityKind.CHARACTER))
            targets.forEach { id ->
                add(
                    NativePhase7Entity(
                        id,
                        if (id in propTargets) NativePhase7EntityKind.PROP else NativePhase7EntityKind.LOCATION,
                    ),
                )
            }
        }
    }

    private fun projectStory(ir: NativeSceneIrV1, entities: List<NativePhase7Entity>): NativeStoryCompileResult {
        val events = mutableListOf<NativeStoryEvent>()
        val lastByEntity = mutableMapOf<String, String>()
        fun addEvent(id: String, action: NativeStoryAction, source: NativeSceneAction) {
            val touched = buildList {
                add(ir.actorId)
                source.targetId?.let(::add)
            }
            val causes = touched.mapNotNull(lastByEntity::get).distinct()
            events += NativeStoryEvent(
                id = id,
                type = action,
                actorId = ir.actorId,
                targetId = source.targetId,
                parameters = if (action == NativeStoryAction.SPEAK && source.text != null) mapOf("text" to source.text) else emptyMap(),
                causes = causes,
                line = events.size + 1,
                sourceText = source.sourceExcerpt,
            )
            touched.forEach { lastByEntity[it] = id }
        }
        ir.actions.forEach { source ->
            when (source.concept) {
                NativeSceneConcept.WAIT -> addEvent(source.id, NativeStoryAction.WAIT, source)
                NativeSceneConcept.SPEAK -> addEvent(source.id, NativeStoryAction.SPEAK, source)
                NativeSceneConcept.REACT -> addEvent(source.id, NativeStoryAction.REACT, source)
                NativeSceneConcept.SIT -> addEvent(source.id, NativeStoryAction.SIT, source)
                NativeSceneConcept.STAND -> addEvent(source.id, NativeStoryAction.STAND, source)
                NativeSceneConcept.WALK_TO -> addEvent(source.id, NativeStoryAction.WALK_TO, source)
                NativeSceneConcept.RUN_TO -> addEvent(source.id, NativeStoryAction.RUN_TO, source)
                NativeSceneConcept.LOOK_AT -> {
                    addEvent("${source.id}_turn", NativeStoryAction.TURN_TO, source)
                    addEvent(source.id, NativeStoryAction.LOOK_AT, source)
                }
                NativeSceneConcept.PICK_UP -> addEvent(source.id, NativeStoryAction.PICK_UP, source)
                NativeSceneConcept.OPEN -> addEvent(source.id, NativeStoryAction.OPEN, source)
                NativeSceneConcept.CLOSE -> addEvent(source.id, NativeStoryAction.CLOSE, source)
                NativeSceneConcept.CAMERA_MOVE,
                NativeSceneConcept.LIGHTING_CHANGE,
                NativeSceneConcept.ENVIRONMENT_CHANGE -> Unit
            }
        }
        val known = entities.map { it.id }.toSet()
        val diagnostics = buildList {
            if (events.isEmpty()) add(NativeDiagnostic("PHASE7_STORY_EMPTY", "Scene IR produced no actor-performance events."))
            events.forEach { event ->
                if (event.actorId !in known) add(NativeDiagnostic("PHASE7_STORY_ACTOR", "Projected story actor is not a canonical Phase-7 entity."))
                if (event.targetId != null && event.targetId !in known) add(NativeDiagnostic("PHASE7_STORY_TARGET", "Projected story target ${event.targetId} is not a canonical Phase-7 entity."))
            }
        }
        return NativeStoryCompileResult(
            ok = diagnostics.isEmpty(),
            ir = NativeStoryIr(ir.originalText, events),
            diagnostics = diagnostics,
        )
    }

    private fun buildWorld(
        ir: NativeSceneIrV1,
        performance: NativePhase4ActorPerformance,
        entities: List<NativePhase7Entity>,
        controls: Set<NativeSceneConcept>,
    ): NativePhase6WorldState {
        val targets = entities.filter { it.kind != NativePhase7EntityKind.CHARACTER }.sortedBy { it.id }
        val semanticAnchors = targets.mapIndexed { index, entity ->
            val column = index % 3
            val row = index / 3
            NativePhase6Anchor(
                id = "phase7-anchor-${entity.id}",
                semanticId = entity.id,
                kind = if (entity.kind == NativePhase7EntityKind.PROP) NativePhase6AnchorKind.PROP else NativePhase6AnchorKind.ENVIRONMENT,
                position = NativeStagePoint(3.0 + column * 1.45, 0.0, 0.8 + row * 1.35),
            )
        }
        val actorAndLights = listOf(
            NativePhase6Anchor("phase7-anchor-actor", "actor_mark", NativePhase6AnchorKind.ACTOR_MARK, NativeStagePoint(0.0, 0.0, 0.0)),
            NativePhase6Anchor("phase7-anchor-key", "light_key", NativePhase6AnchorKind.LIGHT, NativeStagePoint(-1.5, 3.5, 4.0)),
            NativePhase6Anchor("phase7-anchor-fill", "light_fill", NativePhase6AnchorKind.LIGHT, NativeStagePoint(4.5, 2.8, 4.5)),
            NativePhase6Anchor("phase7-anchor-rim", "light_rim", NativePhase6AnchorKind.LIGHT, NativeStagePoint(2.0, 3.2, -4.0)),
        )
        val semanticLighting = NativeSceneConcept.LIGHTING_CHANGE in controls
        val environmentId = if (NativeSceneConcept.ENVIRONMENT_CHANGE in controls) {
            "phase7-semantic-environment-${ir.scriptSha256.take(12)}"
        } else {
            "phase7-default-environment"
        }
        val props = targets.filter { it.kind == NativePhase7EntityKind.PROP }.map { entity ->
            NativePhase6Prop(
                id = "phase7-prop-${entity.id}",
                semanticId = entity.id,
                radiusMeters = 0.24,
                initialState = NativePhase6PropState(
                    mode = NativePhase6PropMode.STAGED,
                    ownerActorId = null,
                    anchorId = "phase7-anchor-${entity.id}",
                ),
            )
        }
        return NativePhase6WorldState(
            sourceCommit = ir.sourceCommit,
            shotId = performance.canonical.shotId,
            actorId = ir.actorId,
            environment = NativePhase6Environment(
                id = environmentId,
                min = NativeStagePoint(-10.0, -1.0, -10.0),
                max = NativeStagePoint(10.0, 8.0, 12.0),
                obstacles = emptyList(),
            ),
            anchors = semanticAnchors + actorAndLights,
            props = props,
            lights = listOf(
                NativePhase6Light("phase7-key", NativePhase6LightRole.KEY, "phase7-anchor-key", if (semanticLighting) 640.0 else 600.0),
                NativePhase6Light("phase7-fill", NativePhase6LightRole.FILL, "phase7-anchor-fill", if (semanticLighting) 235.0 else 220.0),
                NativePhase6Light("phase7-rim", NativePhase6LightRole.RIM, "phase7-anchor-rim", if (semanticLighting) 365.0 else 350.0),
                NativePhase6Light("phase7-environment", NativePhase6LightRole.ENVIRONMENT, null, if (semanticLighting) 175.0 else 160.0),
            ),
        )
    }

    private fun buildTimeline(ir: NativeSceneIrV1, worldPlan: NativePhase6ProductionPlan): NativePhase7ProductionTimeline? {
        val fps = ir.output.frameRate
        val rawFrames = ir.output.durationSeconds * fps
        val totalFrames = rawFrames.roundToInt()
        if (!rawFrames.isFinite() || totalFrames <= 0 || abs(rawFrames - totalFrames.toDouble()) > 1e-6) return null
        val ordered = worldPlan.resolvedShots.sortedBy { it.startPose.timeSeconds }
        var previousEnd = 0
        val segments = ordered.mapIndexed { index, shot ->
            val proposedEnd = if (index == ordered.lastIndex) totalFrames else (shot.endPose.timeSeconds * fps).roundToInt()
            if (proposedEnd <= previousEnd) return null
            NativePhase7TimelineSegment(
                shotId = shot.sourceShot.id,
                sourceEventId = shot.sourceShot.sourceEventId,
                startFrame = previousEnd,
                endFrameExclusive = proposedEnd,
                startSeconds = previousEnd / fps,
                endSeconds = proposedEnd / fps,
            ).also { previousEnd = proposedEnd }
        }
        if (segments.isEmpty() || previousEnd != totalFrames) return null
        return NativePhase7ProductionTimeline(
            sourceCommit = ir.sourceCommit,
            referenceSha256 = ir.referenceSha256,
            scriptSha256 = ir.scriptSha256,
            width = ir.output.width,
            height = ir.output.height,
            frameRate = fps,
            totalFrames = totalFrames,
            segments = segments,
        )
    }

    private fun buildRenderGraph(timeline: NativePhase7ProductionTimeline): NativePhase7RenderGraph {
        val jobs = mutableListOf(
            NativePhase7RenderJob(
                id = "phase7-prepare-canonical-scene",
                kind = NativePhase7JobKind.PREPARE_CANONICAL_SCENE,
                shotId = null,
                sourceEventId = null,
                startFrame = 0,
                endFrameExclusive = 0,
                sourceCommit = timeline.sourceCommit,
                referenceSha256 = timeline.referenceSha256,
                scriptSha256 = timeline.scriptSha256,
                dependencies = emptyList(),
            ),
        )
        var previousRender: String? = null
        timeline.segments.forEachIndexed { index, segment ->
            val id = "phase7-render-${index + 1}-${segment.shotId}"
            jobs += NativePhase7RenderJob(
                id = id,
                kind = NativePhase7JobKind.RENDER_SHOT,
                shotId = segment.shotId,
                sourceEventId = segment.sourceEventId,
                startFrame = segment.startFrame,
                endFrameExclusive = segment.endFrameExclusive,
                sourceCommit = timeline.sourceCommit,
                referenceSha256 = timeline.referenceSha256,
                scriptSha256 = timeline.scriptSha256,
                dependencies = buildList {
                    add("phase7-prepare-canonical-scene")
                    previousRender?.let(::add)
                },
            )
            previousRender = id
        }
        return NativePhase7RenderGraph(jobs)
    }

    private fun validateTimeline(timeline: NativePhase7ProductionTimeline, worldPlan: NativePhase6ProductionPlan): Boolean =
        timeline.segments.isNotEmpty() &&
            timeline.segments.size == worldPlan.resolvedShots.size &&
            timeline.segments.first().startFrame == 0 &&
            timeline.segments.last().endFrameExclusive == timeline.totalFrames &&
            timeline.segments.all { it.endFrameExclusive > it.startFrame } &&
            timeline.segments.zipWithNext().all { (left, right) -> left.endFrameExclusive == right.startFrame }

    private fun validateRenderGraph(graph: NativePhase7RenderGraph, timeline: NativePhase7ProductionTimeline): Boolean {
        if (graph.jobs.isEmpty() || graph.jobs.first().kind != NativePhase7JobKind.PREPARE_CANONICAL_SCENE) return false
        if (graph.jobs.map { it.id }.toSet().size != graph.jobs.size) return false
        val known = mutableSetOf<String>()
        graph.jobs.forEach { job ->
            if (job.dependencies.any { it !in known }) return false
            if (job.sourceCommit != timeline.sourceCommit || job.referenceSha256 != timeline.referenceSha256 || job.scriptSha256 != timeline.scriptSha256) return false
            known += job.id
        }
        val renderJobs = graph.jobs.filter { it.kind == NativePhase7JobKind.RENDER_SHOT }
        return renderJobs.size == timeline.segments.size && renderJobs.zip(timeline.segments).all { (job, segment) ->
            job.shotId == segment.shotId &&
                job.sourceEventId == segment.sourceEventId &&
                job.startFrame == segment.startFrame &&
                job.endFrameExclusive == segment.endFrameExclusive
        }
    }

    private fun fingerprint(
        ir: NativeSceneIrV1,
        entities: List<NativePhase7Entity>,
        story: NativeStoryCompileResult,
        worldPlan: NativePhase6ProductionPlan,
        worldBound: NativePhase6WorldBoundPerformance,
        timeline: NativePhase7ProductionTimeline,
        graph: NativePhase7RenderGraph,
    ): String = NativeSceneCompilerSecurity.sha256(
        buildString {
            append(ir.sourceCommit).append('|').append(ir.referenceSha256).append('|').append(ir.scriptSha256)
            entities.sortedBy { it.id }.forEach { append('|').append(it.id).append(':').append(it.kind.name) }
            story.ir.events.forEach { event ->
                append('|').append(event.id).append(':').append(event.type.name).append(':').append(event.targetId ?: "-")
            }
            worldPlan.world.anchors.sortedBy { it.id }.forEach { anchor ->
                append('|').append(anchor.id).append(':').append(anchor.position.x).append(',').append(anchor.position.y).append(',').append(anchor.position.z)
            }
            worldPlan.propTransitions.forEach { transition ->
                append('|').append(transition.propId).append(':').append(transition.action.name).append(':').append(transition.after.mode.name)
            }
            worldBound.contacts.forEach { contact ->
                append('|').append(contact.kind.name).append(':').append(contact.targetId ?: "-").append(':').append(contact.anchor.x).append(',').append(contact.anchor.y).append(',').append(contact.anchor.z)
            }
            timeline.segments.forEach { segment -> append('|').append(segment.shotId).append(':').append(segment.startFrame).append('-').append(segment.endFrameExclusive) }
            graph.jobs.forEach { job -> append('|').append(job.id).append(':').append(job.dependencies.joinToString(",")) }
        },
    )
}
