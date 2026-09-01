package com.aianimationstudio.runtime

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.provider.MediaStore
import androidx.media3.common.util.UnstableApi
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToLong

internal data class NativeExportReadinessArtifact(
    val renderArtifact: NativeProductionRenderArtifact,
    val videoEncoderName: String,
    val audioEncoderName: String,
)

internal sealed interface NativeExportReadinessResult {
    data class Ready(val artifact: NativeExportReadinessArtifact) : NativeExportReadinessResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeExportReadinessResult
}

internal object NativeExportReadiness {
    fun check(snapshot: NativeProductionSnapshot): NativeExportReadinessResult {
        if (snapshot.stage != NativeProductionStage.READY_FOR_RENDER || !snapshot.cameraReady) {
            return NativeExportReadinessResult.Rejected(
                listOf(NativeDiagnostic("EXPORT_PRODUCTION_NOT_READY", "Blocking, performance and camera gates must be ready before export preflight.")),
            )
        }

        val preparation = NativeAndroidFrameRenderer.prepare(snapshot)
        val renderArtifact = when (preparation) {
            is NativeRendererPreparation.Rejected -> {
                return NativeExportReadinessResult.Rejected(preparation.diagnostics)
            }
            is NativeRendererPreparation.Ready -> preparation.renderer.use { renderer ->
                when (val temporal = renderer.verifyTemporalMotion()) {
                    is NativeTemporalRenderVerification.Ready -> temporal.artifact
                    is NativeTemporalRenderVerification.Rejected -> {
                        return NativeExportReadinessResult.Rejected(temporal.diagnostics)
                    }
                }
            }
        }

        return when (val capability = NativeCodecCapabilities.probe(snapshot)) {
            is NativeCodecCapabilityResult.Rejected -> NativeExportReadinessResult.Rejected(capability.diagnostics)
            is NativeCodecCapabilityResult.Ready -> NativeExportReadinessResult.Ready(
                NativeExportReadinessArtifact(
                    renderArtifact = renderArtifact,
                    videoEncoderName = capability.selection.videoEncoderName,
                    audioEncoderName = capability.selection.audioEncoderName,
                ),
            )
        }
    }
}

internal data class NativeSavedMp4Artifact(
    val uri: Uri,
    val sha256: String,
    val sizeBytes: Long,
    val sourceCommit: String,
    val referenceSha256: String,
    val videoMimeType: String,
    val audioMimeType: String,
    val width: Int,
    val height: Int,
    val durationMs: Long,
    val videoSampleCount: Int,
    val audioSampleCount: Int,
    val firstVideoFrameDecoded: Boolean,
    val deterministicPlaybackVerified: Boolean,
)

internal sealed interface NativeExportPipelineResult {
    data class Ready(val artifact: NativeSavedMp4Artifact) : NativeExportPipelineResult
    data class Rejected(val diagnostics: List<NativeDiagnostic>) : NativeExportPipelineResult
}

internal object NativeExportVerificationPolicy {
    fun durationMatches(expectedDurationMs: Long, actualDurationMs: Long): Boolean {
        if (expectedDurationMs <= 0L || actualDurationMs <= 0L) return false
        val toleranceMs = max(1_200L, (expectedDurationMs * 0.08).roundToLong())
        return abs(actualDurationMs - expectedDurationMs) <= toleranceMs
    }
}

@UnstableApi
internal object NativeExportPipeline {
    fun export(
        context: Context,
        snapshot: NativeProductionSnapshot,
        displayStem: String,
    ): NativeExportPipelineResult {
        val blocking = snapshot.blocking ?: return NativeExportPipelineResult.Rejected(
            listOf(NativeDiagnostic("EXPORT_BLOCKING_MISSING", "Native export requires a validated blocking/output contract.")),
        )
        if (snapshot.sourceCommit.length != 40 || !snapshot.sourceCommit.matches(Regex("^[0-9a-f]{40}$"))) {
            return NativeExportPipelineResult.Rejected(
                listOf(NativeDiagnostic("EXPORT_SOURCE_IDENTITY", "Native export requires the exact 40-character source commit identity.")),
            )
        }

        when (val preflight = NativeExportReadiness.check(snapshot)) {
            is NativeExportReadinessResult.Rejected -> return NativeExportPipelineResult.Rejected(preflight.diagnostics)
            is NativeExportReadinessResult.Ready -> Unit
        }

        val appContext = context.applicationContext
        val outputFile = File(appContext.cacheDir, "native-production-${snapshot.sourceCommit.take(12)}-${System.nanoTime()}.mp4")
        return try {
            when (val encoded = NativeMediaCodecExporter.encode(snapshot, outputFile)) {
                is NativeCodecEncodingResult.Rejected -> NativeExportPipelineResult.Rejected(encoded.diagnostics)
                is NativeCodecEncodingResult.Ready -> NativeSavedMp4Verifier.saveAndVerify(
                    context = appContext,
                    encoded = encoded.artifact,
                    expectedOutput = blocking.output,
                    displayStem = displayStem,
                )
            }
        } finally {
            if (outputFile.exists()) outputFile.delete()
        }
    }
}

private data class NativeTrackDescriptor(
    val index: Int,
    val mimeType: String,
    val format: MediaFormat,
)

private data class NativeSavedSampleScan(
    val videoSampleCount: Int,
    val audioSampleCount: Int,
    val firstVideoSampleIsKeyFrame: Boolean,
    val lastVideoPtsUs: Long,
    val lastAudioPtsUs: Long,
)

private data class NativeDecodeSummary(
    val inputSampleCount: Int,
    val outputBufferCount: Int,
    val firstOutputDecoded: Boolean,
    val reachedOutputEos: Boolean,
)

private object NativeSavedMp4Verifier {
    private const val MIME_VIDEO_AVC = "video/avc"
    private const val MIME_AUDIO_OPUS = "audio/opus"
    private const val DEQUEUE_TIMEOUT_US = 10_000L
    private const val MAX_IDLE_CODEC_CYCLES = 1_000
    private const val EXPORT_DIRECTORY = "Movies/AI Animation Studio"

    fun saveAndVerify(
        context: Context,
        encoded: NativeEncodedMp4Artifact,
        expectedOutput: NativeOutputSpec,
        displayStem: String,
    ): NativeExportPipelineResult {
        if (!encoded.outputFile.isFile || encoded.outputFile.length() <= 0L) {
            return NativeExportPipelineResult.Rejected(
                listOf(NativeDiagnostic("EXPORT_ENCODED_FILE_MISSING", "Native encoder did not produce a non-empty MP4 file.")),
            )
        }

        val resolver = context.contentResolver
        var savedUri: Uri? = null
        return try {
            val encodedSha = sha256File(encoded.outputFile)
            val displayName = "${safeStem(displayStem)}-${encoded.sourceCommit.take(12)}.mp4"
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
                put(MediaStore.MediaColumns.RELATIVE_PATH, EXPORT_DIRECTORY)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = checkNotNull(resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)) {
                "Android MediaStore refused to create a durable MP4 destination."
            }
            savedUri = uri

            resolver.openOutputStream(uri, "w")?.use { output ->
                FileInputStream(encoded.outputFile).use { input ->
                    input.copyTo(output, DEFAULT_BUFFER_SIZE)
                }
            } ?: error("Android MediaStore could not open the durable MP4 destination for writing.")

            val finalized = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            check(resolver.update(uri, finalized, null, null) == 1) {
                "Android MediaStore could not finalize the durable MP4 destination."
            }

            val savedDigest = sha256Uri(context, uri)
            check(savedDigest.sizeBytes == encoded.outputFile.length()) {
                "Saved MP4 byte count does not match the encoded output."
            }
            check(savedDigest.sha256 == encodedSha) {
                "Saved MP4 SHA-256 does not match the encoded output."
            }

            val inspected = inspectAndDecode(
                context = context,
                uri = uri,
                encoded = encoded,
                expectedOutput = expectedOutput,
                savedSha256 = savedDigest.sha256,
                savedSizeBytes = savedDigest.sizeBytes,
            )
            savedUri = null
            NativeExportPipelineResult.Ready(inspected)
        } catch (failure: Exception) {
            savedUri?.let { resolver.delete(it, null, null) }
            NativeExportPipelineResult.Rejected(
                listOf(
                    NativeDiagnostic(
                        "EXPORT_NATIVE_VERIFICATION",
                        failure.message ?: "Native save and MP4 verification failed.",
                    ),
                ),
            )
        }
    }

    private fun inspectAndDecode(
        context: Context,
        uri: Uri,
        encoded: NativeEncodedMp4Artifact,
        expectedOutput: NativeOutputSpec,
        savedSha256: String,
        savedSizeBytes: Long,
    ): NativeSavedMp4Artifact {
        val extractor = MediaExtractor()
        val video: NativeTrackDescriptor
        val audio: NativeTrackDescriptor
        val scan: NativeSavedSampleScan
        var declaredDurationUs = 0L
        try {
            extractor.setDataSource(context, uri, null)
            check(extractor.trackCount == 2) {
                "Saved MP4 must contain exactly one H.264 video track and one Opus audio track."
            }

            val tracks = (0 until extractor.trackCount).map { index ->
                val format = extractor.getTrackFormat(index)
                val mime = format.getString(MediaFormat.KEY_MIME)
                    ?: error("Saved MP4 track $index has no MIME type.")
                NativeTrackDescriptor(index, mime, format)
            }
            video = tracks.singleOrNull { it.mimeType == MIME_VIDEO_AVC }
                ?: error("Saved MP4 does not contain exactly one H.264/AVC video track.")
            audio = tracks.singleOrNull { it.mimeType == MIME_AUDIO_OPUS }
                ?: error("Saved MP4 does not contain exactly one Opus audio track.")

            check(video.format.containsKey(MediaFormat.KEY_WIDTH) && video.format.containsKey(MediaFormat.KEY_HEIGHT)) {
                "Saved H.264 track does not declare dimensions."
            }
            check(video.format.getInteger(MediaFormat.KEY_WIDTH) == expectedOutput.width &&
                video.format.getInteger(MediaFormat.KEY_HEIGHT) == expectedOutput.height
            ) {
                "Saved H.264 dimensions do not match the requested production output."
            }

            declaredDurationUs = listOf(video.format, audio.format)
                .mapNotNull { format ->
                    if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else null
                }
                .maxOrNull() ?: 0L

            extractor.selectTrack(video.index)
            extractor.selectTrack(audio.index)
            scan = scanSavedSamples(extractor, video.index, audio.index)
        } finally {
            extractor.release()
        }

        check(scan.videoSampleCount == encoded.videoSampleCount) {
            "Saved H.264 sample count does not match the encoded stream."
        }
        check(scan.audioSampleCount == encoded.audioSampleCount) {
            "Saved Opus sample count does not match the encoded stream."
        }
        check(scan.firstVideoSampleIsKeyFrame) {
            "Saved H.264 stream does not begin with a key frame."
        }

        val durationUs = max(
            declaredDurationUs,
            max(scan.lastVideoPtsUs, scan.lastAudioPtsUs),
        )
        val durationMs = durationUs / 1_000L
        val expectedDurationMs = (expectedOutput.durationSeconds * 1_000.0).roundToLong()
        check(NativeExportVerificationPolicy.durationMatches(expectedDurationMs, durationMs)) {
            "Saved MP4 duration $durationMs ms does not match expected $expectedDurationMs ms."
        }

        val videoDecode = decodeEntireTrack(context, uri, video.index, video.mimeType)
        val audioDecode = decodeEntireTrack(context, uri, audio.index, audio.mimeType)
        check(videoDecode.inputSampleCount == scan.videoSampleCount && videoDecode.reachedOutputEos) {
            "H.264 full-stream decode did not consume the saved video track through EOS."
        }
        check(audioDecode.inputSampleCount == scan.audioSampleCount && audioDecode.reachedOutputEos) {
            "Opus full-stream decode did not consume the saved audio track through EOS."
        }
        check(videoDecode.firstOutputDecoded && videoDecode.outputBufferCount > 0) {
            "Native Android could not decode the first saved H.264 video frame."
        }
        check(audioDecode.outputBufferCount > 0) {
            "Native Android could not decode the saved Opus audio stream."
        }

        return NativeSavedMp4Artifact(
            uri = uri,
            sha256 = savedSha256,
            sizeBytes = savedSizeBytes,
            sourceCommit = encoded.sourceCommit,
            referenceSha256 = encoded.referenceSha256,
            videoMimeType = video.mimeType,
            audioMimeType = audio.mimeType,
            width = expectedOutput.width,
            height = expectedOutput.height,
            durationMs = durationMs,
            videoSampleCount = scan.videoSampleCount,
            audioSampleCount = scan.audioSampleCount,
            firstVideoFrameDecoded = true,
            deterministicPlaybackVerified = true,
        )
    }

    private fun scanSavedSamples(
        extractor: MediaExtractor,
        videoTrackIndex: Int,
        audioTrackIndex: Int,
    ): NativeSavedSampleScan {
        var videoCount = 0
        var audioCount = 0
        var lastVideoPtsUs = -1L
        var lastAudioPtsUs = -1L
        var firstVideoKeyFrame = false

        while (true) {
            val trackIndex = extractor.sampleTrackIndex
            if (trackIndex < 0) break
            val ptsUs = extractor.sampleTime
            check(ptsUs >= 0L) { "Saved MP4 contains a negative media timestamp." }
            when (trackIndex) {
                videoTrackIndex -> {
                    check(lastVideoPtsUs < 0L || ptsUs >= lastVideoPtsUs) {
                        "Saved H.264 sample timestamps are not monotonic."
                    }
                    if (videoCount == 0) {
                        firstVideoKeyFrame = (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                    }
                    lastVideoPtsUs = ptsUs
                    videoCount += 1
                }
                audioTrackIndex -> {
                    check(lastAudioPtsUs < 0L || ptsUs >= lastAudioPtsUs) {
                        "Saved Opus sample timestamps are not monotonic."
                    }
                    lastAudioPtsUs = ptsUs
                    audioCount += 1
                }
                else -> error("Saved MP4 contains an unexpected media track.")
            }
            extractor.advance()
        }

        check(videoCount > 0 && audioCount > 0) { "Saved MP4 must contain non-empty H.264 and Opus media samples." }
        return NativeSavedSampleScan(
            videoSampleCount = videoCount,
            audioSampleCount = audioCount,
            firstVideoSampleIsKeyFrame = firstVideoKeyFrame,
            lastVideoPtsUs = lastVideoPtsUs,
            lastAudioPtsUs = lastAudioPtsUs,
        )
    }

    private fun decodeEntireTrack(
        context: Context,
        uri: Uri,
        trackIndex: Int,
        mimeType: String,
    ): NativeDecodeSummary {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(context, uri, null)
            check(trackIndex in 0 until extractor.trackCount) { "Saved MP4 decoder track index is invalid." }
            val format = extractor.getTrackFormat(trackIndex)
            check(format.getString(MediaFormat.KEY_MIME) == mimeType) { "Saved MP4 track identity changed during decode verification." }
            extractor.selectTrack(trackIndex)

            codec = MediaCodec.createDecoderByType(mimeType)
            codec.configure(format, null, null, 0)
            codec.start()

            var inputEos = false
            var outputEos = false
            var inputSamples = 0
            var outputBuffers = 0
            var firstOutputDecoded = false
            var lastInputPtsUs = -1L
            var lastOutputPtsUs = -1L
            var idleCycles = 0

            while (!outputEos) {
                var progressed = false
                if (!inputEos) {
                    val inputIndex = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
                    if (inputIndex >= 0) {
                        val buffer = checkNotNull(codec.getInputBuffer(inputIndex)) {
                            "Native decoder returned a null input buffer."
                        }
                        buffer.clear()
                        val sampleSize = extractor.readSampleData(buffer, 0)
                        if (sampleSize < 0) {
                            val eosPtsUs = max(0L, lastInputPtsUs)
                            codec.queueInputBuffer(inputIndex, 0, 0, eosPtsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputEos = true
                        } else {
                            val ptsUs = extractor.sampleTime
                            check(ptsUs >= 0L) { "Native decoder input sample has a negative timestamp." }
                            check(lastInputPtsUs < 0L || ptsUs >= lastInputPtsUs) {
                                "Native decoder input sample timestamps are not monotonic."
                            }
                            codec.queueInputBuffer(inputIndex, 0, sampleSize, ptsUs, 0)
                            lastInputPtsUs = ptsUs
                            inputSamples += 1
                            extractor.advance()
                        }
                        progressed = true
                    }
                }

                val info = MediaCodec.BufferInfo()
                when (val outputIndex = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> progressed = true
                    else -> if (outputIndex >= 0) {
                        try {
                            if (info.size > 0) {
                                check(lastOutputPtsUs < 0L || info.presentationTimeUs >= lastOutputPtsUs) {
                                    "Native decoded output timestamps are not monotonic."
                                }
                                lastOutputPtsUs = info.presentationTimeUs
                                outputBuffers += 1
                                if (!firstOutputDecoded) firstOutputDecoded = true
                            }
                            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputEos = true
                        } finally {
                            codec.releaseOutputBuffer(outputIndex, false)
                        }
                        progressed = true
                    }
                }

                if (progressed) {
                    idleCycles = 0
                } else {
                    idleCycles += 1
                    check(idleCycles <= MAX_IDLE_CODEC_CYCLES) {
                        "Native saved-stream decoder stalled before EOS."
                    }
                }
            }

            return NativeDecodeSummary(
                inputSampleCount = inputSamples,
                outputBufferCount = outputBuffers,
                firstOutputDecoded = firstOutputDecoded,
                reachedOutputEos = outputEos,
            )
        } finally {
            codec?.let {
                runCatching { it.stop() }
                runCatching { it.release() }
            }
            extractor.release()
        }
    }

    private data class NativeDigest(val sha256: String, val sizeBytes: Long)

    private fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read == 0) continue
                digest.update(buffer, 0, read)
            }
        }
        return hex(digest.digest())
    }

    private fun sha256Uri(context: Context, uri: Uri): NativeDigest {
        val digest = MessageDigest.getInstance("SHA-256")
        var sizeBytes = 0L
        context.contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (read == 0) continue
                digest.update(buffer, 0, read)
                sizeBytes += read
            }
        } ?: error("Android MediaStore could not reopen the saved MP4 for SHA-256 verification.")
        check(sizeBytes > 0L) { "Saved MP4 is empty." }
        return NativeDigest(hex(digest.digest()), sizeBytes)
    }

    private fun safeStem(value: String): String {
        val stem = value.lowercase(Locale.US)
            .replace(Regex("[^a-z0-9._-]+"), "-")
            .trim('-')
            .take(80)
        return stem.ifBlank { "production" }
    }

    private fun hex(bytes: ByteArray): String {
        val digits = "0123456789abcdef"
        return buildString(bytes.size * 2) {
            for (byte in bytes) {
                val value = byte.toInt() and 0xff
                append(digits[value ushr 4])
                append(digits[value and 0x0f])
            }
        }
    }
}
