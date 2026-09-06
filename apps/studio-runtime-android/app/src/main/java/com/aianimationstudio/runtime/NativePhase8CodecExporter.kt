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

internal enum class NativePhase8AudioMode {
    SILENCE_PLACEHOLDER_OBJECTIVE_2,
}

internal data class NativePhase8EncodedMp4Artifact(
    val outputFile: File,
    val sourceCommit: String,
    val referenceSha256: String,
    val scriptSha256: String,
    val frameCount: Int,
    val firstVideoPresentationTimeUs: Long,
    val lastVideoPresentationTimeUs: Long,
    val audioPcmFrames: Long,
    val videoSampleCount: Int,
    val audioSampleCount: Int,
    val audioMode: NativePhase8AudioMode,
)

internal sealed interface NativePhase8CodecEncodingResult {
    data class Ready(val artifact: NativePhase8EncodedMp4Artifact) : NativePhase8CodecEncodingResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativePhase8CodecEncodingResult
}

private data class NativePhase8CodecDrainState(
    var outputFormat: MediaFormat? = null,
    var ended: Boolean = false,
    var interleaverEnded: Boolean = false,
)

private data class NativePhase8CodecDrainResult(
    val packet: NativeEncodedSamplePacket? = null,
    val progressed: Boolean = false,
)

/**
 * Objective #2 production path: accepted Phase-7 frame DAG -> indexed Phase-8 3D renderer ->
 * Android H.264 surface encoder -> existing bounded sample interleaver and MP4 muxer.
 *
 * Audio is intentionally an explicit silence placeholder in this objective. The artifact carries
 * that state so this checkpoint cannot be mistaken for the Phase-8 final A/V DONE gate.
 */
@UnstableApi
internal object NativePhase8MediaCodecExporter {
    private const val OUTPUT_DEQUEUE_TIMEOUT_US = 10_000L
    private const val MAX_IDLE_DRAIN_CYCLES = 1_000
    private const val MAX_PRE_MUX_PACKETS = 4

    fun encode(
        production: NativePhase7ProductionPlan,
        reference: PersistedReferenceAsset,
        outputFile: File,
    ): NativePhase8CodecEncodingResult {
        val bound = when (val result = NativePhase8RenderBinder.bind(production)) {
            is NativePhase8RenderBindingResult.Ready -> result.plan
            is NativePhase8RenderBindingResult.Rejected -> return NativePhase8CodecEncodingResult.Rejected(result.diagnostics)
        }
        val contract = when (val result = NativePhase8CodecContract.build(bound)) {
            is NativePhase8CodecContractResult.Ready -> result.input
            is NativePhase8CodecContractResult.Rejected -> return NativePhase8CodecEncodingResult.Rejected(result.diagnostics)
        }
        val preparation = NativePhase8FrameRenderer.prepare(production, reference)
        val renderer = when (preparation) {
            is NativePhase8RendererPreparation.Ready -> preparation.renderer
            is NativePhase8RendererPreparation.Rejected -> return NativePhase8CodecEncodingResult.Rejected(preparation.diagnostics)
        }

        renderer.use { preparedRenderer ->
            if (
                preparedRenderer.width != contract.codecPlan.width ||
                preparedRenderer.height != contract.codecPlan.height ||
                preparedRenderer.frameCount != contract.codecPlan.frameCount
            ) {
                return NativePhase8CodecEncodingResult.Rejected(
                    listOf(NativeDiagnostic("PHASE8_CODEC_RENDER_SPEC", "Phase-8 renderer dimensions/frame count do not match the exact codec contract.")),
                )
            }

            val selection = when (val capability = NativeCodecCapabilities.probe(contract.codecPlan)) {
                is NativeCodecCapabilityResult.Ready -> capability.selection
                is NativeCodecCapabilityResult.Rejected -> return NativePhase8CodecEncodingResult.Rejected(capability.diagnostics)
            }

            outputFile.parentFile?.mkdirs()
            if (outputFile.exists() && !outputFile.delete()) {
                return NativePhase8CodecEncodingResult.Rejected(
                    listOf(NativeDiagnostic("PHASE8_CODEC_OUTPUT_REPLACE", "Phase-8 encoder could not replace the previous incomplete MP4 output.")),
                )
            }

            return runCatching {
                encodeReady(contract, preparedRenderer, selection, outputFile)
            }.fold(
                onSuccess = { NativePhase8CodecEncodingResult.Ready(it) },
                onFailure = { failure ->
                    outputFile.delete()
                    NativePhase8CodecEncodingResult.Rejected(
                        listOf(
                            NativeDiagnostic(
                                "PHASE8_CODEC_FAILED",
                                failure.message ?: "Phase-8 native H.264/Opus codec session failed.",
                            ),
                        ),
                    )
                },
            )
        }
    }

    private fun encodeReady(
        contract: NativePhase8CodecInputPlan,
        renderer: NativePhase8FrameRenderer,
        selection: NativeCodecSelection,
        outputFile: File,
    ): NativePhase8EncodedMp4Artifact {
        val codecPlan = selection.plan
        check(contract.frames.size == codecPlan.frameCount) { "Phase-8 codec frame contract changed before encoder start." }

        val videoCodec = MediaCodec.createByCodecName(selection.videoEncoderName)
        val audioCodec = MediaCodec.createByCodecName(selection.audioEncoderName)
        var codecSurface: NativePhase8EglCodecSurface? = null
        var muxer: NativeMp4Muxer? = null
        var interleaver: NativeSampleInterleaver? = null
        var videoStarted = false
        var audioStarted = false
        var videoInputSurface: Surface? = null
        var renderBitmap: Bitmap? = null

        val videoDrain = NativePhase8CodecDrainState()
        val audioDrain = NativePhase8CodecDrainState()
        val preMuxPackets = ArrayDeque<NativeEncodedSamplePacket>()
        var submittedVideoFrames = 0
        var verifiedVideoSamples = 0
        var audioFramesQueued = 0L
        var videoInputEnded = false
        var audioInputEnded = false
        var videoSampleCount = 0
        var audioSampleCount = 0
        var idleCycles = 0
        var firstVideoPtsUs = -1L
        var lastVideoPtsUs = -1L

        fun writePacket(packet: NativeEncodedSamplePacket) {
            val targetMuxer = checkNotNull(muxer) { "Phase-8 MP4 muxer is not initialized." }
            val info = MediaCodec.BufferInfo().apply {
                set(0, packet.data.size, packet.presentationTimeUs, packet.flags)
            }
            val bytes = ByteBuffer.wrap(packet.data)
            when (packet.track) {
                NativeEncodedTrack.VIDEO -> {
                    val frame = contract.frames.getOrNull(verifiedVideoSamples)
                        ?: error("H.264 encoder produced more video samples than the accepted Phase-8 frame count.")
                    check(packet.presentationTimeUs == frame.presentationTimeUs) {
                        "H.264 output PTS drift at frame ${frame.frameIndex}: ${packet.presentationTimeUs} != ${frame.presentationTimeUs}."
                    }
                    if (verifiedVideoSamples == 0) firstVideoPtsUs = packet.presentationTimeUs
                    lastVideoPtsUs = packet.presentationTimeUs
                    targetMuxer.writeVideoSample(bytes, info)
                    verifiedVideoSamples += 1
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
                    "Phase-8 encoder emitted too many packets before both output formats were available."
                }
                preMuxPackets.addLast(packet)
            } else {
                sink.offer(packet)
            }
        }

        fun publishTrackEnd(track: NativeEncodedTrack, drain: NativePhase8CodecDrainState) {
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
            check(created.hasBothProductionTracks()) { "Phase-8 MP4 muxer did not register both production tracks." }
            muxer = created
            val sink = NativeSampleInterleaver(::writePacket)
            interleaver = sink
            while (preMuxPackets.isNotEmpty()) sink.offer(preMuxPackets.removeFirst())
            publishTrackEnd(NativeEncodedTrack.VIDEO, videoDrain)
            publishTrackEnd(NativeEncodedTrack.AUDIO, audioDrain)
        }

        fun canAdvance(track: NativeEncodedTrack): Boolean = interleaver?.canAccept(track) ?: true

        fun drainOne(
            codec: MediaCodec,
            track: NativeEncodedTrack,
            state: NativePhase8CodecDrainState,
        ): NativePhase8CodecDrainResult {
            if (state.ended) return NativePhase8CodecDrainResult()
            val info = MediaCodec.BufferInfo()
            val outputIndex = codec.dequeueOutputBuffer(info, OUTPUT_DEQUEUE_TIMEOUT_US)
            if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) return NativePhase8CodecDrainResult()
            if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                check(state.outputFormat == null) { "${track.name.lowercase()} encoder changed output format more than once." }
                state.outputFormat = codec.outputFormat
                return NativePhase8CodecDrainResult(progressed = true)
            }
            if (outputIndex < 0) return NativePhase8CodecDrainResult(progressed = true)

            var packet: NativeEncodedSamplePacket? = null
            try {
                val codecConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                if (info.size > 0 && !codecConfig) {
                    check(state.outputFormat != null) { "${track.name.lowercase()} encoder produced media before its output format." }
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
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) state.ended = true
            } finally {
                codec.releaseOutputBuffer(outputIndex, false)
            }
            return NativePhase8CodecDrainResult(packet = packet, progressed = true)
        }

        fun feedAudioInput(): Boolean {
            if (audioInputEnded) return false
            val inputIndex = audioCodec.dequeueInputBuffer(0)
            if (inputIndex < 0) return false
            if (audioFramesQueued >= codecPlan.totalAudioFrames) {
                val ptsUs = NativeEncoderTiming.audioPresentationTimeUs(codecPlan.totalAudioFrames, codecPlan.audioSampleRate)
                audioCodec.queueInputBuffer(inputIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                audioInputEnded = true
                return true
            }

            val input = checkNotNull(audioCodec.getInputBuffer(inputIndex)) { "Opus encoder returned a null input buffer." }
            input.clear()
            val frames = NativeEncoderTiming.audioFramesForNextInput(
                totalFrames = codecPlan.totalAudioFrames,
                queuedFrames = audioFramesQueued,
                preferredChunkFrames = codecPlan.audioChunkFrames,
                inputCapacityBytes = input.capacity(),
                channels = codecPlan.audioChannels,
            )
            val ptsUs = NativeEncoderTiming.audioPresentationTimeUs(audioFramesQueued, codecPlan.audioSampleRate)
            repeat(frames * codecPlan.audioChannels) { input.putShort(0) }
            audioCodec.queueInputBuffer(inputIndex, 0, frames * codecPlan.audioChannels * 2, ptsUs, 0)
            audioFramesQueued += frames
            return true
        }

        fun feedVideoFrame(): Boolean {
            if (videoInputEnded) return false
            if (submittedVideoFrames >= codecPlan.frameCount) {
                videoCodec.signalEndOfInputStream()
                videoInputEnded = true
                return true
            }

            val bitmap = checkNotNull(renderBitmap)
            val frame = contract.frames[submittedVideoFrames]
            check(frame.frameIndex == submittedVideoFrames) { "Phase-8 frame submission order changed." }
            check(frame.presentationTimeUs == NativeEncoderTiming.videoPresentationTimeUs(codecPlan, submittedVideoFrames)) {
                "Phase-8 frame PTS changed before H.264 submission."
            }
            val renderEvidence = renderer.renderFrame(bitmap, submittedVideoFrames)
            check(renderEvidence.frameIndex == frame.frameIndex) { "Phase-8 renderer returned the wrong frame index." }
            check(renderEvidence.presentationTimeUs == frame.presentationTimeUs) { "Phase-8 renderer returned a different frame PTS." }
            check(renderEvidence.shotId == frame.shotId && renderEvidence.renderJobId == frame.renderJobId) {
                "Phase-8 renderer lost render-job/shot identity before H.264 submission."
            }
            checkNotNull(codecSurface).render(bitmap, frame.presentationTimeUs * 1_000L)
            submittedVideoFrames += 1
            return true
        }

        try {
            videoCodec.configure(selection.videoFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            videoInputSurface = videoCodec.createInputSurface()
            videoCodec.start()
            videoStarted = true
            codecSurface = NativePhase8EglCodecSurface(checkNotNull(videoInputSurface))
            renderBitmap = Bitmap.createBitmap(codecPlan.width, codecPlan.height, Bitmap.Config.ARGB_8888)

            audioCodec.configure(selection.audioFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            audioCodec.start()
            audioStarted = true

            while (true) {
                var progressed = false
                val formatsReady = videoDrain.outputFormat != null && audioDrain.outputFormat != null

                if (!formatsReady) {
                    if (submittedVideoFrames == 0) progressed = feedVideoFrame() || progressed
                    if (audioFramesQueued == 0L) progressed = feedAudioInput() || progressed
                } else {
                    if (canAdvance(NativeEncodedTrack.VIDEO)) progressed = feedVideoFrame() || progressed
                    if (canAdvance(NativeEncodedTrack.AUDIO)) progressed = feedAudioInput() || progressed
                }

                val videoResult = if (canAdvance(NativeEncodedTrack.VIDEO)) {
                    drainOne(videoCodec, NativeEncodedTrack.VIDEO, videoDrain)
                } else {
                    NativePhase8CodecDrainResult()
                }
                progressed = videoResult.progressed || progressed
                videoResult.packet?.let(::acceptPacket)

                val audioResult = if (canAdvance(NativeEncodedTrack.AUDIO)) {
                    drainOne(audioCodec, NativeEncodedTrack.AUDIO, audioDrain)
                } else {
                    NativePhase8CodecDrainResult()
                }
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
                        "Phase-8 encoder stalled while waiting for H.264/Opus output."
                    }
                }
            }

            check(videoInputEnded && audioInputEnded) { "Phase-8 encoder reached output EOS before both inputs were finalized." }
            check(submittedVideoFrames == codecPlan.frameCount) { "Phase-8 did not submit every accepted frame." }
            check(verifiedVideoSamples == codecPlan.frameCount && videoSampleCount == codecPlan.frameCount) {
                "Phase-8 H.264 output sample count does not equal the accepted frame count."
            }
            check(audioSampleCount > 0) { "Phase-8 placeholder Opus encoder produced no media samples." }
            check(firstVideoPtsUs == contract.frames.first().presentationTimeUs) { "Phase-8 first H.264 PTS changed." }
            check(lastVideoPtsUs == contract.frames.last().presentationTimeUs) { "Phase-8 last H.264 PTS changed." }

            checkNotNull(muxer).close()
            muxer = null

            return NativePhase8EncodedMp4Artifact(
                outputFile = outputFile,
                sourceCommit = contract.sourceCommit,
                referenceSha256 = contract.referenceSha256,
                scriptSha256 = contract.scriptSha256,
                frameCount = codecPlan.frameCount,
                firstVideoPresentationTimeUs = firstVideoPtsUs,
                lastVideoPresentationTimeUs = lastVideoPtsUs,
                audioPcmFrames = codecPlan.totalAudioFrames,
                videoSampleCount = videoSampleCount,
                audioSampleCount = audioSampleCount,
                audioMode = NativePhase8AudioMode.SILENCE_PLACEHOLDER_OBJECTIVE_2,
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

private class NativePhase8EglCodecSurface(
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
        check(display != EGL14.EGL_NO_DISPLAY) { "Unable to obtain EGL display for Phase-8 codec surface." }
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "Unable to initialize EGL for Phase-8 codec surface." }

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
            "Unable to choose a recordable EGL config for Phase-8 H.264 input."
        }
        val config = checkNotNull(configs[0])
        // EGL_RECORDABLE_ANDROID is already a hard selection predicate above. Some emulator EGL
        // implementations do not expose the selected extension attribute reliably via
        // eglGetConfigAttrib, so actual window-surface creation/submission remains the runtime gate.

        val contextAttributes = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, contextAttributes, 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "Unable to create OpenGL ES context for Phase-8 codec surface." }

        surface = EGL14.eglCreateWindowSurface(display, config, codecInputSurface, intArrayOf(EGL14.EGL_NONE), 0)
        check(surface != EGL14.EGL_NO_SURFACE) { "Unable to create EGL window surface for Phase-8 H.264 input." }
        check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to activate Phase-8 H.264 EGL surface." }

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
            "Unable to resolve Phase-8 codec shader bindings."
        }

        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        check(textureId != 0) { "Unable to allocate Phase-8 codec texture." }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        checkGl("initialize Phase-8 codec texture")
    }

    fun render(bitmap: Bitmap, presentationTimeNs: Long) {
        check(!closed) { "Phase-8 codec EGL surface is closed." }
        require(presentationTimeNs >= 0L) { "Phase-8 codec frame presentation time must be non-negative." }
        check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "Unable to activate Phase-8 codec EGL surface." }

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
        checkGl("render Phase-8 codec frame")

        check(EGLExt.eglPresentationTimeANDROID(display, surface, presentationTimeNs)) {
            "Unable to set Phase-8 H.264 frame presentation timestamp."
        }
        check(EGL14.eglSwapBuffers(display, surface)) { "Unable to submit Phase-8 frame to H.264 codec surface." }
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
        check(linked != 0) { "Unable to create Phase-8 codec shader program." }
        GLES20.glAttachShader(linked, vertex)
        GLES20.glAttachShader(linked, fragment)
        GLES20.glLinkProgram(linked)
        val status = IntArray(1)
        GLES20.glGetProgramiv(linked, GLES20.GL_LINK_STATUS, status, 0)
        val log = GLES20.glGetProgramInfoLog(linked)
        GLES20.glDeleteShader(vertex)
        GLES20.glDeleteShader(fragment)
        check(status[0] == GLES20.GL_TRUE) { "Unable to link Phase-8 codec shader program: $log" }
        return linked
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        check(shader != 0) { "Unable to allocate Phase-8 codec shader." }
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        val log = GLES20.glGetShaderInfoLog(shader)
        if (status[0] != GLES20.GL_TRUE) {
            GLES20.glDeleteShader(shader)
            error("Unable to compile Phase-8 codec shader: $log")
        }
        return shader
    }

    private fun checkGl(operation: String) {
        val error = GLES20.glGetError()
        check(error == GLES20.GL_NO_ERROR) { "OpenGL ES error 0x${error.toString(16)} while attempting to $operation." }
    }
}
