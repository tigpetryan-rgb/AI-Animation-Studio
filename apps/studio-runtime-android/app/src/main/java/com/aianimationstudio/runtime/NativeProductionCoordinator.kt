package com.aianimationstudio.runtime

internal enum class NativeProductionStage {
    WAITING_VALIDATION,
    BLOCKING_VALID,
    PERFORMANCE_VALID,
    READY_FOR_RENDER,
}

internal data class NativeProductionSnapshot(
    val stage: NativeProductionStage,
    val sourceCommit: String,
    val referenceSha256: String?,
    val blocking: NativeSceneBlocking? = null,
    val rig: NativeCharacterRig? = null,
    val model3d: NativeCharacterModel3D? = null,
    val story: NativeStoryIr? = null,
    val performance: NativeActingPerformance? = null,
    val camera: NativeCameraExecution? = null,
    val sceneIr: NativeSceneIrV1? = null,
    val sceneTimeline: NativeSceneTimelinePlan? = null,
    val sceneSemanticStatus: NativeSceneSemanticStatus? = null,
    val diagnostics: List<NativeDiagnostic> = emptyList(),
) {
    val blockingReady: Boolean get() = blocking != null
    val model3dReady: Boolean get() = model3d != null
    val performanceReady: Boolean get() = performance != null
    val cameraReady: Boolean get() = camera != null && stage == NativeProductionStage.READY_FOR_RENDER
    val renderReady: Boolean get() = false // becomes true only after frame rendering + temporal verification passes.
}

private object NativeStorySourceProjector {
    private val waitWithSuffix = Regex("""^(\S+)\s+WAIT\s+(.+)$""", RegexOption.IGNORE_CASE)
    private val outputMetadata = listOf(
        Regex(
            """\d{1,5}(?:[.,]\d+)?\s*(?:seconds?|secs?|sec|վայրկյան(?:անոց)?|վրկ|секунд(?:а|ы)?|сек)""",
            RegexOption.IGNORE_CASE,
        ),
        Regex("""\d{2,5}\s*[x×х]\s*\d{2,5}""", RegexOption.IGNORE_CASE),
        Regex(
            """\d{1,3}(?:[.,]\d+)?\s*(?:fps|կադր\s*/\s*վրկ|кадр(?:ов)?\s*/\s*с)""",
            RegexOption.IGNORE_CASE,
        ),
    )

    fun project(prompt: String): String = prompt
        .split(Regex("\\r?\n"))
        .joinToString("\n") { original ->
            val match = waitWithSuffix.matchEntire(original.trim()) ?: return@joinToString original
            if (!containsOnlyOutputMetadata(match.groupValues[2])) return@joinToString original
            "${match.groupValues[1]} WAIT"
        }

    private fun containsOnlyOutputMetadata(value: String): Boolean {
        var remainder = value
        var matched = false
        outputMetadata.forEach { pattern ->
            if (pattern.containsMatchIn(remainder)) {
                matched = true
                remainder = pattern.replace(remainder, " ")
            }
        }
        remainder = remainder.replace(Regex("""[\s.,;:()]+"""), "")
        return matched && remainder.isEmpty()
    }
}

internal object NativeProductionCoordinator {
    fun prepareNaturalLanguage(
        chatId: String,
        prompt: String,
        reference: PersistedReferenceAsset?,
        sourceCommit: String,
        backend: NativeSceneSemanticBackend,
        shotId: String = "shot-1",
    ): NativeProductionSnapshot {
        val preliminaryBlocking = when (val result = NativeSceneBlockingCompiler.compile(chatId, prompt, reference)) {
            is NativeBlockingResult.Ready -> result.blocking
            is NativeBlockingResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                diagnostics = result.diagnostics,
            )
        }
        val exactReference = reference ?: return NativeProductionSnapshot(
            stage = NativeProductionStage.WAITING_VALIDATION,
            sourceCommit = sourceCommit,
            referenceSha256 = null,
            diagnostics = listOf(NativeDiagnostic("SCENE_REFERENCE_IDENTITY", "Natural-language production requires an exact persisted reference identity.")),
        )
        val compilation = NaturalLanguageSceneCompiler(backend).compile(
            NativeSceneSemanticRequest(
                originalText = prompt,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                actorId = preliminaryBlocking.actorId,
            ),
        )
        if (!compilation.executable) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                blocking = preliminaryBlocking,
                sceneIr = compilation.ir,
                sceneSemanticStatus = compilation.status,
                diagnostics = compilation.diagnostics,
            )
        }
        if (!compilation.matchesIdentity(prompt, exactReference.sha256, sourceCommit)) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                blocking = preliminaryBlocking,
                sceneIr = compilation.ir,
                sceneSemanticStatus = NativeSceneSemanticStatus.INVALID_SCHEMA,
                diagnostics = listOf(NativeDiagnostic("SCENE_IDENTITY_CHANGED", "Compiled Scene IR no longer matches the exact script/reference/build identity.")),
            )
        }

        val sceneIr = requireNotNull(compilation.ir)
        val sceneTimeline = when (val timelineResult = NativeSceneTimelineCompiler.singleShot(sceneIr)) {
            is NativeSceneTimelineResult.Ready -> timelineResult.timeline
            is NativeSceneTimelineResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                blocking = preliminaryBlocking,
                sceneIr = sceneIr,
                sceneSemanticStatus = compilation.status,
                diagnostics = compilation.diagnostics + timelineResult.diagnostics,
            )
        }
        if (
            sceneTimeline.sourceCommit != sourceCommit ||
            sceneTimeline.referenceSha256 != exactReference.sha256 ||
            sceneTimeline.scriptSha256 != sceneIr.scriptSha256
        ) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                blocking = preliminaryBlocking,
                sceneIr = sceneIr,
                sceneSemanticStatus = compilation.status,
                diagnostics = listOf(
                    NativeDiagnostic(
                        "SCENE_TIMELINE_IDENTITY",
                        "Compiled scene timeline no longer matches the exact script/reference/build identity.",
                    ),
                ),
            )
        }

        val deterministicScript = NativeSceneIrLowerer.lowerToLegacyDeterministicScript(sceneIr)
        val production = prepare(
            chatId = chatId,
            prompt = deterministicScript,
            reference = exactReference,
            sourceCommit = sourceCommit,
            shotId = shotId,
        )
        return production.copy(
            sceneIr = sceneIr,
            sceneTimeline = sceneTimeline,
            sceneSemanticStatus = compilation.status,
            diagnostics = if (production.stage == NativeProductionStage.READY_FOR_RENDER) {
                compilation.diagnostics + production.diagnostics
            } else {
                production.diagnostics
            },
        )
    }

    fun prepare(
        chatId: String,
        prompt: String,
        reference: PersistedReferenceAsset?,
        sourceCommit: String,
        shotId: String = "shot-1",
    ): NativeProductionSnapshot {
        val blockingResult = NativeSceneBlockingCompiler.compile(chatId, prompt, reference)
        val blocking = when (blockingResult) {
            is NativeBlockingResult.Ready -> blockingResult.blocking
            is NativeBlockingResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                diagnostics = blockingResult.diagnostics,
            )
        }

        val rigResult = NativePerformanceEngine.prepareRig(blocking, shotId, sourceCommit)
        val rig = when (rigResult) {
            is NativeRigResult.Ready -> rigResult.rig
            is NativeRigResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                diagnostics = rigResult.diagnostics,
            )
        }

        val modelResult = NativeReferenceDrivenCharacterModel3DBuilder.build(blocking, rig)
        val model3d = when (modelResult) {
            is NativeCharacterModel3DResult.Ready -> modelResult.model
            is NativeCharacterModel3DResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                rig = rig,
                diagnostics = modelResult.diagnostics,
            )
        }

        val registry = listOf(
            NativeStoryEntity(
                id = blocking.actorId,
                kind = NativeEntityKind.CHARACTER,
                aliases = listOf("ACTOR", "CHARACTER", blocking.actorId),
            ),
        )
        val storyResult = NativeStoryCompiler.compile(NativeStorySourceProjector.project(prompt), registry)
        if (!storyResult.ok) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                rig = rig,
                model3d = model3d,
                story = storyResult.ir,
                diagnostics = storyResult.diagnostics,
            )
        }

        val performanceResult = NativePerformanceEngine.execute(blocking, rig, storyResult, sourceCommit)
        val performance = when (performanceResult) {
            is NativePerformanceResult.Ready -> performanceResult.performance
            is NativePerformanceResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                rig = rig,
                model3d = model3d,
                story = storyResult.ir,
                diagnostics = performanceResult.diagnostics,
            )
        }

        val cameraResult = NativeCameraExecutor.execute(blocking, sourceCommit)
        val camera = when (cameraResult) {
            is NativeCameraResult.Ready -> cameraResult.execution
            is NativeCameraResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.PERFORMANCE_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                rig = rig,
                model3d = model3d,
                story = storyResult.ir,
                performance = performance,
                diagnostics = cameraResult.diagnostics,
            )
        }

        return NativeProductionSnapshot(
            stage = NativeProductionStage.READY_FOR_RENDER,
            sourceCommit = sourceCommit,
            referenceSha256 = reference?.sha256,
            blocking = blocking,
            rig = rig,
            model3d = model3d,
            story = storyResult.ir,
            performance = performance,
            camera = camera,
            diagnostics = listOf(
                NativeDiagnostic(
                    "MODEL3D_READY",
                    "Reference-driven skinned 3D mesh is source-bound and validated: ${model3d.vertexCount} vertices, ${model3d.triangleCount} triangles, ${model3d.bindJoints.size} bind joints, depth ${"%.3f".format(model3d.depthExtentMeters)} m.",
                ),
                NativeDiagnostic("PRODUCTION_READY_FOR_RENDER", "Blocking, reference-driven 3D mesh + skin weights, skeletal performance and sampled camera visibility are valid on exact source/reference identity. Native frame rendering and H.264 + Opus MP4 export remain separate downstream gates."),
            ),
        )
    }
}
