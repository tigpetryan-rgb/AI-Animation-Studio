package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeCharacterAsset3DTest {
    private val sourceSha = "1234567890abcdef1234567890abcdef12345678"
    private val referenceSha = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase3-character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1248,
        height = 1248,
        sha256 = referenceSha,
        originUri = "content://test/phase3-character",
        localFile = File("build/test-phase3-character-reference.bin"),
    )

    private fun readySnapshot(shotId: String = "shot-1"): NativeProductionSnapshot = NativeProductionCoordinator.prepare(
        chatId = "phase3-character",
        prompt = "# Phase 3 30 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT\nACTOR SPEAK hello\nACTOR SIT\nACTOR STAND",
        reference = reference(),
        sourceCommit = sourceSha,
        shotId = shotId,
    )

    private fun capturedAsset(): NativeCharacterAsset3D {
        val snapshot = readySnapshot()
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        val result = NativeCharacterAsset3DFactory.capture(
            model = requireNotNull(snapshot.model3d),
            rig = requireNotNull(snapshot.rig),
        )
        assertTrue(result is NativeCharacterAsset3DResult.Ready)
        return (result as NativeCharacterAsset3DResult.Ready).asset
    }

    @Test
    fun `validated shot model becomes a reusable character asset and can instantiate another shot`() {
        val original = readySnapshot("shot-source")
        val originalModel = requireNotNull(original.model3d)
        val originalRig = requireNotNull(original.rig)
        val capture = NativeCharacterAsset3DFactory.capture(originalModel, originalRig)
        assertTrue(capture is NativeCharacterAsset3DResult.Ready)
        val asset = (capture as NativeCharacterAsset3DResult.Ready).asset

        assertEquals(NATIVE_CHARACTER_ASSET_3D_SCHEMA_VERSION, asset.schemaVersion)
        assertEquals(originalModel.actorId, asset.actorId)
        assertEquals(referenceSha, asset.referenceSha256)
        assertEquals(sourceSha, asset.sourceCommit)
        assertEquals(originalModel.vertexCount, asset.vertexCount)
        assertEquals(originalModel.triangleCount, asset.triangleCount)
        assertEquals(originalModel.bindJoints, asset.bindJoints)
        assertTrue(NativeCharacterAsset3DValidator.validate(asset).isEmpty())

        val instantiated = NativeCharacterAsset3DFactory.instantiate(asset, "shot-reused")
        assertTrue(instantiated is NativeCharacterAssetInstantiation3DResult.Ready)
        val instance = (instantiated as NativeCharacterAssetInstantiation3DResult.Ready).instance
        assertEquals("shot-reused", instance.rig.shotId)
        assertEquals("shot-reused", instance.model.shotId)
        assertNotEquals(originalModel.shotId, instance.model.shotId)
        assertEquals(asset.assetId, instance.asset.assetId)
        assertEquals(asset.vertexCount, instance.model.vertexCount)
        assertEquals(asset.triangleCount, instance.model.triangleCount)
        assertEquals(asset.depthExtentMeters, instance.model.depthExtentMeters, 0.000001)
        assertTrue(NativeCharacterModel3DValidator.validate(instance.model, instance.rig).isEmpty())
    }

    @Test
    fun `character asset survives checksummed save reopen and preserves exact identity`() {
        val asset = capturedAsset()
        val file = File("build/test-phase3-character-${System.nanoTime()}.aichar3d")
        val store = NativeCharacterAsset3DStore(file)
        try {
            val persistedDigest = store.persist(asset)
            assertTrue(Regex("^[0-9a-f]{64}$").matches(persistedDigest))
            assertTrue(file.isFile)
            assertTrue(file.length() > 0L)

            val restored = requireNotNull(store.restoreVerified(asset.actorId, referenceSha, sourceSha))
            assertEquals(persistedDigest, restored.payloadSha256)
            assertEquals(asset.assetId, restored.asset.assetId)
            assertEquals(asset.actorId, restored.asset.actorId)
            assertEquals(asset.referenceSha256, restored.asset.referenceSha256)
            assertEquals(asset.sourceCommit, restored.asset.sourceCommit)
            assertEquals(asset.skeleton, restored.asset.skeleton)
            assertEquals(asset.vertices, restored.asset.vertices)
            assertEquals(asset.triangles, restored.asset.triangles)
            assertEquals(asset.bindJoints, restored.asset.bindJoints)

            val reused = NativeCharacterAsset3DFactory.instantiate(restored.asset, "shot-after-reopen")
            assertTrue(reused is NativeCharacterAssetInstantiation3DResult.Ready)
        } finally {
            store.clear()
        }
    }

    @Test
    fun `restore fails closed on reference source mismatch and payload tampering`() {
        val asset = capturedAsset()
        val file = File("build/test-phase3-character-tamper-${System.nanoTime()}.aichar3d")
        val store = NativeCharacterAsset3DStore(file)
        try {
            store.persist(asset)
            assertNull(store.restoreVerified(asset.actorId, "0".repeat(64), sourceSha))
            assertFalse(file.exists())

            store.persist(asset)
            assertNull(store.restoreVerified(asset.actorId, referenceSha, "0".repeat(40)))
            assertFalse(file.exists())

            store.persist(asset)
            val bytes = file.readBytes()
            assertTrue(bytes.size > 96)
            bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 0x01).toByte()
            file.writeBytes(bytes)
            assertNull(store.restoreVerified(asset.actorId, referenceSha, sourceSha))
            assertFalse(file.exists())
        } finally {
            store.clear()
        }
    }

    @Test
    fun `invalid reusable identity and blank shot id are rejected`() {
        val asset = capturedAsset()
        val changed = asset.copy(referenceSha256 = "0".repeat(64))
        val diagnostics = NativeCharacterAsset3DValidator.validate(changed)
        assertTrue(diagnostics.any { it.code == "CHARACTER_ASSET_IDENTITY" })

        val instantiation = NativeCharacterAsset3DFactory.instantiate(asset, "")
        assertTrue(instantiation is NativeCharacterAssetInstantiation3DResult.Rejected)
        val rejected = instantiation as NativeCharacterAssetInstantiation3DResult.Rejected
        assertTrue(rejected.diagnostics.any { it.code == "CHARACTER_ASSET_SHOT_ID" })
    }
}
