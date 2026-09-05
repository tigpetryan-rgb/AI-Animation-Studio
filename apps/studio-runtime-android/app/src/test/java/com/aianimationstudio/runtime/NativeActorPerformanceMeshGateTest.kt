package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeActorPerformanceMeshGateTest {
    private val sourceSha = "789abcdef0123456789abcdef0123456789abcde"
    private val referenceSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    private fun reference() = PersistedReferenceAsset(
        displayName = "phase4-mesh.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1280,
        height = 1280,
        sha256 = referenceSha,
        originUri = "content://test/phase4-mesh",
        localFile = File("build/phase4-mesh-reference.bin"),
    )

    private fun asset(): NativeCharacterAsset3D {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "phase4-mesh",
            prompt = "# source 12 seconds 320x240 12 fps\nACTOR WAIT\nACTOR REACT",
            reference = reference(),
            sourceCommit = sourceSha,
            shotId = "source-shot",
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        val result = NativeCharacterAsset3DFactory.capture(requireNotNull(snapshot.model3d), requireNotNull(snapshot.rig))
        assertTrue(result is NativeCharacterAsset3DResult.Ready)
        return (result as NativeCharacterAsset3DResult.Ready).asset
    }

    @Test
    fun `phase4 multi step performance keeps real skinned mesh volumetric and continuous`() {
        val asset = asset()
        val registry = listOf(
            NativeStoryEntity(asset.actorId, NativeEntityKind.CHARACTER, listOf("ACTOR")),
            NativeStoryEntity("prop_box", NativeEntityKind.PROP, listOf("BOX")),
        )
        val story = NativeStoryCompiler.compile(
            """
            ACTOR WALK_TO BOX
            ACTOR WAIT
            ACTOR TURN_TO BOX
            ACTOR LOOK_AT BOX
            ACTOR PICK_UP BOX
            ACTOR USE BOX
            ACTOR REACT
            """.trimIndent(),
            registry,
        )
        assertTrue(story.ok)
        val result = NativeActorPerformancePhase4Engine.execute(asset, "phase4-mesh-shot", story, 14.0)
        assertTrue(result is NativePhase4PerformanceResult.Ready)
        val ready = (result as NativePhase4PerformanceResult.Ready).performance
        assertTrue(ready.acceptance.done)

        val report = NativePhase4SkinnedMeshContinuityGate.verify(asset, ready.canonical)
        assertTrue(report.diagnostics.joinToString { "${it.code}:${it.message}" }, report.passed)
        assertEquals(6, report.samples.size)
        report.samples.forEach { sample ->
            assertEquals(asset.vertexCount, sample.finiteVertices)
            assertTrue(sample.widthMeters >= 0.30)
            assertTrue(sample.heightMeters >= 0.70)
            assertTrue(sample.depthMeters >= 0.16)
            assertTrue(sample.widthMeters <= 4.0)
            assertTrue(sample.heightMeters <= 4.0)
            assertTrue(sample.depthMeters <= 4.0)
        }
        val centers = report.samples.map { it.center }
        assertTrue(centers.zipWithNext().all { (a, b) ->
            val dx = b.x - a.x
            val dy = b.y - a.y
            val dz = b.z - a.z
            kotlin.math.sqrt(dx * dx + dy * dy + dz * dz) <= 1.5
        })
    }
}
