package com.aianimationstudio.runtime

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaFormat
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.opengl.GLUtils
import android.view.Surface
import androidx.media3.common.util.UnstableApi
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min
import kotlin.math.roundToLong

internal object NativeEncoderTiming {
    fun videoPresentationTimeUs(plan: NativeCodecPlan, frameIndex: Int): Long {
        require(frameIndex in 0 until plan.frameCount) { "Video frame index is outside the codec plan." }
        return (frameIndex.toDouble() * 1_000_000.0 / plan.frameRate).roundToLong()
    }

    fun videoTimeSeconds(plan: NativeCodecPlan, frameIndex: Int): Double =
        videoPresentationTimeUs(plan, frameIndex) / 1_000_000.0

    fun audioPresentationTimeUs(pcmFrameIndex: Long, sampleRate: Int): Long {
        require(pcmFrameIndex >= 0L) { "PCM frame index must be non-negative." }
        require(sampleRate > 0) { "Audio sample rate must be positive." }
        return pcmFrameIndex * 1_000_000L / sampleRate
    }

    fun audioFramesForNextInput(
        totalFrames: Long,
        queuedFrames: Long,
        preferredChunkFrames: Int,
        inputCapacityBytes: Int,
        channels: Int,
    ): Int {
        require(totalFrames >= 0L && queuedFrames in 0L..totalFrames) { "Audio frame counters are invalid." }
        require(preferredChunkFrames > 0 && inputCapacityBytes >= 0 && channels > 0) { "Audio input limits are invalid." }
        if (queuedFrames == totalFrames) return 0
        val bytesPerFrame = channels * 2
        val capacityFrames = inputCapacityBytes / bytesPerFrame
        require(capacityFrames > 0) { "Opus encoder input buffer cannot hold one PCM16 frame." }
        return min(
            min(totalFrames - queuedFrames, preferredChunkFrames.toLong()),
            capacityFrames.toLong(),
        ).toInt()
    }
}

internal data class NativeEncodedMp4Artifact(
    val outputFile: File,
    val sourceCommit: String,
    val referenceSha256: String,
    val frameCount: Int,
    val audioPcmFrames: Long,
    val videoSampleCount: Int,
    val audioSampleCount: Int,
    val renderArtifact: NativeProductionRenderArtifact,
)

internal sealed interface NativeCodecEncodingResult {
    data class Ready(val artifact: NativeEncodedMp4Artifact) : NativeCodecEncodingResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeCodecEncodingResult
}

private data class NativeDrainState(
    var outputFormat: MediaFormat? = null,
    var ended: Boolean = false,
    var interleaverEnded: Boolean = false,
)

private data class NativeDrainResult(
    val packet: NativeEncodedSamplePacket? = null,
    val progressed: Boolean = false,
)

@OptIn(UnstableApi::class)
internal object NativeMediaCodecExporter {
    private const val OUTPUT_DEQUEUE_TIMEOUT_US = 10_000L
    private const val MAX_IDLE_DRAIN_CYCLES = 1_000
    private const val MAX_PRE_MUX_PACKETS = 4

    fun encode(snapshot: NativeProductionSnapshot, outputFile: File): NativeCodecEncodingResult {
        val preparation = NativeAndroidFrameRenderer.prepare(snapshot)
        val renderer = when (preparation) {
            is NativeRendererPreparation.Ready -> preparation.renderer
            is NativeRendererPreparation.Rejected -> return NativeCodecEncodingResult.Rejected(preparation.diagnostics)
        }

        renderer.use { preparedRenderer ->
            val temporal = preparedRenderer.verifyTemporalMotion()
            val renderArtifact = when (temporal) {
                is NativeTemporalRenderVerification.Ready -> temporal.artifact
                is NativeTemporalRenderVerification.Rejected -> return NativeCodecEncodingResult.Rejected(temporal.diagnostics)
            }

            val capability = NativeCodecCapabilities.probe(snapshot)
            val selection = when (capability) {
                is NativeCodecCapabilityResult.Ready -> capability.selection
                is NativeCodecCapabilityResult.Rejected -> return NativeCodecEncodingResult.Rejected(capability.diagnostics)
            }

            outputFile.parentFile?.mkdirs()
            if (outputFile.exists() && !outputFile.delete()) {
                return NativeCodecEncodingResult.Rejected(
                    listOf(NativeDiagnostic("ENCODE_OUTPUT_REPLACE", "Native encoder could not replace the previous incomplete MP4 output.")),
                )
            }

            return runCatching {
                encodeReady(snapshot, preparedRenderer, renderArtifact, selection, outputFile)
            }.fold(
                onSuccess = { NativeCodecEncodingResult.Ready(it) },
                onFailure = { failure ->
                    outputFile.delete()
                    NativeCodecEncodingResult.Rejected(
                        listOf(
                            NativeDiagnostic(
                                "ENCODE_FAILED",
                                failure.message ?: "Native H.264 + Opus encoder session failed.",
                            ),
                        ),
                    )
                },
            )
        }
    }

    private fun encodeReady(
        snapshot: NativeProductionSnapshot,
        renderer: NativeAndroidFrameRenderer,
        renderArtifact: NativeProductionRenderArtifact,
        selection: NativeCodecSelection,
        outputFile: File,
    ): NativeEncodedMp4Artifact {
        val plan = selection.plan
        val videoCodec = MediaCodec.createByCodecName(selection.videoEncoderName)
        val audioCodec = MediaCodec.createByCodecName(selection.audioEncoderName)
        var codecSurface: NativeEglCodecSurface? = null
        var muxer: NativeMp4Muxer? = null
        var interleaver: NativeSampleInterleaver? = null
        var videoStarted = false
        var audioStarted = false
        var videoInputSurface: Surface? = null
        var renderBitmap: Bitmap? = null

        val videoDrain = NativeDrainState()
        val audioDrain = NativeDrainState()
        val preMuxPackets = ArrayDeque<NativeEncodedSamplePacket>()
        var videoFrameIndex = 0
        var audioFramesQueued = 0L
        var videoInputEnded = false
        var audioInputEnded = false
        var videoSampleCount = 0
        var audioSampleCount = 0
        var idleCycles = 0

        fun writePacket(packet: NativeEncodedSamplePacket) {
            val targetMuxer = checkNotNull(muxer) { "Native MP4 muxer is not initialized." }
            val info = MediaCodec.BufferInfo().apply {
                set(0, packet.data.size, packet.presentationTimeUs, packet.flags)
            }
            val bytes = ByteBuffer.wrap(packet.data)
            when (packet.track) {
                NativeEncodedTrack.VIDEO -> {
                    targetMuxer.writeVideoSample(bytes, info)
                    videoSampleCount += 1
                }
                NativeEncodedTrack.AUDIO -> {
                    targetMuxer.writeAudioSample(bytes, info)
                    audioSampleCount += 1
                }
            }
        }

        fun acceptPacket(packet: NativeEncodedSamplePacket) {
            val sink = interleaver
            if (sink == null) {
                check(preMuxPackets.size < MAX_PRE_MUX_PACKETS) {
                    "Encoder emitted too many media packets before both output formats were available."
                }
                preMuxPackets.addLast(packet)
            } else {
                sink.offer(packet)
            }
        }

        fun publishTrackEnd(track: NativeEncodedTrack, drain: NativeDrainState) {
            val sink = interleaver ?: return
            if (drain.ended && !drain.interleaverEnded) {
                sink.end(track)
                drain.interleaverEnded = true
            }
        }

        fun maybeStartMuxer() {
            if (muxer != null) return
            val videoFormat = videoDrain.outputFormat ?: return
            val audioFormat = audioDrain.outputFormat ?: return
            val created = NativeMp4Muxer(outputFile)
            created.addVideoTrack(videoFormat)
            created.addAudioTrack(audioFormat)
            check(created.hasBothProductionTracks()) { "Native MP4 muxer did not register both production tracks." }
            muxer = created
            interleaver = NativeSampleInterleaver(::writePacket)
            while (preMuxPackets.isNotEmpty()) {
                interleaver!!.offer(preMuxPackets.removeFirst())
            }
            publishTrackEnd(NativeEncodedTrack.VIDEO, videoDrain)
            publishTrackEnd(NativeEncodedTrack.AUDIO, audioDrain)
        }

        fun drainOne(codec: MediaCodec, track: NativeEncodedTrack, state: NativeDrainState): NativeDrainResult {
            if (state.ended) return NativeDrainResult()
            val info = MediaCodec.BufferInfo()
            val outputIndex = codec.dequeueOutputBuffer(info, OUTPUT_DEQUEUE_TIMEOUT_US)
            if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) return NativeDrainResult()
            if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                check(state.outputFormat == null) { "${track.name.lowercase()} encoder changed output format more than once." }
                state.outputFormat = codec.outputFormat
                return NativeDrainResult(progressed = true)
            }
            if (outputIndex < 0) return NativeDrainResult(progressed = true)

            var packet: NativeEncodedSamplePacket? = null
            try {
                val codecConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                if (info.size > 0 && !codecConfig) {
                    check(state.outputFormat != null) {
                        "${track.name.lowercase()} encoder produced media before publishing its output format."
                    }
                    val buffer = checkNotNull(codec.getOutputBuffer(outputIndex)) {
                        "${track.name.lowercase()} encoder returned a null output buffer."
                    }
                    check(info.offset >= 0 && info.size >= 0 && info.offset + info.size <= buffer.capacity()) {
                        "${track.name.lowercase()} encoded output range is invalid."
                    }
                    val data = ByteArray(info.size)
                    buffer.duplicate().apply {
                        position(info.offset)
                        limit(info.offset + info.size)
                    }.get(data)
                    packet = NativeEncodedSamplePacket(
                        track = track,
                        presentationTimeUs = info.presentationTimeUs,
                        flags = info.flags,
                        data = data,
                    )
                }
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    state.ended = true
                }
            } finally {
                codec.releaseOutputBuffer(outputIndex, false)
            }
            return NativeDrainResult(packet = packet, progressed = true)
        }

        fun feedAudioInput(): Boolean {
            if (audioInputEnded) return false
            val inputIndex = audioCodec.dequeueInputBuffer(0)
            if (inputIndex < 0) return false
            if (audioFramesQueued >= plan.totalAudioFrames) {
                val ptsUs = NativeEncoderTiming.audioPresentationTimeUs(plan.totalAudioFrames, plan.audioSampleRate)
                audioCodec.queueInputBuffer(inputIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                audioInputEnded = true
                return true
            }

            val input = checkNotNull(audioCodec.getInputBuffer(inputIndex)) { "Opus encoder returned a null input buffer." }
            input.clear()
            val frames = NativeEncoderTiming.audioFramesForNextInput(
                totalFrames = plan.totalAudioFrames,
                queuedFrames = audioFramesQueued,
                preferredChunkFrames = plan.audioChunkFrames,
                inputCapacityBytes = input.capacity(),
                channels = plan.audioChannels,
            )
            val ptsUs = NativeEncoderTiming.audioPresentationTimeUs(audioFramesQueued, plan.audioSampleRate)
            repeat(frames * plan.audioChannels) { input.putShort(0) }
            val size = frames * plan.audioChannels * 2
            audioCodec.queueInputBuffer(inputIndex, 0, size, ptsUs, 0)
            audioFramesQueued += frames
            return true
        }

        fun feedVideoFrame(): Boolean {
            if (videoInputEnded) return false
            if (videoFrameIndex >= plan.frameCount) {
                videoCodec.signalEndOfInputStream()
                videoInputEnded = true
                return true
            }
            val bitmap = checkNotNull(renderBitmap)
            val ptsUs = NativeEncoderTiming.videoPresentationTimeUs(plan, videoFrameIndex)
            val timeSeconds = NativeEncoderTiming.videoTimeSeconds(plan, videoFrameIndex)
                .coerceIn(0.0, renderer.durationSeconds)
            renderer.renderFrame(bitmap, timeSeconds)
            checkNotNull(codecSurface).render(bitmap, ptsUs * 1_000L)
            videoFrameIndex += 1
            return true
        }

        try {
            videoCodec.configure(selection.videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            videoInputSurface = videoCodec.createInputSurface()
            videoCodec.start()
            videoStarted = true
            codecSurface = NativeEglCodecSurface(checkNotNull(videoInputSurface))
            renderBitmap = Bitmap.createBitmap(plan.width, plan.height, Bitmap.Config.ARGB_8888)

            audioCodec.configure(selection.audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            audioCodec.start()
            audioStarted = true

            while (true) {
                var progressed = false
                val formatsReady = videoDrain.outputFormat != null && audioDrain.outputFormat != null

                if (!formatsReady) {
                    if (videoFrameIndex == 0) progressed = feedVideoFrame() || progressed
                    if (audioFramesQueued == 0L) progressed = feedAudioInput() || progressed
                } else {
                    progressed = feedVideoFrame() || progressed
                    progressed = feedAudioInput() || progressed
                }

                val videoResult = drainOne(videoCodec, NativeEncodedTrack.VIDEO, videoDrain)
                progressed = videoResult.progressed || progressed
                videoResult.packet?.let(::acceptPacket)

                val audioResult = drainOne(audioCodec, NativeEncodedTrack.AUDIO, audioDrain)
                progressed = audioResult.progressed || progressed
                audioResult.packet?.let(::acceptPacket)

                maybeStartMuxer()
                publishTrackEnd(NativeEncodedTrack.VIDEO, videoDrain)
                publishTrackEnd(NativeEncodedTrack.AUDIO, audioDrain)

                val sink = interleaver
                if (videoDrain.ended && audioDrain.ended && sink != null && sink.isComplete()) break

                if (progressed) {
                    idleCycles = 0
                } else {
                    idleCycles += 1
                    check(idleCycles <= MAX_IDLE_DRAIN_CYCLES) {
                        "Native encoder stalled while waiting for H.264/Opus output."
                    }
                }
            }

            check(videoInputEnded && audioInputEnded) { "Native encoder reached output EOS before both input streams were finalized." }
            check(videoSampleCount > 0) { "Native H.264 encoder produced no media samples." }
            check(audioSampleCount > 0) { "Native Opus encoder produced no media samples." }
            checkNotNull(muxer).close()
            muxer = null

            return NativeEncodedMp4Artifact(
                outputFile = outputFile,
                sourceCommit = snapshot.sourceCommit,
                referenceSha256 = checkNotNull(snapshot.referenceSha256),
                frameCount = plan.frameCount,
                audioPcmFrames = plan.totalAudioFrames,
                videoSampleCount = videoSampleCount,
                audioSampleCount = audioSampleCount,
                renderArtifact = renderArtifact,
            )
        } finally {
            runCatching { muxer?.close() }
            runCatching { codecSurface?.close() }
            renderBitmap?.let { if (!it.isRecycled) it.recycle() }
            runCatching { videoInputSurface?.release() }
            if (videoStarted) runCatching { videoCodec.stop() }
            if (audioStarted) runCatching { audioCodec.stop() }
            runCatching { videoCodec.release() }
            runCatching { audioCodec.release() }
        }
    }
}

private class NativeEglCodecSurface(
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
        check(display != EGL14.EGL_NO_DISPLAY) { "Unable to obtain EGL display for codec surface." }
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "Unable to initialize EGL for codec surface." }

        val attributes = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, configs.size, count, 0) && count[0] > 0) {
            "Unable to choose EGL config for H.264 codec surface."
        }
        val config = checkNotNull(configs[0])
        val contextAttributes = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, contextAttributes, 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "Unable to create OpenGL ES context for codec surface." }

        surface = EGL14.eglCreateWindowSurface(display, config, codecInputSurface, intArrayOf(EGL14.EGL_NONE), 0)
        check(surface != EGL14.EGL_NO_SURFACE) { "Unable to create EGL window surface for H.264 codec input." }
        check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to make H.264 codec EGL surface current." }

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
            "Unable to resolve OpenGL ES codec-surface shader bindings."
        }

        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        check(textureId != 0) { "Unable to allocate OpenGL ES texture for codec surface." }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        checkGl("initialize codec-surface texture")
    }

    fun render(bitmap: Bitmap, presentationTimeNs: Long) {
        check(!closed) { "Codec EGL surface is closed." }
        require(presentationTimeNs >= 0L) { "Codec frame presentation time must be non-negative." }
        check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to activate codec EGL surface." }

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
        checkGl("render codec-surface frame")

        check(EGLExt.eglPresentationTimeANDROID(display, surface, presentationTimeNs)) {
            "Unable to set H.264 frame presentation timestamp on EGL surface."
        }
        check(EGL14.eglSwapBuffers(display, surface)) { "Unable to submit rendered frame to H.264 codec surface." }
    }

    override fun close() {
        if (closed) return
        closed = true
        runCatching {
            if (display != EGL14.EGL_NO_DISPLAY) {
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
    }

    private fun createProgram(vertexSource: String, fragmentSource: String): Int {
        val vertex = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource)
        val fragment = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource)
        val linked = GLES20.glCreateProgram()
        check(linked != 0) { "Unable to create OpenGL ES codec-surface program." }
        GLES20.glAttachShader(linked, vertex)
        GLES20.glAttachShader(linked, fragment)
        GLES20.glLinkProgram(linked)
        val status = IntArray(1)
        GLES20.glGetProgramiv(linked, GLES20.GL_LINK_STATUS, status, 0)
        val log = GLES20.glGetProgramInfoLog(linked)
        GLES20.glDeleteShader(vertex)
        GLES20.glDeleteShader(fragment)
        check(status[0] == GLES20.GL_TRUE) { "Unable to link codec-surface shader program: $log" }
        return linked
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        check(shader != 0) { "Unable to allocate OpenGL ES codec-surface shader." }
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        val log = GLES20.glGetShaderInfoLog(shader)
        if (status[0] != GLES20.GL_TRUE) {
            GLES20.glDeleteShader(shader)
            error("Unable to compile codec-surface shader: $log")
        }
        return shader
    }

    private fun checkGl(operation: String) {
        val error = GLES20.glGetError()
        check(error == GLES20.GL_NO_ERROR) { "OpenGL ES error 0x${error.toString(16)} while attempting to $operation." }
    }
}
