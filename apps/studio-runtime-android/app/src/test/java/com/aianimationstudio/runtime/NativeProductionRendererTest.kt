package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NativeProductionRendererTest {
    private val sourceSha = "1234567890abcdef1234567890abcdef12345678"

    private fun reference() = PersistedReferenceAsset(
        displayName = "actor.png",
        mimeType = "image/png",
        sizeBytes = 4096,
        width = 1024,
        height = 1536,
        sha256 = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        originUri = "content://test/actor",
        localFile = File("build/test-reference.bin"),
    )

    private fun readySnapshot(): NativeProductionSnapshot {
        val snapshot = NativeProductionCoordinator.prepare(
            chatId = "renderer-test",
            prompt = "# output 1280x720 24fps 10sec\nACTOR WAIT",
            reference = reference(),
            sourceCommit = sourceSha,
        )
        assertEquals(NativeProductionStage.READY_FOR_RENDER, snapshot.stage)
        return snapshot
    }

    @Test
    fun `samples the same canonical pose and camera semantics as the production renderer`() {
        val snapshot = readySnapshot()
        val performance = requireNotNull(snapshot.performance)
        val camera = requireNotNull(snapshot.camera)

        val startPose = NativeProductionRendererMath.samplePose(performance, 0.0)
        val middlePose = NativeProductionRendererMath.samplePose(performance, 5.0)
        assertEquals(0.0, startPose.bodyPitchDegrees, 0.0001)
        assertEquals(1.875, middlePose.bodyPitchDegrees, 0.0001)
        assertEquals(5.5, middlePose.headYawDegrees, 0.0001)

        val startCamera = NativeProductionRendererMath.sampleCamera(camera, 0.0)
        val middleCamera = NativeProductionRendererMath.sampleCamera(camera, 5.0)
        assertTrue(startCamera.distanceToTarget > middleCamera.distanceToTarget)
        assertEquals(50.0, middleCamera.verticalFovDegrees, 0.0001)
    }

    @Test
    fun `frame geometry is source-bound and temporally non-identical`() {
        val snapshot = readySnapshot()
        val blocking = requireNotNull(snapshot.blocking)
        val performance = requireNotNull(snapshot.performance)
        val camera = requireNotNull(snapshot.camera)

        val startGeometry = NativeProductionRendererMath.frameGeometry(
            blocking,
            NativeProductionRendererMath.samplePose(performance, 0.0),
            NativeProductionRendererMath.sampleCamera(camera, 0.0),
        )
        val middleGeometry = NativeProductionRendererMath.frameGeometry(
            blocking,
            NativeProductionRendererMath.samplePose(performance, 5.0),
            NativeProductionRendererMath.sampleCamera(camera, 5.0),
        )

        assertTrue(startGeometry.sourceCoveragePixels > 0)
        assertTrue(middleGeometry.sourceCoveragePixels > 0)
        assertNotEquals(startGeometry.drawHeight, middleGeometry.drawHeight, 0.0001)
        assertNotEquals(startGeometry.rotationDegrees, middleGeometry.rotationDegrees, 0.0001)
    }

    @Test
    fun `render binding validation rejects source identity discontinuity`() {
        val snapshot = readySnapshot()
        assertTrue(NativeProductionRendererMath.validate(snapshot).isEmpty())

        val stale = snapshot.copy(sourceCommit = "0000000000000000000000000000000000000000")
        val diagnostics = NativeProductionRendererMath.validate(stale)
        assertTrue(diagnostics.any { it.code == "RENDER_SOURCE_CONTINUITY" })
    }
}
