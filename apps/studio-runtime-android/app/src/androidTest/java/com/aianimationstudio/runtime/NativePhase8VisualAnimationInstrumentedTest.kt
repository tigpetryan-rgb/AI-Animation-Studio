package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Environment
import android.view.Surface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
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
            model = "phase8-visual-animation-fixture-v2-video-only",
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
    fun canonicalPhase7SceneRendersAsViewableVideoOnlyPhase8Mp4() {
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
        val artifact = encodeVideoOnly(
            production = plan,
            reference = reference,
            outputFile = output,
        )
        assertTrue("Video-only Phase-8 encoder did not create a non-empty MP4.", output.isFile && output.length() > 0L)
        assertEquals("Video-only rendered frame count drifted.", 168, artifact.renderedFrameCount)
        assertEquals("Video-only H.264 sample count drifted.", 168, artifact.videoSampleCount)

        val videoSamples = countVideoSamples(output)
        assertEquals("Saved video-only MP4 H.264 sample count drifted.", 168, videoSamples)

        val previewFiles = extractPreviewFrames(output, outputDir)
        assertEquals("Visual evidence bundle must contain exactly three decoded previews.", 3, previewFiles.size)
        assertTrue("Every decoded preview must be a non-empty PNG.", previewFiles.all { it.isFile && it.length() > 0L })
        val previewHashes = previewFiles.map(::sha256)
        assertTrue("Rendered preview frames must show visual change across the animation.", previewHashes.toSet().size >= 2)

        val manifest = File(outputDir, "phase8-visual-manifest.txt")
        manifest.writeText(
            buildString {
                appendLine("scope=VIDEO_ONLY_ANIMATION_TEST")
                appendLine("audioTested=false")
                appendLine("sourceCommit=${BuildConfig.STUDIO_COMMIT_SHA}")
                appendLine("referenceSha256=$referenceSha")
                appendLine("scriptSha256=${plan.ir.scriptSha256}")
                appendLine("frameCount=${artifact.renderedFrameCount}")
                appendLine("videoSampleCount=${artifact.videoSampleCount}")
                appendLine("firstVideoPtsUs=${artifact.firstVideoPtsUs}")
                appendLine("lastVideoPtsUs=${artifact.lastVideoPtsUs}")
                appendLine("mp4=${output.name}")
                appendLine("mp4Sha256=${sha256(output)}")
                previewFiles.zip(previewHashes).forEach { (file, hash) ->
                    appendLine("preview=${file.name} sha256=$hash")
                }
            },
        )
    }

    private data class VideoOnlyArtifact(
        val renderedFrameCount: Int,
        val videoSampleCount: Int,
        val firstVideoPtsUs: Long,
        val lastVideoPtsUs: Long,
    )

    private fun encodeVideoOnly(
        production: NativePhase7ProductionPlan,
        reference: PersistedReferenceAsset,
        outputFile: File,
    ): VideoOnlyArtifact {
        val renderer = when (val preparation = NativePhase8FrameRenderer.prepare(production, reference)) {
            is NativePhase8RendererPreparation.Ready -> preparation.renderer
            is NativePhase8RendererPreparation.Rejected -> throw AssertionError(
                "Phase-8 renderer rejected before video-only encoding: ${diagnostics(preparation.diagnostics)}",
            )
        }

        renderer.use { preparedRenderer ->
            val frameRate = production.timeline.frameRate.toInt()
            require(frameRate > 0) { "Video-only visual test requires a positive integral frame rate." }
            assertEquals(production.timeline.frameRate, frameRate.toDouble(), 0.0)
            assertEquals(production.timeline.totalFrames, preparedRenderer.frameCount)

            if (outputFile.exists()) check(outputFile.delete()) { "Could not replace previous video-only MP4." }
            outputFile.parentFile?.mkdirs()

            val format = MediaFormat.createVideoFormat(
                NATIVE_MP4_VIDEO_MIME,
                preparedRenderer.width,
                preparedRenderer.height,
            ).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, 1_200_000)
                setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }

            val codec = MediaCodec.createEncoderByType(NATIVE_MP4_VIDEO_MIME)
            var inputSurface: Surface? = null
            var eglSurface: VideoOnlyEglCodecSurface? = null
            var bitmap: Bitmap? = null
            val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var muxerStarted = false
            var trackIndex = -1
            var codecStarted = false
            var videoSampleCount = 0
            var firstVideoPtsUs = -1L
            var lastVideoPtsUs = -1L
            var reachedEos = false

            fun drain(waitForEos: Boolean) {
                var idleCycles = 0
                while (true) {
                    val info = MediaCodec.BufferInfo()
                    val outputIndex = codec.dequeueOutputBuffer(info, if (waitForEos) 10_000L else 0L)
                    when {
                        outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                            if (!waitForEos) return
                            idleCycles += 1
                            check(idleCycles <= 1_000) { "Video-only H.264 encoder stalled before EOS." }
                        }
                        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            check(!muxerStarted) { "Video-only H.264 encoder changed format twice." }
                            trackIndex = muxer.addTrack(codec.outputFormat)
                            muxer.start()
                            muxerStarted = true
                            idleCycles = 0
                        }
                        outputIndex >= 0 -> {
                            idleCycles = 0
                            val codecConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            if (info.size > 0 && !codecConfig) {
                                check(muxerStarted && trackIndex >= 0) { "Video-only H.264 sample arrived before muxer start." }
                                val buffer = checkNotNull(codec.getOutputBuffer(outputIndex)) {
                                    "Video-only H.264 encoder returned a null output buffer."
                                }
                                buffer.position(info.offset)
                                buffer.limit(info.offset + info.size)
                                if (videoSampleCount == 0) firstVideoPtsUs = info.presentationTimeUs
                                lastVideoPtsUs = info.presentationTimeUs
                                muxer.writeSampleData(trackIndex, buffer, info)
                                videoSampleCount += 1
                            }
                            reachedEos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                            codec.releaseOutputBuffer(outputIndex, false)
                            if (reachedEos) return
                        }
                    }
                }
            }

            try {
                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                inputSurface = codec.createInputSurface()
                codec.start()
                codecStarted = true
                eglSurface = VideoOnlyEglCodecSurface(checkNotNull(inputSurface))
                bitmap = Bitmap.createBitmap(preparedRenderer.width, preparedRenderer.height, Bitmap.Config.ARGB_8888)

                for (frameIndex in 0 until preparedRenderer.frameCount) {
                    val evidence = preparedRenderer.renderFrame(checkNotNull(bitmap), frameIndex)
                    assertEquals(frameIndex, evidence.frameIndex)
                    check(evidence.visibleTriangles > 0) { "Frame $frameIndex has no visible 3D triangles." }
                    check(evidence.coveragePixels > 0) { "Frame $frameIndex has no rendered 3D coverage." }
                    checkNotNull(eglSurface).render(checkNotNull(bitmap), evidence.presentationTimeUs * 1_000L)
                    drain(waitForEos = false)
                }

                codec.signalEndOfInputStream()
                drain(waitForEos = true)
                check(reachedEos) { "Video-only H.264 encoder did not reach EOS." }
                check(muxerStarted) { "Video-only MP4 muxer never received H.264 output format." }
                check(videoSampleCount == preparedRenderer.frameCount) {
                    "Video-only H.264 sample count $videoSampleCount != rendered frame count ${preparedRenderer.frameCount}."
                }
                check(firstVideoPtsUs >= 0L && lastVideoPtsUs >= firstVideoPtsUs) {
                    "Video-only H.264 output timestamps are invalid."
                }

                muxer.stop()
                muxerStarted = false

                return VideoOnlyArtifact(
                    renderedFrameCount = preparedRenderer.frameCount,
                    videoSampleCount = videoSampleCount,
                    firstVideoPtsUs = firstVideoPtsUs,
                    lastVideoPtsUs = lastVideoPtsUs,
                )
            } finally {
                runCatching { eglSurface?.close() }
                bitmap?.let { if (!it.isRecycled) it.recycle() }
                runCatching { inputSurface?.release() }
                if (codecStarted) runCatching { codec.stop() }
                runCatching { codec.release() }
                if (muxerStarted) runCatching { muxer.stop() }
                runCatching { muxer.release() }
            }
        }
    }

    private fun requirePhase7Ready(result: NativePhase7OrchestrationResult): NativePhase7ProductionPlan = when (result) {
        is NativePhase7OrchestrationResult.Ready -> result.plan
        is NativePhase7OrchestrationResult.Rejected -> throw AssertionError(
            "Phase-7 orchestration rejected before visual encoding: ${diagnostics(result.diagnostics)}",
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

    private class VideoOnlyEglCodecSurface(
        private val codecInputSurface: Surface,
    ) : AutoCloseable {
        private val display: EGLDisplay
        private val context: EGLContext
        private val surface: EGLSurface
        private val program: Int
        private val textureId: Int
        private val positionHandle: Int
        private val texCoordHandle: Int
        private val samplerHandle: Int
        private var closed = false

        private val vertices = ByteBuffer.allocateDirect(4 * 4 * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .apply {
                put(
                    floatArrayOf(
                        -1f, -1f, 0f, 1f,
                        1f, -1f, 1f, 1f,
                        -1f, 1f, 0f, 0f,
                        1f, 1f, 1f, 0f,
                    ),
                )
                position(0)
            }

        init {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            check(display != EGL14.EGL_NO_DISPLAY) { "Unable to obtain EGL display for video-only visual test." }
            val version = IntArray(2)
            check(EGL14.eglInitialize(display, version, 0, version, 1)) { "Unable to initialize EGL for video-only visual test." }

            val attributes = intArrayOf(
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGLExt.EGL_RECORDABLE_ANDROID, EGL14.EGL_TRUE,
                EGL14.EGL_NONE,
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val count = IntArray(1)
            check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, configs.size, count, 0) && count[0] > 0) {
                "Unable to choose recordable EGL config for video-only H.264 test."
            }
            val config = checkNotNull(configs[0])

            context = EGL14.eglCreateContext(
                display,
                config,
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE),
                0,
            )
            check(context != EGL14.EGL_NO_CONTEXT) { "Unable to create GLES2 context for video-only H.264 test." }

            surface = EGL14.eglCreateWindowSurface(display, config, codecInputSurface, intArrayOf(EGL14.EGL_NONE), 0)
            check(surface != EGL14.EGL_NO_SURFACE) { "Unable to create EGL window surface for video-only H.264 test." }
            check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to activate video-only H.264 EGL surface." }

            program = createProgram(
                """
                attribute vec2 aPosition;
                attribute vec2 aTexCoord;
                varying vec2 vTexCoord;
                void main() {
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                    vTexCoord = aTexCoord;
                }
                """.trimIndent(),
                """
                precision mediump float;
                uniform sampler2D uTexture;
                varying vec2 vTexCoord;
                void main() {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                }
                """.trimIndent(),
            )
            positionHandle = GLES20.glGetAttribLocation(program, "aPosition")
            texCoordHandle = GLES20.glGetAttribLocation(program, "aTexCoord")
            samplerHandle = GLES20.glGetUniformLocation(program, "uTexture")
            check(positionHandle >= 0 && texCoordHandle >= 0 && samplerHandle >= 0) {
                "Unable to resolve video-only codec shader bindings."
            }

            val textures = IntArray(1)
            GLES20.glGenTextures(1, textures, 0)
            textureId = textures[0]
            check(textureId != 0) { "Unable to allocate video-only codec texture." }
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            checkGl("initialize video-only codec texture")
        }

        fun render(bitmap: Bitmap, presentationTimeNs: Long) {
            check(!closed) { "Video-only codec EGL surface is closed." }
            check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to activate video-only codec EGL surface." }

            GLES20.glViewport(0, 0, bitmap.width, bitmap.height)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)

            vertices.position(0)
            GLES20.glEnableVertexAttribArray(positionHandle)
            GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false, 4 * 4, vertices)
            vertices.position(2)
            GLES20.glEnableVertexAttribArray(texCoordHandle)
            GLES20.glVertexAttribPointer(texCoordHandle, 2, GLES20.GL_FLOAT, false, 4 * 4, vertices)
            GLES20.glUniform1i(samplerHandle, 0)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            checkGl("render video-only codec frame")

            check(EGLExt.eglPresentationTimeANDROID(display, surface, presentationTimeNs)) {
                "Unable to set video-only H.264 presentation timestamp."
            }
            check(EGL14.eglSwapBuffers(display, surface)) { "Unable to submit video-only frame to H.264 surface." }
        }

        override fun close() {
            if (closed) return
            closed = true
            runCatching {
                EGL14.eglMakeCurrent(display, surface, surface, context)
                GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
                GLES20.glDeleteProgram(program)
                EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                EGL14.eglDestroySurface(display, surface)
                EGL14.eglDestroyContext(display, context)
                EGL14.eglReleaseThread()
                EGL14.eglTerminate(display)
            }
        }

        private fun createProgram(vertexSource: String, fragmentSource: String): Int {
            val vertex = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource)
            val fragment = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource)
            val linked = GLES20.glCreateProgram()
            check(linked != 0) { "Unable to create video-only codec shader program." }
            GLES20.glAttachShader(linked, vertex)
            GLES20.glAttachShader(linked, fragment)
            GLES20.glLinkProgram(linked)
            val status = IntArray(1)
            GLES20.glGetProgramiv(linked, GLES20.GL_LINK_STATUS, status, 0)
            val log = GLES20.glGetProgramInfoLog(linked)
            GLES20.glDeleteShader(vertex)
            GLES20.glDeleteShader(fragment)
            check(status[0] == GLES20.GL_TRUE) { "Unable to link video-only codec shader program: $log" }
            return linked
        }

        private fun compileShader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            check(shader != 0) { "Unable to allocate video-only codec shader." }
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val status = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
            val log = GLES20.glGetShaderInfoLog(shader)
            if (status[0] != GLES20.GL_TRUE) {
                GLES20.glDeleteShader(shader)
                error("Unable to compile video-only codec shader: $log")
            }
            return shader
        }

        private fun checkGl(operation: String) {
            val error = GLES20.glGetError()
            check(error == GLES20.GL_NO_ERROR) { "OpenGL ES error 0x${error.toString(16)} while attempting to $operation." }
        }
    }
}
