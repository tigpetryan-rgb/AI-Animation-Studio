package com.aianimationstudio.runtime

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream

class NativeCharacterDefinition3DTest {
    private val sourceSha = "1234567890abcdef1234567890abcdef12345678"
    private val imageWidth = 160
    private val imageHeight = 100

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun turnaroundPng(
        frontWidth: Int = 28,
        sideWidth: Int = 12,
        bodyRgb: Int = 0x2f9f9b,
    ): ByteArray {
        require(frontWidth in 18..34)
        require(sideWidth in 7..16)
        val pixels = IntArray(imageWidth * imageHeight) { 0xffffff }

        fun rect(left: Int, top: Int, width: Int, height: Int, rgb: Int) {
            for (y in top until top + height) {
                for (x in left until left + width) {
                    if (x in 0 until imageWidth && y in 0 until imageHeight) {
                        pixels[y * imageWidth + x] = rgb and 0xffffff
                    }
                }
            }
        }

        // A deterministic turnaround sheet: front, narrow side and back silhouettes in the
        // upper-right region expected by the production shape analyzer.
        rect(64, 8, frontWidth, 40, bodyRgb)
        rect(106, 8, sideWidth, 40, bodyRgb)
        rect(132, 8, (frontWidth - 4).coerceAtLeast(14).coerceAtMost(28), 40, bodyRgb)
        // Small identity details remain connected to the front silhouette and survive exact bytes.
        rect(70, 18, 4, 4, 0x101820)
        rect(82, 18, 4, 4, 0x101820)
        rect(75, 32, 8, 3, 0xe8b832)

        val raw = ByteArrayOutputStream()
        for (y in 0 until imageHeight) {
            raw.write(0) // PNG filter: None
            for (x in 0 until imageWidth) {
                val rgb = pixels[y * imageWidth + x]
                raw.write((rgb ushr 16) and 0xff)
                raw.write((rgb ushr 8) and 0xff)
                raw.write(rgb and 0xff)
            }
        }
        val compressed = ByteArrayOutputStream()
        DeflaterOutputStream(compressed).use { it.write(raw.toByteArray()) }

        val png = ByteArrayOutputStream()
        png.write(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        val header = ByteArrayOutputStream().also { output ->
            DataOutputStream(output).use { data ->
                data.writeInt(imageWidth)
                data.writeInt(imageHeight)
                data.writeByte(8)
                data.writeByte(2) // truecolor RGB
                data.writeByte(0)
                data.writeByte(0)
                data.writeByte(0) // non-interlaced
            }
        }.toByteArray()
        writePngChunk(png, "IHDR", header)
        writePngChunk(png, "IDAT", compressed.toByteArray())
        writePngChunk(png, "IEND", ByteArray(0))
        return png.toByteArray()
    }

    private fun writePngChunk(output: ByteArrayOutputStream, type: String, data: ByteArray) {
        val typeBytes = type.toByteArray(Charsets.US_ASCII)
        DataOutputStream(output).apply {
            writeInt(data.size)
            write(typeBytes)
            write(data)
            val crc = CRC32().apply {
                update(typeBytes)
                update(data)
            }
            writeInt(crc.value.toInt())
        }
    }

    private fun reference(
        tag: String = "source",
        frontWidth: Int = 28,
        sideWidth: Int = 12,
        bodyRgb: Int = 0x2f9f9b,
    ): PersistedReferenceAsset {
        val pngBytes = turnaroundPng(frontWidth, sideWidth, bodyRgb)
        val file = File("build/phase3-$tag-${System.nanoTime()}.png")
        file.parentFile?.mkdirs()
        file.writeBytes(pngBytes)
        return PersistedReferenceAsset(
            displayName = "phase3-character.png",
            mimeType = "image/png",
            sizeBytes = pngBytes.size.toLong(),
            width = imageWidth,
            height = imageHeight,
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

    private fun width(model: NativeCharacterModel3D): Double =
        model.vertices.maxOf { it.bindPosition.x } - model.vertices.minOf { it.bindPosition.x }

    private fun depth(model: NativeCharacterModel3D): Double =
        model.vertices.maxOf { it.bindPosition.z } - model.vertices.minOf { it.bindPosition.z }

    @Test
    fun `real multi-view png drives reusable 3d proportions rig skinning uv and appearance identity`() {
        val reference = reference("capture")
        try {
            val profile = requireNotNull(NativeReferenceShapeAnalyzer3D.analyze(reference))
            assertEquals("TURNAROUND_MULTI_VIEW_HEURISTIC_V1", profile.mode)
            assertTrue(profile.viewEvidence.size >= 2)
            assertTrue(profile.widthScale in 0.90..1.05)
            assertEquals(0.58, profile.depthScale, 0.000001)

            val snapshot = readySnapshot(reference, "shot-source")
            val rig = requireNotNull(snapshot.rig)
            val model = requireNotNull(snapshot.model3d)
            val blocking = requireNotNull(snapshot.blocking)
            val base = when (val result = NativeCharacterModel3DBuilder.build(blocking, rig)) {
                is NativeCharacterModel3DResult.Ready -> result.model
                is NativeCharacterModel3DResult.Rejected -> error(result.diagnostics.joinToString { it.code })
            }
            assertEquals(profile.widthScale, width(model) / width(base), 0.000001)
            assertEquals(profile.depthScale, depth(model) / depth(base), 0.000001)

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
            assertArrayEquals(reference.localFile.readBytes(), definition.appearance.referenceBytes)
            assertTrue(NativeCharacterDefinition3DValidator.validate(definition).isEmpty())

            val materials = asset.vertices.map { it.material }.toSet()
            assertTrue(materials.containsAll(NativeMaterialSlot3D.values().toSet()))
            assertTrue(asset.vertices.all { vertex ->
                vertex.uv.u.isFinite() && vertex.uv.v.isFinite() && vertex.uv.u in 0.0..1.0 && vertex.uv.v in 0.0..1.0
            })
            assertTrue(asset.depthExtentMeters >= 0.20)
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
    fun `different real reference silhouettes produce measurably different reusable 3d geometry`() {
        val narrow = reference("narrow", frontWidth = 20, sideWidth = 8, bodyRgb = 0x355fc4)
        val wide = reference("wide", frontWidth = 34, sideWidth = 16, bodyRgb = 0xb94b3f)
        try {
            val narrowProfile = requireNotNull(NativeReferenceShapeAnalyzer3D.analyze(narrow))
            val wideProfile = requireNotNull(NativeReferenceShapeAnalyzer3D.analyze(wide))
            assertTrue(wideProfile.widthScale > narrowProfile.widthScale)
            assertNotEquals(wide.sha256, narrow.sha256)

            val narrowModel = requireNotNull(readySnapshot(narrow, "shot-narrow").model3d)
            val wideModel = requireNotNull(readySnapshot(wide, "shot-wide").model3d)
            assertTrue(width(wideModel) > width(narrowModel))
            assertNotEquals(width(wideModel), width(narrowModel), 0.000001)

            val narrowRaster = requireNotNull(NativeReferenceRaster3DDecoder.decode(narrow.localFile, narrow.mimeType))
            val wideRaster = requireNotNull(NativeReferenceRaster3DDecoder.decode(wide.localFile, wide.mimeType))
            assertNotEquals(narrowRaster.pixelAt(70, 10), wideRaster.pixelAt(70, 10))
        } finally {
            narrow.localFile.delete()
            wide.localFile.delete()
        }
    }

    @Test
    fun `definition survives save reopen without original reference and restores exact visual profile`() {
        val reference = reference("reopen")
        val originalBytes = reference.localFile.readBytes()
        val originalProfile = requireNotNull(NativeReferenceShapeAnalyzer3D.analyze(reference))
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
            assertArrayEquals(originalBytes, restored.definition.appearance.referenceBytes)
            assertTrue(NativeCharacterDefinition3DValidator.validate(restored.definition).isEmpty())

            val materialized = restored.definition.materializeReference(restoredReferenceFile)
            assertTrue(restoredReferenceFile.isFile)
            assertArrayEquals(originalBytes, restoredReferenceFile.readBytes())
            assertEquals(reference.sha256, materialized.sha256)
            val reopenedProfile = requireNotNull(NativeReferenceShapeAnalyzer3D.analyze(materialized))
            assertEquals(originalProfile, reopenedProfile)

            val originalRaster = requireNotNull(NativeReferenceRaster3DDecoder.decode(originalBytes, "image/png"))
            val reopenedRaster = requireNotNull(NativeReferenceRaster3DDecoder.decode(restoredReferenceFile, "image/png"))
            assertEquals(originalRaster.pixelAt(72, 20), reopenedRaster.pixelAt(72, 20))
            assertEquals(originalRaster.pixelAt(78, 33), reopenedRaster.pixelAt(78, 33))

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
