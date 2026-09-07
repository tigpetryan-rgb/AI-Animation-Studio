package com.aianimationstudio.runtime

import android.content.Context
import android.net.Uri
import java.io.File

internal sealed interface CharacterMakerBuildResult {
    data class Ready(
        val definitionId: String,
        val vertexCount: Int,
        val triangleCount: Int,
        val referenceSha256: String,
        val assetPayloadSha256: String,
        val manifestSha256: String,
    ) : CharacterMakerBuildResult

    data class Rejected(val diagnostics: List<NativeDiagnostic>) : CharacterMakerBuildResult
}

/**
 * Focused image -> reusable 3D character adapter for the standalone Character Maker app.
 * It reuses the verified M58 reference analyzer, humanoid rig, real triangle mesh/skinning,
 * character-definition validator and checksummed durable store without invoking Studio media flows.
 */
internal class CharacterMakerController(context: Context) {
    private val appContext = context.applicationContext
    private val sourceStore = NativeSourceStore(appContext)
    private val definitionStore = NativeCharacterDefinition3DStore(
        File(appContext.filesDir, "character-maker/definition"),
    )

    fun importReference(uri: Uri): PersistedReferenceAsset {
        definitionStore.clear()
        return sourceStore.importFrom(uri)
    }

    fun restoreReference(): PersistedReferenceAsset? = sourceStore.restoreVerified()

    fun restoreDefinition(reference: PersistedReferenceAsset): NativePersistedCharacterDefinition3D? =
        definitionStore.restoreVerified(
            actorId = CHARACTER_MAKER_ACTOR_ID,
            referenceSha256 = reference.sha256,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
        )

    fun build(reference: PersistedReferenceAsset): CharacterMakerBuildResult {
        val blocking = when (
            val result = NativeSceneBlockingCompiler.compile(
                chatId = CHARACTER_MAKER_ACTOR_ID,
                prompt = "ACTOR WAIT",
                reference = reference,
            )
        ) {
            is NativeBlockingResult.Ready -> result.blocking
            is NativeBlockingResult.Rejected -> return CharacterMakerBuildResult.Rejected(result.diagnostics)
        }

        val rig = when (
            val result = NativePerformanceEngine.prepareRig(
                blocking = blocking,
                shotId = CHARACTER_MAKER_SHOT_ID,
                sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            )
        ) {
            is NativeRigResult.Ready -> result.rig
            is NativeRigResult.Rejected -> return CharacterMakerBuildResult.Rejected(result.diagnostics)
        }

        val model = when (val result = NativeReferenceDrivenCharacterModel3DBuilder.build(blocking, rig)) {
            is NativeCharacterModel3DResult.Ready -> result.model
            is NativeCharacterModel3DResult.Rejected -> return CharacterMakerBuildResult.Rejected(result.diagnostics)
        }

        val snapshot = NativeProductionSnapshot(
            stage = NativeProductionStage.READY_FOR_RENDER,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            referenceSha256 = reference.sha256,
            blocking = blocking,
            rig = rig,
            model3d = model,
        )
        val definition = when (val result = NativeCharacterDefinition3DFactory.capture(snapshot, reference)) {
            is NativeCharacterDefinition3DResult.Ready -> result.definition
            is NativeCharacterDefinition3DResult.Rejected -> return CharacterMakerBuildResult.Rejected(result.diagnostics)
        }

        return try {
            val persisted = definitionStore.persist(definition)
            CharacterMakerBuildResult.Ready(
                definitionId = definition.definitionId,
                vertexCount = definition.asset.vertexCount,
                triangleCount = definition.asset.triangleCount,
                referenceSha256 = definition.appearance.referenceSha256,
                assetPayloadSha256 = persisted.assetPayloadSha256,
                manifestSha256 = persisted.manifestSha256,
            )
        } catch (failure: Exception) {
            CharacterMakerBuildResult.Rejected(
                listOf(
                    NativeDiagnostic(
                        code = "CHARACTER_MAKER_PERSIST",
                        message = failure.message ?: "3D կերպարը չհաջողվեց պահպանել։",
                    ),
                ),
            )
        }
    }

    private companion object {
        const val CHARACTER_MAKER_ACTOR_ID = "character-character-maker"
        const val CHARACTER_MAKER_SHOT_ID = "character-maker-definition"
    }
}
