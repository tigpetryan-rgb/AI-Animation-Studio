package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativePerformanceEngineTest {
    private val sourceCommit = "c".repeat(40)
    private val reference = PersistedReferenceAsset(
        displayName = "character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1254,
        height = 1254,
        sha256 = "d".repeat(64),
        originUri = "content://test/reference",
        localFile = File("reference.bin"),
    )

    private fun blocking(prompt: String): NativeSceneBlocking =
        (NativeSceneBlockingCompiler.compile("main", prompt, reference) as NativeBlockingResult.Ready).blocking

    private fun registry(actorId: String) = listOf(
        NativeStoryEntity(actorId, NativeEntityKind.CHARACTER, listOf("ACTOR", "CHARACTER")),
        NativeStoryEntity("prop_door", NativeEntityKind.PROP, listOf("DOOR")),
    )

    @Test
    fun `canonical rig carries exact source and reference identity`() {
        val scene = blocking("ACTOR WAIT")
        val result = NativePerformanceEngine.prepareRig(scene, "shot-1", sourceCommit)
        assertTrue(result is NativeRigResult.Ready)
        val rig = (result as NativeRigResult.Ready).rig
        assertEquals(sourceCommit, rig.sourceCommit)
        assertEquals(reference.sha256, rig.referenceSha256)
        assertEquals(21, rig.skeleton.bones.size)
        val roles = rig.skeleton.bones.mapNotNull { it.semanticRole }.toSet()
        assertTrue(roles.contains(NativeSemanticBoneRole.HIPS))
        assertTrue(roles.contains(NativeSemanticBoneRole.HEAD))
        assertTrue(roles.contains(NativeSemanticBoneRole.LEFT_HAND))
        assertTrue(roles.contains(NativeSemanticBoneRole.RIGHT_HAND))
        assertTrue(roles.contains(NativeSemanticBoneRole.LEFT_FOOT))
        assertTrue(roles.contains(NativeSemanticBoneRole.RIGHT_FOOT))
    }

    @Test
    fun `wait story produces bounded keyframe performance without fabricated contact`() {
        val scene = blocking("ACTOR WAIT")
        val rig = (NativePerformanceEngine.prepareRig(scene, "shot-1", sourceCommit) as NativeRigResult.Ready).rig
        val story = NativeStoryCompiler.compile("ACTOR WAIT", registry(scene.actorId))
        val result = NativePerformanceEngine.execute(scene, rig, story, sourceCommit)
        assertTrue(result is NativePerformanceResult.Ready)
        val ready = result as NativePerformanceResult.Ready
        assertTrue(ready.performanceGate)
        assertTrue(ready.contactIkGate)
        assertTrue(ready.physicsGate)
        assertEquals(listOf(NativePerformanceIntentType.IDLE), ready.performance.intents.map { it.type })
        assertEquals(
            listOf(NativePerformanceTrackKind.ROOT, NativePerformanceTrackKind.BODY, NativePerformanceTrackKind.HEAD),
            ready.performance.tracks.map { it.kind },
        )
        assertTrue(ready.performance.tracks.all { it.keyframes.size == 3 })
    }

    @Test
    fun `look story adds gaze track`() {
        val scene = blocking("ACTOR LOOK_AT DOOR")
        val rig = (NativePerformanceEngine.prepareRig(scene, "shot-1", sourceCommit) as NativeRigResult.Ready).rig
        val story = NativeStoryCompiler.compile("ACTOR LOOK_AT DOOR", registry(scene.actorId))
        val result = NativePerformanceEngine.execute(scene, rig, story, sourceCommit)
        assertTrue(result is NativePerformanceResult.Ready)
        val tracks = (result as NativePerformanceResult.Ready).performance.tracks.map { it.kind }
        assertTrue(tracks.contains(NativePerformanceTrackKind.GAZE))
    }

    @Test
    fun `open story fails contact IK instead of fabricating anchor`() {
        val scene = blocking("ACTOR OPEN DOOR")
        val rig = (NativePerformanceEngine.prepareRig(scene, "shot-1", sourceCommit) as NativeRigResult.Ready).rig
        val story = NativeStoryCompiler.compile("ACTOR OPEN DOOR", registry(scene.actorId))
        val result = NativePerformanceEngine.execute(scene, rig, story, sourceCommit)
        assertTrue(result is NativePerformanceResult.Rejected)
        val rejected = result as NativePerformanceResult.Rejected
        assertTrue(rejected.performanceGate)
        assertFalse(rejected.contactIkGate)
        assertTrue(rejected.physicsGate)
        assertTrue(rejected.diagnostics.any { it.code == "PERF_CONTACT_IK_REQUIRED" })
    }

    @Test
    fun `performance rejects stale source identity`() {
        val scene = blocking("ACTOR WAIT")
        val rig = (NativePerformanceEngine.prepareRig(scene, "shot-1", sourceCommit) as NativeRigResult.Ready).rig
        val story = NativeStoryCompiler.compile("ACTOR WAIT", registry(scene.actorId))
        val result = NativePerformanceEngine.execute(scene, rig, story, "e".repeat(40))
        assertTrue(result is NativePerformanceResult.Rejected)
        assertEquals("PERF_SOURCE_IDENTITY", (result as NativePerformanceResult.Rejected).diagnostics.single().code)
    }
}
