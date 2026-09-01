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
    val story: NativeStoryIr? = null,
    val performance: NativeActingPerformance? = null,
    val camera: NativeCameraExecution? = null,
    val diagnostics: List<NativeDiagnostic> = emptyList(),
) {
    val blockingReady: Boolean get() = blocking != null
    val performanceReady: Boolean get() = performance != null
    val cameraReady: Boolean get() = camera != null && stage == NativeProductionStage.READY_FOR_RENDER
    val renderReady: Boolean get() = false // becomes true only after the native frame renderer is ported and verified.
}

internal object NativeProductionCoordinator {
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

        val registry = listOf(
            NativeStoryEntity(
                id = blocking.actorId,
                kind = NativeEntityKind.CHARACTER,
                aliases = listOf("ACTOR", "CHARACTER", blocking.actorId),
            ),
        )
        val storyResult = NativeStoryCompiler.compile(prompt, registry)
        if (!storyResult.ok) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.BLOCKING_VALID,
                sourceCommit = sourceCommit,
                referenceSha256 = reference?.sha256,
                blocking = blocking,
                rig = rig,
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
            story = storyResult.ir,
            performance = performance,
            camera = camera,
            diagnostics = listOf(
                NativeDiagnostic("PRODUCTION_READY_FOR_RENDER", "Deterministic blocking, skeletal performance and sampled camera visibility are valid on exact source/reference identity. Native frame rendering and H.264 + Opus MP4 export remain separate downstream gates."),
            ),
        )
    }
}
