package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.os.Environment
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePhase8VisualAnimationInstrumentedTest {
    private val prompt = "Դերասանը քայլում է դեպի տուփը, կանգնում է, նայում է տուփին, վերցնում է այն և արձագանքում։ Փոխիր միջավայրը, լույսը և շարժիր տեսախցիկը։ 14 վայրկյան 320x240 12 fps"

    private val backend = NativeSceneSemanticBackend { request ->
        NativeSceneSemanticDocument(
            detectedLanguage = NativeSceneLanguage.ARMENIAN,
            normalizedText = request.originalText.trim(),
            provider = "PHASE8_VISUAL_TEST_BACKEND",
            model = "phase8-visual-animation-fixture-v1",
            output = NativeSceneOutput(
                width = 320,
                height = 240,
                frameRate = 12.0,
                durationSeconds = 14.0,
            ),
            actions = listOf(
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.WALK_TO,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "քայլում է դեպի տուփը",
                ),
                NativeSceneActionDraft(NativeSceneConcept.WAIT, request.actorId, sourceExcerpt = "կանգնում է"),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.LOOK_AT,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "նայում է տուփին",
                ),
                NativeSceneActionDraft(
                    concept = NativeSceneConcept.PICK_UP,
                    actorId = request.actorId,
                    targetId = "prop_box",
                    sourceExcerpt = "վերցնում է այն",
                ),
                NativeSceneActionDraft(NativeSceneConcept.REACT, request.actorId, sourceExcerpt = "արձագանքում"),
                NativeSceneActionDraft(NativeSceneConcept.ENVIRONMENT_CHANGE, request.actorId, sourceExcerpt = "փոխիր միջավայրը"),
                NativeSceneActionDraft(NativeSceneConcept.LIGHTING_CHANGE, request.actorId, sourceExcerpt = "լույսը"),
                NativeSceneActionDraft(NativeSceneConcept.CAMERA_MOVE, request.actorId, sourceExcerpt = "շարժիր տեսախցիկը"),
            ),
        )
    }

    @Test
    fun canonicalPhase7SceneRendersAsViewablePhase8Mp4() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val outputDir = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES))
        outputDir.listFiles()?.filter { it.name.startsWith("phase8-visual-") }?.forEach(File::delete)

        val referenceFile = File(context.cacheDir, "phase8-visual-reference.png")
        createReferenceImage(referenceFile)
        val referenceSha = sha256(referenceFile)
        val reference = PersistedReferenceAsset(
            displayName = "phase8-visual-reference.png",
            mimeType = "image/png",
            sizeBytes = referenceFile.length(),
            width = 512,
            height = 512,
            sha256 = referenceSha,
            originUri = "engineering://phase8/visual-reference",
            localFile = referenceFile,
        )

        val orchestration = NativeProductionOrchestrationPhase7Engine.execute(
            chatId = "phase8-visual-animation",
            prompt = prompt,
            reference = reference,
            sourceCommit = BuildConfig.STUDIO_COMMIT_SHA,
            backend = backend,
        )
        val plan = requirePhase7Ready(orchestration)
        assertTrue("Phase-7 production acceptance must be DONE before visual encoding.", plan.acceptance.done)
        assertEquals("Visual fixture must bind exactly 168 frames.", 168, plan.timeline.totalFrames)

        val output = File(outputDir, "phase8-visual-${BuildConfig.STUDIO_COMMIT_SHA.take(12)}.mp4")
        val encoded = NativePhase8MediaCodecExporter.encode(
            production = plan,
            reference = reference,
            outputFile = output,
        )
        val artifact = requireCodecReady(encoded)
        assertTrue("Phase-8 encoder returned Ready without a non-empty MP4 file.", output.isFile && output.length() > 0L)
        assertEquals("Phase-8 artifact frame count drifted.", 168, artifact.frameCount)
        assertEquals("Phase-8 H.264 sample count drifted.", 168, artifact.videoSampleCount)
        assertEquals(NativePhase8AudioMode.SILENCE_PLACEHOLDER_OBJECTIVE_2, artifact.audioMode)

        val videoSamples = countVideoSamples(output)
        assertEquals("Saved MP4 H.264 sample count drifted.", 168, videoSamples)

        val previewFiles = extractPreviewFrames(output, outputDir)
        assertEquals("Visual evidence bundle must contain exactly three decoded previews.", 3, previewFiles.size)
        assertTrue("Every decoded preview must be a non-empty PNG.", previewFiles.all { it.isFile && it.length() > 0L })
        val previewHashes = previewFiles.map(::sha256)
        assertTrue("Rendered preview frames must show visual change across the animation.", previewHashes.toSet().size >= 2)

        val manifest = File(outputDir, "phase8-visual-manifest.txt")
        manifest.writeText(
            buildString {
                appendLine("sourceCommit=${BuildConfig.STUDIO_COMMIT_SHA}")
                appendLine("referenceSha256=$referenceSha")
                appendLine("scriptSha256=${plan.ir.scriptSha256}")
                appendLine("frameCount=${artifact.frameCount}")
                appendLine("videoSampleCount=${artifact.videoSampleCount}")
                appendLine("audioMode=${artifact.audioMode}")
                appendLine("mp4=${output.name}")
                appendLine("mp4Sha256=${sha256(output)}")
                previewFiles.zip(previewHashes).forEach { (file, hash) ->
                    appendLine("preview=${file.name} sha256=$hash")
                }
            },
        )
    }

    private fun requirePhase7Ready(result: NativePhase7OrchestrationResult): NativePhase7ProductionPlan = when (result) {
        is NativePhase7OrchestrationResult.Ready -> result.plan
        is NativePhase7OrchestrationResult.Rejected -> throw AssertionError(
            "Phase-7 orchestration rejected before visual encoding: ${diagnostics(result.diagnostics)}",
        )
    }

    private fun requireCodecReady(result: NativePhase8CodecEncodingResult): NativePhase8EncodedMp4Artifact = when (result) {
        is NativePhase8CodecEncodingResult.Ready -> result.artifact
        is NativePhase8CodecEncodingResult.Rejected -> throw AssertionError(
            "Phase-8 codec rejected before MP4 artifact creation: ${diagnostics(result.diagnostics)}",
        )
    }

    private fun diagnostics(values: List<NativeDiagnostic>): String = values.joinToString(" | ") { diagnostic ->
        "${diagnostic.code}: ${diagnostic.message}"
    }.ifBlank { "no diagnostics returned" }

    private fun createReferenceImage(file: File) {
        val bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(32, 38, 48))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.rgb(224, 180, 145)
        canvas.drawCircle(256f, 155f, 92f, paint)
        paint.color = Color.rgb(52, 110, 190)
        canvas.drawRoundRect(150f, 245f, 362f, 470f, 42f, 42f, paint)
        paint.color = Color.rgb(28, 30, 36)
        canvas.drawRect(190f, 120f, 322f, 150f, paint)
        paint.color = Color.WHITE
        canvas.drawCircle(222f, 165f, 10f, paint)
        canvas.drawCircle(290f, 165f, 10f, paint)
        file.outputStream().use { stream ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
        bitmap.recycle()
    }

    private fun countVideoSamples(file: File): Int {
        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(file.absolutePath)
            val videoTrack = (0 until extractor.trackCount).first { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME) == NATIVE_MP4_VIDEO_MIME
            }
            extractor.selectTrack(videoTrack)
            var count = 0
            while (extractor.sampleTime >= 0L) {
                count += 1
                if (!extractor.advance()) break
            }
            count
        } finally {
            extractor.release()
        }
    }

    private fun extractPreviewFrames(file: File, outputDir: File): List<File> {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.absolutePath)
            listOf(0L, 7_000_000L, 13_000_000L).mapIndexed { index, timeUs ->
                val frame = requireNotNull(retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)) {
                    "Unable to decode preview frame at ${timeUs}us."
                }
                val target = File(outputDir, "phase8-visual-preview-${index + 1}.png")
                target.outputStream().use { stream ->
                    check(frame.compress(Bitmap.CompressFormat.PNG, 100, stream))
                }
                frame.recycle()
                target
            }
        } finally {
            retriever.release()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
