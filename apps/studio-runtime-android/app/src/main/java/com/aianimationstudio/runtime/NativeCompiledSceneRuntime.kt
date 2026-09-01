package com.aianimationstudio.runtime

/**
 * Re-enters the deterministic production pipeline from a previously persisted and hash-verified
 * Scene IR/timeline pair. No semantic backend is called during reload, and every identity/capability
 * invariant is rechecked before legacy lowering.
 */
internal object NativeCompiledSceneRuntime {
    fun prepareVerified(
        chatId: String,
        prompt: String,
        reference: PersistedReferenceAsset?,
        sourceCommit: String,
        persisted: NativePersistedScenePlan,
        shotId: String = "shot-1",
    ): NativeProductionSnapshot {
        val exactReference = reference ?: return NativeProductionSnapshot(
            stage = NativeProductionStage.WAITING_VALIDATION,
            sourceCommit = sourceCommit,
            referenceSha256 = null,
            diagnostics = listOf(NativeDiagnostic("SCENE_REFERENCE_IDENTITY", "Persisted Scene IR reload requires an exact persisted reference identity.")),
        )
        val ir = persisted.ir
        val timeline = persisted.timeline
        val expectedScriptSha = NativeSceneCompilerSecurity.sha256(prompt)
        val identityOk = ir.originalText == prompt &&
            ir.scriptSha256 == expectedScriptSha &&
            ir.sourceCommit == sourceCommit &&
            ir.referenceSha256 == exactReference.sha256 &&
            timeline.sourceCommit == sourceCommit &&
            timeline.referenceSha256 == exactReference.sha256 &&
            timeline.scriptSha256 == expectedScriptSha
        if (!identityOk) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                sceneIr = ir,
                sceneTimeline = timeline,
                sceneSemanticStatus = NativeSceneSemanticStatus.INVALID_SCHEMA,
                diagnostics = listOf(NativeDiagnostic("SCENE_PERSISTED_IDENTITY", "Persisted Scene IR/timeline does not match the exact current script/reference/build identity.")),
            )
        }
        val unsupported = NativeSceneCapabilityRegistry.unsupported(ir.actions)
        if (unsupported.isNotEmpty()) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                sceneIr = ir,
                sceneTimeline = timeline,
                sceneSemanticStatus = NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY,
                diagnostics = unsupported.sortedBy { it.name }.map { concept ->
                    NativeDiagnostic("UNSUPPORTED_CAPABILITY", "Persisted Scene IR concept ${concept.name} is no longer executable by the current native capability set.")
                },
            )
        }
        val timelineDrafts = timeline.shots.map { shot ->
            NativeSceneShotDraft(
                id = shot.id,
                startSeconds = shot.startSeconds,
                durationSeconds = shot.endSeconds - shot.startSeconds,
                actionIds = shot.actionIds,
                camera = shot.camera,
            )
        }
        val revalidatedTimeline = when (val result = NativeSceneTimelineCompiler.compile(ir, timelineDrafts)) {
            is NativeSceneTimelineResult.Ready -> result.timeline
            is NativeSceneTimelineResult.Rejected -> return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                sceneIr = ir,
                sceneTimeline = timeline,
                sceneSemanticStatus = NativeSceneSemanticStatus.INVALID_SCHEMA,
                diagnostics = result.diagnostics,
            )
        }
        if (revalidatedTimeline != timeline) {
            return NativeProductionSnapshot(
                stage = NativeProductionStage.WAITING_VALIDATION,
                sourceCommit = sourceCommit,
                referenceSha256 = exactReference.sha256,
                sceneIr = ir,
                sceneTimeline = timeline,
                sceneSemanticStatus = NativeSceneSemanticStatus.INVALID_SCHEMA,
                diagnostics = listOf(NativeDiagnostic("SCENE_PERSISTED_TIMELINE", "Persisted Scene IR timeline changed during deterministic revalidation.")),
            )
        }

        val deterministicScript = NativeSceneIrLowerer.lowerToLegacyDeterministicScript(ir)
        val production = NativeProductionCoordinator.prepare(
            chatId = chatId,
            prompt = deterministicScript,
            reference = exactReference,
            sourceCommit = sourceCommit,
            shotId = shotId,
        )
        return production.copy(
            sceneIr = ir,
            sceneTimeline = revalidatedTimeline,
            sceneSemanticStatus = NativeSceneSemanticStatus.VALID_EXECUTABLE,
            diagnostics = if (production.stage == NativeProductionStage.READY_FOR_RENDER) {
                listOf(
                    NativeDiagnostic(
                        "SCENE_PLAN_RESTORED",
                        "Hash-bound Scene IR/timeline reloaded and revalidated against the exact script/reference/build identity.",
                    ),
                ) + production.diagnostics
            } else {
                production.diagnostics
            },
        )
    }
}
