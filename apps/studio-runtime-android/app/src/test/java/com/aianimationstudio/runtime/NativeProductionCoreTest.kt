package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeProductionCoreTest {
    private val reference = PersistedReferenceAsset(
        displayName = "character.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1254,
        height = 1254,
        sha256 = "a".repeat(64),
        originUri = "content://test/reference",
        localFile = File("reference.bin"),
    )

    @Test
    fun `scene blocking preserves M55 defaults and camera draft`() {
        val result = NativeSceneBlockingCompiler.compile("chat-main", "ACTOR WAIT", reference)
        assertTrue(result is NativeBlockingResult.Ready)
        val blocking = (result as NativeBlockingResult.Ready).blocking
        assertEquals(1920, blocking.output.width)
        assertEquals(1080, blocking.output.height)
        assertEquals(24.0, blocking.output.frameRate, 0.0)
        assertEquals(10.0, blocking.output.durationSeconds, 0.0)
        assertEquals(NativeStagePoint(0.0, 1.15, 3.8), blocking.cameraDraft.start)
        assertEquals(NativeStagePoint(0.0, 1.1, 2.4), blocking.cameraDraft.end)
        assertEquals(NativeStagePoint(0.0, 0.95, 0.0), blocking.cameraDraft.target)
    }

    @Test
    fun `scene blocking parses explicit output constraints`() {
        val result = NativeSceneBlockingCompiler.compile(
            "chat-main",
            "ACTOR WAIT\nrender 1280x720 30 fps 6 seconds",
            reference,
        )
        assertTrue(result is NativeBlockingResult.Ready)
        val output = (result as NativeBlockingResult.Ready).blocking.output
        assertEquals(1280, output.width)
        assertEquals(720, output.height)
        assertEquals(30.0, output.frameRate, 0.0)
        assertEquals(6.0, output.durationSeconds, 0.0)
    }

    @Test
    fun `scene blocking fails closed without prompt or reference`() {
        val result = NativeSceneBlockingCompiler.compile("chat", "", null)
        assertTrue(result is NativeBlockingResult.Rejected)
        val codes = (result as NativeBlockingResult.Rejected).diagnostics.map { it.code }
        assertTrue(codes.contains("BLOCKING_EMPTY_PROMPT"))
        assertTrue(codes.contains("BLOCKING_MISSING_REFERENCE"))
    }

    @Test
    fun `story compiler matches deterministic film compiler hello world`() {
        val registry = listOf(
            NativeStoryEntity("char_bim", NativeEntityKind.CHARACTER, listOf("BIM")),
            NativeStoryEntity("prop_key", NativeEntityKind.PROP, listOf("KEY")),
            NativeStoryEntity("prop_door", NativeEntityKind.PROP, listOf("DOOR")),
            NativeStoryEntity("loc_room", NativeEntityKind.LOCATION, listOf("ROOM")),
        )
        val source = listOf(
            "BIM ENTER ROOM",
            "BIM NOTICE KEY",
            "BIM WALK_TO KEY",
            "BIM PICK_UP KEY",
            "BIM LOOK_AT DOOR",
            "BIM OPEN DOOR",
            "BIM EXIT ROOM",
        ).joinToString("\n")

        val result = NativeStoryCompiler.compile(source, registry)
        assertTrue(result.ok)
        assertTrue(result.diagnostics.isEmpty())
        assertEquals(7, result.ir.events.size)
        assertEquals("story_event_l1", result.ir.events[0].id)
        assertEquals(NativeStoryAction.ENTER, result.ir.events[0].type)
        assertEquals("char_bim", result.ir.events[0].actorId)
        assertEquals("loc_room", result.ir.events[0].targetId)
        assertTrue(result.ir.events[6].causes.contains("story_event_l1"))
    }

    @Test
    fun `story compiler preserves stable diagnostic contract`() {
        val registry = listOf(
            NativeStoryEntity("char_bim", NativeEntityKind.CHARACTER, listOf("BIM")),
            NativeStoryEntity("loc_room", NativeEntityKind.LOCATION, listOf("ROOM")),
        )
        val result = NativeStoryCompiler.compile("GHOST ENTER ROOM\nBIM TELEPORT ROOM", registry)
        assertFalse(result.ok)
        assertEquals(listOf("STORY_UNKNOWN_ACTOR", "STORY_UNKNOWN_ACTION"), result.diagnostics.map { it.code })
        assertTrue(result.ir.events.isEmpty())
    }

    @Test
    fun `story compiler keeps comment line based event identity`() {
        val registry = listOf(
            NativeStoryEntity("char_bim", NativeEntityKind.CHARACTER, listOf("BIM")),
            NativeStoryEntity("prop_key", NativeEntityKind.PROP, listOf("KEY")),
        )
        val result = NativeStoryCompiler.compile("# setup\n\nBIM NOTICE KEY", registry)
        assertTrue(result.ok)
        assertEquals("story_event_l3", result.ir.events.single().id)
    }

    @Test
    fun `camera executor reproduces five sample visibility gate`() {
        val blocking = (NativeSceneBlockingCompiler.compile("chat", "ACTOR WAIT", reference) as NativeBlockingResult.Ready).blocking
        val result = NativeCameraExecutor.execute(blocking, "b".repeat(40))
        assertTrue(result is NativeCameraResult.Ready)
        val execution = (result as NativeCameraResult.Ready).execution
        assertEquals(3, execution.keyframes.size)
        assertEquals(5, execution.visibilitySamples.size)
        assertTrue(execution.visibilitySamples.all { it.visible })
        assertEquals("b".repeat(40), execution.sourceCommit)
    }

    @Test
    fun `camera executor rejects non exact source identity`() {
        val blocking = (NativeSceneBlockingCompiler.compile("chat", "ACTOR WAIT", reference) as NativeBlockingResult.Ready).blocking
        val result = NativeCameraExecutor.execute(blocking, "deadbeef")
        assertTrue(result is NativeCameraResult.Rejected)
        assertEquals("CAMERA_SOURCE_IDENTITY", (result as NativeCameraResult.Rejected).diagnostics.single().code)
    }
}
