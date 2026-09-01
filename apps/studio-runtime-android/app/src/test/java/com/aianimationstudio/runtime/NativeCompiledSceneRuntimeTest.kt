package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeCompiledSceneRuntimeTest {
    private val sourceCommit = "a".repeat(40)
    private val referenceSha = "b".repeat(64)
    private val script = "Կերպարը հանգիստ սպասում է 24 վայրկյան։ Ելքը՝ 320×240, 12 կադր/վրկ։"
    private val reference = PersistedReferenceAsset(
        displayName = "reference.png",
        mimeType = "image/png",
        sizeBytes = 1024,
        width = 1254,
        height = 1254,
        sha256 = referenceSha,
        originUri = "content://fixture/reference",
        localFile = File("reference.bin"),
    )

    @Test
    fun `verified persisted plan re-enters deterministic production without semantic backend`() {
        val persisted = persistedPlan()

        val snapshot = NativeCompiledSceneRuntime.prepareVerified(
            chatId = "restored-project",
            prompt = script,
            reference = reference,
            sourceCommit = sourceCommit,
            persisted = persisted,
        )

        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, snapshot.sceneSemanticStatus)
        assertEquals(persisted.ir, snapshot.sceneIr)
        assertEquals(persisted.timeline, snapshot.sceneTimeline)
        assertTrue(snapshot.performanceReady)
        assertTrue(snapshot.cameraReady)
        assertTrue(snapshot.diagnostics.any { it.code == "SCENE_PLAN_RESTORED" })
    }

    @Test
    fun `runtime reload refuses any script identity drift`() {
        val persisted = persistedPlan()

        val snapshot = NativeCompiledSceneRuntime.prepareVerified(
            chatId = "restored-project",
            prompt = "$script փոփոխված",
            reference = reference,
            sourceCommit = sourceCommit,
            persisted = persisted,
        )

        assertEquals(NativeProductionStage.WAITING_VALIDATION, snapshot.stage)
        assertEquals(NativeSceneSemanticStatus.INVALID_SCHEMA, snapshot.sceneSemanticStatus)
        assertFalse(snapshot.performanceReady)
        assertTrue(snapshot.diagnostics.any { it.code == "SCENE_PERSISTED_IDENTITY" })
    }

    private fun persistedPlan(): NativePersistedScenePlan {
        val compilation = NaturalLanguageSceneCompiler(NativeSupportedSubsetSemanticProbe).compile(
            NativeSceneSemanticRequest(
                originalText = script,
                sourceCommit = sourceCommit,
                referenceSha256 = referenceSha,
                actorId = "character-main",
            ),
        )
        val ir = requireNotNull(compilation.ir)
        val timeline = (NativeSceneTimelineCompiler.singleShot(ir) as NativeSceneTimelineResult.Ready).timeline
        return NativePersistedScenePlan(ir, timeline, payloadSha256 = "f".repeat(64))
    }
}
