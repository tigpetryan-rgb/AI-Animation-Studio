package com.aianimationstudio.runtime;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class StudioRuntimeBridge {
    private static final int MAX_BASE64_CHUNK_CHARS = 1_500_000;
    private static final String DOWNLOAD_RELATIVE_PATH = "Download/AI Animation Studio";
    private static final long CODEC_DEQUEUE_TIMEOUT_US = 10_000L;
    private static final long MIN_DECODE_TIMEOUT_MS = 8_000L;
    private static final long MAX_DECODE_TIMEOUT_MS = 30_000L;

    private final Context appContext;
    private final ConcurrentHashMap<String, FileWriteSession> writes = new ConcurrentHashMap<>();

    StudioRuntimeBridge(Context context) {
        this.appContext = context.getApplicationContext();
    }

    @JavascriptInterface
    public String getRuntimeInfoJson() {
        try {
            return RuntimeDeviceProfile.create(appContext).toString();
        } catch (JSONException error) {
            return errorJson("runtime-profile", error).toString();
        }
    }

    @JavascriptInterface
    public String beginFileWrite(String requestJson) {
        try {
            JSONObject request = new JSONObject(requestJson);
            String fileName = sanitizeFileName(request.getString("fileName"));
            String mimeType = request.optString("mimeType", "application/octet-stream");
            if (mimeType.trim().isEmpty()) mimeType = "application/octet-stream";

            ContentResolver resolver = appContext.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, DOWNLOAD_RELATIVE_PATH);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("MediaStore did not return a destination URI.");

            OutputStream raw = resolver.openOutputStream(uri, "w");
            if (raw == null) {
                resolver.delete(uri, null, null);
                throw new IOException("Unable to open the MediaStore destination.");
            }

            String sessionId = UUID.randomUUID().toString();
            FileWriteSession session = new FileWriteSession(uri, new BufferedOutputStream(raw), MessageDigest.getInstance("SHA-256"));
            writes.put(sessionId, session);

            JSONObject result = okJson();
            result.put("sessionId", sessionId);
            result.put("uri", uri.toString());
            return result.toString();
        } catch (Exception error) {
            return errorJson("begin-file-write", error).toString();
        }
    }

    @JavascriptInterface
    public String appendFileChunk(String sessionId, String base64Chunk) {
        FileWriteSession session = writes.get(sessionId);
        if (session == null) return errorJson("append-file-chunk", new IllegalStateException("Unknown file-write session.")).toString();
        if (base64Chunk.length() > MAX_BASE64_CHUNK_CHARS) {
            return errorJson("append-file-chunk", new IllegalArgumentException("Chunk exceeds the native bridge size limit.")).toString();
        }

        try {
            byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
            session.output.write(bytes);
            session.digest.update(bytes);
            session.bytesWritten += bytes.length;

            JSONObject result = okJson();
            result.put("bytesWritten", session.bytesWritten);
            return result.toString();
        } catch (Exception error) {
            return errorJson("append-file-chunk", error).toString();
        }
    }

    @JavascriptInterface
    public String finishFileWrite(String sessionId) {
        FileWriteSession session = writes.remove(sessionId);
        if (session == null) return errorJson("finish-file-write", new IllegalStateException("Unknown file-write session.")).toString();

        try {
            session.output.flush();
            session.output.close();

            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            appContext.getContentResolver().update(session.uri, values, null, null);

            JSONObject result = okJson();
            result.put("uri", session.uri.toString());
            result.put("bytesWritten", session.bytesWritten);
            result.put("sha256", hex(session.digest.digest()));
            return result.toString();
        } catch (Exception error) {
            appContext.getContentResolver().delete(session.uri, null, null);
            return errorJson("finish-file-write", error).toString();
        }
    }

    @JavascriptInterface
    public String abortFileWrite(String sessionId) {
        FileWriteSession session = writes.remove(sessionId);
        if (session == null) return okJson().toString();

        try {
            session.output.close();
        } catch (IOException ignored) {
        }
        appContext.getContentResolver().delete(session.uri, null, null);
        return okJson().toString();
    }

    @JavascriptInterface
    public String inspectSavedMp4(String uriString) {
        Uri uri = Uri.parse(uriString);
        MediaExtractor extractor = new MediaExtractor();
        MediaMetadataRetriever metadata = new MediaMetadataRetriever();
        try {
            extractor.setDataSource(appContext, uri, null);
            int videoTrackIndex = -1;
            int audioTrackIndex = -1;
            MediaFormat videoFormat = null;
            MediaFormat audioFormat = null;
            for (int index = 0; index < extractor.getTrackCount(); index += 1) {
                MediaFormat format = extractor.getTrackFormat(index);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (videoTrackIndex < 0 && mime.startsWith("video/")) {
                    videoTrackIndex = index;
                    videoFormat = format;
                }
                if (audioTrackIndex < 0 && mime.startsWith("audio/")) {
                    audioTrackIndex = index;
                    audioFormat = format;
                }
            }

            boolean videoTrackPresent = videoTrackIndex >= 0;
            boolean audioTrackPresent = audioTrackIndex >= 0;

            metadata.setDataSource(appContext, uri);
            long durationMs = parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            int width = (int) parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = (int) parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));

            Bitmap firstFrame = metadata.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            boolean firstVideoFrameDecoded = firstFrame != null;
            if (firstFrame != null) firstFrame.recycle();

            DecodeProbe videoDecode = videoTrackPresent && videoFormat != null
                    ? decodeTrackToEnd(uri, videoTrackIndex, videoFormat, durationMs)
                    : DecodeProbe.notPresent("video");
            DecodeProbe audioDecode = audioTrackPresent && audioFormat != null
                    ? decodeTrackToEnd(uri, audioTrackIndex, audioFormat, durationMs)
                    : DecodeProbe.notPresent("audio");

            boolean videoDecodeVerified = videoTrackPresent
                    && firstVideoFrameDecoded
                    && decodeProbeVerified(videoDecode, durationMs);
            boolean audioDecodeVerified = !audioTrackPresent || decodeProbeVerified(audioDecode, durationMs);
            boolean deterministicPlaybackVerified = videoDecodeVerified && audioDecodeVerified;

            JSONObject result = okJson();
            result.put("videoTrackPresent", videoTrackPresent);
            result.put("audioTrackPresent", audioTrackPresent);
            result.put("durationMs", durationMs);
            result.put("width", width);
            result.put("height", height);
            result.put("firstVideoFrameDecoded", firstVideoFrameDecoded);
            result.put("deterministicPlaybackVerified", deterministicPlaybackVerified);
            result.put(
                    "note",
                    "Bounded native full-stream decode gate; "
                            + describeProbe(videoDecode, durationMs)
                            + "; "
                            + describeProbe(audioDecode, durationMs)
                            + ". deterministicPlaybackVerified="
                            + deterministicPlaybackVerified
                            + ". This proves decoder EOS/timestamp progression for the saved file, not display/speaker A/V synchronization."
            );
            return result.toString();
        } catch (Exception error) {
            return errorJson("inspect-saved-mp4", error).toString();
        } finally {
            extractor.release();
            try {
                metadata.release();
            } catch (IOException ignored) {
            }
        }
    }

    private DecodeProbe decodeTrackToEnd(Uri uri, int trackIndex, MediaFormat format, long durationMs) {
        String mime = format.getString(MediaFormat.KEY_MIME);
        String label = mime != null && mime.startsWith("audio/") ? "audio" : "video";
        if (mime == null || mime.trim().isEmpty()) {
            return DecodeProbe.failed(label, "Track MIME type is missing.");
        }

        long timeoutMs = Math.max(MIN_DECODE_TIMEOUT_MS, Math.min(MAX_DECODE_TIMEOUT_MS, durationMs + 5_000L));
        long deadlineNs = System.nanoTime() + timeoutMs * 1_000_000L;
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        boolean decoderStarted = false;
        try {
            extractor.setDataSource(appContext, uri, null);
            extractor.selectTrack(trackIndex);

            decoder = MediaCodec.createDecoderByType(mime);
            String decoderName = decoder.getName();
            decoder.configure(format, null, null, 0);
            decoder.start();
            decoderStarted = true;

            MediaCodec.BufferInfo outputInfo = new MediaCodec.BufferInfo();
            boolean inputEnded = false;
            boolean outputEnded = false;
            long lastInputPtsUs = 0L;
            long lastOutputPtsUs = -1L;
            int outputBufferCount = 0;
            boolean timestampsMonotonic = true;

            while (!outputEnded) {
                if (System.nanoTime() >= deadlineNs) {
                    return DecodeProbe.failed(
                            label,
                            decoderName,
                            outputBufferCount,
                            lastOutputPtsUs,
                            timestampsMonotonic,
                            "Decoder did not reach EOS within " + timeoutMs + " ms."
                    );
                }

                if (!inputEnded) {
                    int inputIndex = decoder.dequeueInputBuffer(CODEC_DEQUEUE_TIMEOUT_US);
                    if (inputIndex >= 0) {
                        ByteBuffer inputBuffer = decoder.getInputBuffer(inputIndex);
                        if (inputBuffer == null) {
                            return DecodeProbe.failed(
                                    label,
                                    decoderName,
                                    outputBufferCount,
                                    lastOutputPtsUs,
                                    timestampsMonotonic,
                                    "Decoder returned a null input buffer."
                            );
                        }
                        inputBuffer.clear();
                        int sampleSize = extractor.readSampleData(inputBuffer, 0);
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(
                                    inputIndex,
                                    0,
                                    0,
                                    Math.max(0L, lastInputPtsUs),
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM
                            );
                            inputEnded = true;
                        } else {
                            long sampleTimeUs = Math.max(0L, extractor.getSampleTime());
                            int sampleFlags = extractor.getSampleFlags();
                            decoder.queueInputBuffer(inputIndex, 0, sampleSize, sampleTimeUs, sampleFlags);
                            lastInputPtsUs = sampleTimeUs;
                            extractor.advance();
                        }
                    }
                }

                int outputIndex = decoder.dequeueOutputBuffer(outputInfo, CODEC_DEQUEUE_TIMEOUT_US);
                if (outputIndex >= 0) {
                    boolean codecConfig = (outputInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
                    boolean endOfStream = (outputInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    if (!codecConfig && outputInfo.size > 0) {
                        if (lastOutputPtsUs >= 0L && outputInfo.presentationTimeUs < lastOutputPtsUs) {
                            timestampsMonotonic = false;
                        }
                        lastOutputPtsUs = Math.max(lastOutputPtsUs, outputInfo.presentationTimeUs);
                        outputBufferCount += 1;
                    }
                    decoder.releaseOutputBuffer(outputIndex, false);
                    if (endOfStream) outputEnded = true;
                }
            }

            return DecodeProbe.completed(label, decoderName, outputBufferCount, lastOutputPtsUs, timestampsMonotonic);
        } catch (Exception error) {
            return DecodeProbe.failed(
                    label,
                    decoder == null ? null : safeDecoderName(decoder),
                    0,
                    -1L,
                    false,
                    error.getClass().getSimpleName() + ": " + (error.getMessage() == null ? "decoder failure" : error.getMessage())
            );
        } finally {
            if (decoder != null) {
                if (decoderStarted) {
                    try {
                        decoder.stop();
                    } catch (RuntimeException ignored) {
                    }
                }
                try {
                    decoder.release();
                } catch (RuntimeException ignored) {
                }
            }
            extractor.release();
        }
    }

    private static boolean decodeProbeVerified(DecodeProbe probe, long durationMs) {
        if (!probe.completed || !probe.timestampsMonotonic || probe.outputBufferCount <= 0 || probe.lastPresentationTimeUs < 0L) {
            return false;
        }
        if (durationMs <= 0L) return true;
        long durationUs = durationMs * 1_000L;
        long toleranceUs = Math.max(500_000L, Math.min(2_000_000L, durationUs / 20L));
        return probe.lastPresentationTimeUs + toleranceUs >= durationUs;
    }

    private static String describeProbe(DecodeProbe probe, long durationMs) {
        if (!probe.present) return probe.label + "=absent";
        boolean coverage = decodeProbeVerified(probe, durationMs);
        String base = probe.label
                + "={decoder=" + (probe.decoderName == null ? "unknown" : probe.decoderName)
                + ", eos=" + probe.completed
                + ", outputs=" + probe.outputBufferCount
                + ", monotonic=" + probe.timestampsMonotonic
                + ", lastPtsUs=" + probe.lastPresentationTimeUs
                + ", durationCoverage=" + coverage;
        if (probe.failureMessage == null) return base + "}";
        return base + ", failure=" + probe.failureMessage.replace(';', ',') + "}";
    }

    private static String safeDecoderName(MediaCodec decoder) {
        try {
            return decoder.getName();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static String sanitizeFileName(String input) {
        String trimmed = input.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("fileName must not be empty.");
        if (trimmed.contains("/") || trimmed.contains("\\")) {
            throw new IllegalArgumentException("fileName must not contain path separators.");
        }
        return trimmed;
    }

    private static long parseLong(String value) {
        if (value == null || value.isEmpty()) return 0L;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return builder.toString();
    }

    private static JSONObject okJson() {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", true);
        } catch (JSONException ignored) {
        }
        return result;
    }

    private static JSONObject errorJson(String operation, Exception error) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("operation", operation);
            result.put("error", error.getClass().getSimpleName());
            result.put("message", error.getMessage() == null ? "Unknown error." : error.getMessage());
        } catch (JSONException ignored) {
        }
        return result;
    }

    private static final class DecodeProbe {
        final String label;
        final boolean present;
        final boolean completed;
        final String decoderName;
        final int outputBufferCount;
        final long lastPresentationTimeUs;
        final boolean timestampsMonotonic;
        final String failureMessage;

        private DecodeProbe(
                String label,
                boolean present,
                boolean completed,
                String decoderName,
                int outputBufferCount,
                long lastPresentationTimeUs,
                boolean timestampsMonotonic,
                String failureMessage
        ) {
            this.label = label;
            this.present = present;
            this.completed = completed;
            this.decoderName = decoderName;
            this.outputBufferCount = outputBufferCount;
            this.lastPresentationTimeUs = lastPresentationTimeUs;
            this.timestampsMonotonic = timestampsMonotonic;
            this.failureMessage = failureMessage;
        }

        static DecodeProbe notPresent(String label) {
            return new DecodeProbe(label, false, false, null, 0, -1L, true, null);
        }

        static DecodeProbe completed(
                String label,
                String decoderName,
                int outputBufferCount,
                long lastPresentationTimeUs,
                boolean timestampsMonotonic
        ) {
            return new DecodeProbe(label, true, true, decoderName, outputBufferCount, lastPresentationTimeUs, timestampsMonotonic, null);
        }

        static DecodeProbe failed(String label, String message) {
            return new DecodeProbe(label, true, false, null, 0, -1L, false, message);
        }

        static DecodeProbe failed(
                String label,
                String decoderName,
                int outputBufferCount,
                long lastPresentationTimeUs,
                boolean timestampsMonotonic,
                String message
        ) {
            return new DecodeProbe(label, true, false, decoderName, outputBufferCount, lastPresentationTimeUs, timestampsMonotonic, message);
        }
    }

    private static final class FileWriteSession {
        final Uri uri;
        final OutputStream output;
        final MessageDigest digest;
        long bytesWritten;

        FileWriteSession(Uri uri, OutputStream output, MessageDigest digest) {
            this.uri = uri;
            this.output = output;
            this.digest = digest;
            this.bytesWritten = 0L;
        }
    }
}
