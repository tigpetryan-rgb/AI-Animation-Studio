package com.aianimationstudio.runtime

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64

class NativeCharacterDefinition3DTest {
    private val sourceSha = "1234567890abcdef1234567890abcdef12345678"
    private val pngBytes = Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    )

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun reference(tag: String = "source"): PersistedReferenceAsset {
        val file = File("build/phase3-$tag-${System.nanoTime()}.png")
        file.parentFile?.mkdirs()
        file.writeBytes(pngBytes)
        return PersistedReferenceAsset(
            displayName = "phase3-character.png",
            mimeType = "image/png",
            sizeBytes = pngBytes.size.toLong(),
            width = 1,
            height = 1,
            sha256 = sha256(pngBytes),
            originUri = "content://test/phase3-character/$tag",
            localFile = file,
        )
    }

    private fun readySnapshot(reference: PersistedReferenceAsset, shotId: String = "shot-1"): NativeProductionSnapshot {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase3-character-definition",
            prompt = "# Phase 3 30 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT\nACTOR SPEAK hello\nACTOR SIT\nACTOR STAND",
            reference = reference,
            sourceCommit = sourceSha,
            shotId = shotId,
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        return snapshot
    }

    private fun capturedDefinition(reference: PersistedReferenceAsset): NativeCharacterDefinition3D {
        val result = NativeCharacterDefinition3DFactory.capture(readySnapshot(reference), reference)
        assertTrue(result is NativeCharacterDefinition3DResult.Ready)
        return (result as NativeCharacterDefinition3DResult.Ready).definition
    }

    @Test
    fun `real admitted reference becomes a reusable identity-bound 3d character definition`() {
        val reference = reference("capture")
        try {
            val snapshot = readySnapshot(reference, "shot-source")
            val result = NativeCharacterDefinition3DFactory.capture(snapshot, reference)
            assertTrue(result is NativeCharacterDefinition3DResult.Ready)
            val definition = (result as NativeCharacterDefinition3DResult.Ready).definition
            val asset = definition.asset

            assertEquals(NATIVE_CHARACTER_DEFINITION_3D_SCHEMA_VERSION, definition.schemaVersion)
            assertEquals(reference.sha256, asset.referenceSha256)
            assertEquals(reference.sha256, definition.appearance.referenceSha256)
            assertEquals(reference.mimeType, definition.appearance.mimeType)
            assertEquals(reference.width, definition.appearance.width)
            assertEquals(reference.height, definition.appearance.height)
            assertArrayEquals(pngBytes, definition.appearance.referenceBytes)
            assertTrue(NativeCharacterDefinition3DValidator.validate(definition).isEmpty())

            val materials = asset.vertices.map { it.material }.toSet()
            assertTrue(materials.containsAll(NativeMaterialSlot3D.values().toSet()))
            assertTrue(asset.vertices.all { vertex ->
                vertex.uv.u.isFinite() && vertex.uv.v.isFinite() && vertex.uv.u in 0.0..1.0 && vertex.uv.v in 0.0..1.0
            })
            assertTrue(asset.depthExtentMeters >= 0.25)
            assertTrue(asset.bindJoints.size >= 7)
            assertTrue(asset.vertices.all { vertex ->
                vertex.influences.isNotEmpty() &&
                    vertex.influences.all { it.weight > 0.0 } &&
                    kotlin.math.abs(vertex.influences.sumOf { it.weight } - 1.0) < 0.000001
            })
        } finally {
            reference.localFile.delete()
        }
    }

    @Test
    fun `definition survives save reopen without original reference and restores exact appearance`() {
        val reference = reference("reopen")
        val definition = capturedDefinition(reference)
        val directory = File("build/phase3-definition-${System.nanoTime()}")
        val store = NativeCharacterDefinition3DStore(directory)
        val restoredReferenceFile = File("build/phase3-restored-reference-${System.nanoTime()}.png")
        try {
            val persisted = store.persist(definition)
            assertTrue(Regex("^[0-9a-f]{64}$").matches(persisted.assetPayloadSha256))
            assertTrue(Regex("^[0-9a-f]{64}$").matches(persisted.manifestSha256))

            assertTrue(reference.localFile.delete())
            assertFalse(reference.localFile.exists())

            val restored = requireNotNull(
                store.restoreVerified(
                    actorId = definition.asset.actorId,
                    referenceSha256 = definition.asset.referenceSha256,
                    sourceCommit = definition.asset.sourceCommit,
                ),
            )

            assertEquals(definition.asset.assetId, restored.definition.asset.assetId)
            assertEquals(definition.asset.skeleton, restored.definition.asset.skeleton)
            assertEquals(definition.asset.vertices, restored.definition.asset.vertices)
            assertEquals(definition.asset.triangles, restored.definition.asset.triangles)
            assertEquals(definition.asset.bindJoints, restored.definition.asset.bindJoints)
            assertEquals(definition.appearance.referenceSha256, restored.definition.appearance.referenceSha256)
            assertEquals(definition.appearance.mimeType, restored.definition.appearance.mimeType)
            assertEquals(definition.appearance.width, restored.definition.appearance.width)
            assertEquals(definition.appearance.height, restored.definition.appearance.height)
            assertArrayEquals(definition.appearance.referenceBytes, restored.definition.appearance.referenceBytes)
            assertTrue(NativeCharacterDefinition3DValidator.validate(restored.definition).isEmpty())

            val materialized = restored.definition.materializeReference(restoredReferenceFile)
            assertTrue(restoredReferenceFile.isFile)
            assertArrayEquals(pngBytes, restoredReferenceFile.readBytes())
            assertEquals(reference.sha256, materialized.sha256)
            assertEquals(reference.mimeType, materialized.mimeType)
            assertEquals(reference.width, materialized.width)
            assertEquals(reference.height, materialized.height)

            val reused = NativeCharacterAsset3DFactory.instantiate(restored.definition.asset, "shot-after-reopen")
            assertTrue(reused is NativeCharacterAssetInstantiation3DResult.Ready)
            val instance = (reused as NativeCharacterAssetInstantiation3DResult.Ready).instance
            assertEquals("shot-after-reopen", instance.model.shotId)
            assertEquals(restored.definition.asset.referenceSha256, instance.model.referenceSha256)
            assertTrue(NativeCharacterModel3DValidator.validate(instance.model, instance.rig).isEmpty())
        } finally {
            store.clear()
            reference.localFile.delete()
            restoredReferenceFile.delete()
        }
    }

    @Test
    fun `definition restore fails closed on appearance tamper and capture rejects identity mismatch`() {
        val reference = reference("tamper")
        val definition = capturedDefinition(reference)
        val directory = File("build/phase3-definition-tamper-${System.nanoTime()}")
        val store = NativeCharacterDefinition3DStore(directory)
        try {
            store.persist(definition)
            val storedReference = File(directory, "reference-image.bin")
            val bytes = storedReference.readBytes()
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 0x01).toByte()
            storedReference.writeBytes(bytes)

            assertNull(
                store.restoreVerified(
                    actorId = definition.asset.actorId,
                    referenceSha256 = definition.asset.referenceSha256,
                    sourceCommit = definition.asset.sourceCommit,
                ),
            )
            assertFalse(storedReference.exists())

            val mismatched = reference.copy(sha256 = "0".repeat(64))
            val rejected = NativeCharacterDefinition3DFactory.capture(readySnapshot(reference), mismatched)
            assertTrue(rejected is NativeCharacterDefinition3DResult.Rejected)
            val diagnostics = (rejected as NativeCharacterDefinition3DResult.Rejected).diagnostics
            assertTrue(diagnostics.any { it.code == "CHARACTER_DEFINITION_REFERENCE_CONTINUITY" })
        } finally {
            store.clear()
            reference.localFile.delete()
        }
    }
}
