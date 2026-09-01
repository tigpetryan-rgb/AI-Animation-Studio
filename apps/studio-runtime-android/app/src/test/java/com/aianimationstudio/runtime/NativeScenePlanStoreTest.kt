package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.RandomAccessFile

class NativeScenePlanStoreTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val sourceCommit = "a".repeat(40)
    private val referenceSha = "b".repeat(64)
    private val script = "Կերպարը հանգիստ սպասում է 24 վայրկյան։ Ելքը՝ 320×240, 12 կադր/վրկ։"

    @Test
    fun `exact script reference and build identity restores persisted plan`() {
        val store = NativeScenePlanStore(temp.newFile("scene-plan.bin"))
        store.clear()
        val (ir, timeline) = readyPlan()
        val persistedSha = store.persist(ir, timeline)

        val restored = store.restoreVerified(script, referenceSha, sourceCommit)

        assertNotNull(restored)
        requireNotNull(restored)
        assertEquals(64, persistedSha.length)
        assertEquals(persistedSha, restored.payloadSha256)
        assertEquals(ir.scriptSha256, restored.ir.scriptSha256)
        assertEquals(referenceSha, restored.ir.referenceSha256)
        assertEquals(sourceCommit, restored.ir.sourceCommit)
        assertEquals(timeline.scriptSha256, restored.timeline.scriptSha256)
        assertEquals(timeline.shots, restored.timeline.shots)
    }

    @Test
    fun `script edit invalidates and removes persisted plan`() {
        val file = temp.newFile("scene-plan-script.bin")
        val store = NativeScenePlanStore(file)
        store.clear()
        val (ir, timeline) = readyPlan()
        store.persist(ir, timeline)

        val restored = store.restoreVerified("$script փոփոխված", referenceSha, sourceCommit)

        assertNull(restored)
        assertFalse(file.exists())
    }

    @Test
    fun `reference hash edit invalidates persisted plan`() {
        val file = temp.newFile("scene-plan-reference.bin")
        val store = NativeScenePlanStore(file)
        store.clear()
        val (ir, timeline) = readyPlan()
        store.persist(ir, timeline)

        val restored = store.restoreVerified(script, "c".repeat(64), sourceCommit)

        assertNull(restored)
        assertFalse(file.exists())
    }

    @Test
    fun `build hash edit invalidates persisted plan`() {
        val file = temp.newFile("scene-plan-build.bin")
        val store = NativeScenePlanStore(file)
        store.clear()
        val (ir, timeline) = readyPlan()
        store.persist(ir, timeline)

        val restored = store.restoreVerified(script, referenceSha, "d".repeat(40))

        assertNull(restored)
        assertFalse(file.exists())
    }

    @Test
    fun `payload or digest tamper is rejected and stale file removed`() {
        val file = temp.newFile("scene-plan-tamper.bin")
        val store = NativeScenePlanStore(file)
        store.clear()
        val (ir, timeline) = readyPlan()
        store.persist(ir, timeline)
        assertTrue(file.length() > 64L)

        RandomAccessFile(file, "rw").use { raf ->
            val position = raf.length() - 1L
            raf.seek(position)
            val original = raf.readUnsignedByte()
            raf.seek(position)
            raf.writeByte(original xor 0x01)
        }

        val restored = store.restoreVerified(script, referenceSha, sourceCommit)

        assertNull(restored)
        assertFalse(file.exists())
    }

    private fun readyPlan(): Pair<NativeSceneIrV1, NativeSceneTimelinePlan> {
        val compilation = NaturalLanguageSceneCompiler(NativeSupportedSubsetSemanticProbe).compile(
            NativeSceneSemanticRequest(
                originalText = script,
                sourceCommit = sourceCommit,
                referenceSha256 = referenceSha,
                actorId = "character-main",
            ),
        )
        assertEquals(NativeSceneSemanticStatus.VALID_EXECUTABLE, compilation.status)
        val ir = requireNotNull(compilation.ir)
        val timelineResult = NativeSceneTimelineCompiler.singleShot(ir)
        assertTrue(timelineResult is NativeSceneTimelineResult.Ready)
        return ir to (timelineResult as NativeSceneTimelineResult.Ready).timeline
    }
}
