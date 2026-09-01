package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeCharacterModel3DTest {
    private val sourceSha = "1234567890abcdef1234567890abcdef12345678"

    private fun reference() = PersistedReferenceAsset(
        displayName = "bim-reference.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1248,
        height = 1248,
        sha256 = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        originUri = "content://test/bim",
        localFile = File("build/test-bim-reference.bin"),
    )

    private fun readySnapshot(): NativeProductionSnapshot = NativeProductionCoordinator.prepare(
        chatId = "bim-3d",
        prompt = "# BIM 30 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT\nACTOR SPEAK hello\nACTOR SIT\nACTOR STAND",
        reference = reference(),
        sourceCommit = sourceSha,
    )

    @Test
    fun `production readiness now requires a real source-bound 3d mesh`() {
        val snapshot = readySnapshot()
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        assertTrue(snapshot.model3dReady)

        val model = assertNotNull(snapshot.model3d).let { requireNotNull(snapshot.model3d) }
        assertEquals(NATIVE_CHARACTER_MODEL_3D_KIND, model.modelKind)
        assertEquals(snapshot.blocking?.actorId, model.actorId)
        assertEquals(snapshot.referenceSha256, model.referenceSha256)
        assertEquals(sourceSha, model.sourceCommit)
        assertTrue(model.vertexCount >= 64)
        assertTrue(model.triangleCount >= 64)
        assertTrue(model.depthExtentMeters >= 0.25)
        assertTrue(model.bindJoints.size >= 7)
        assertTrue(NativeCharacterModel3DValidator.validate(model, requireNotNull(snapshot.rig)).isEmpty())
        assertTrue(snapshot.diagnostics.any { it.code == "MODEL3D_READY" })
    }

    @Test
    fun `every mesh vertex carries normalized skin weights bound to known bones`() {
        val snapshot = readySnapshot()
        val model = requireNotNull(snapshot.model3d)
        val knownBones = requireNotNull(snapshot.rig).skeleton.bones.mapNotNull { it.semanticRole }.toSet()

        model.vertices.forEach { vertex ->
            assertTrue(vertex.influences.isNotEmpty())
            assertTrue(vertex.influences.size <= 4)
            assertEquals(1.0, vertex.influences.sumOf { it.weight }, 0.000001)
            assertTrue(vertex.influences.all { it.bone in knownBones && it.weight > 0.0 })
        }
    }

    @Test
    fun `flat card geometry is rejected as not a 3d character model`() {
        val snapshot = readySnapshot()
        val rig = requireNotNull(snapshot.rig)
        val valid = requireNotNull(snapshot.model3d)
        val flat = valid.copy(
            vertices = valid.vertices.map { vertex ->
                vertex.copy(bindPosition = vertex.bindPosition.copy(z = 0.0))
            },
        )
        val diagnostics = NativeCharacterModel3DValidator.validate(flat, rig)
        assertTrue(diagnostics.any { it.code == "MODEL3D_DEPTH" })
    }
}
