package com.aianimationstudio.runtime;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
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
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class StudioRuntimeBridge {
    private static final int MAX_BASE64_CHUNK_CHARS = 1_500_000;
    private static final String DOWNLOAD_RELATIVE_PATH = "Download/AI Animation Studio";

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
            boolean videoTrackPresent = false;
            boolean audioTrackPresent = false;
            for (int index = 0; index < extractor.getTrackCount(); index += 1) {
                MediaFormat format = extractor.getTrackFormat(index);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (mime.startsWith("video/")) videoTrackPresent = true;
                if (mime.startsWith("audio/")) audioTrackPresent = true;
            }

            metadata.setDataSource(appContext, uri);
            long durationMs = parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            int width = (int) parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = (int) parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));

            Bitmap firstFrame = metadata.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            boolean firstVideoFrameDecoded = firstFrame != null;
            if (firstFrame != null) firstFrame.recycle();

            JSONObject result = okJson();
            result.put("videoTrackPresent", videoTrackPresent);
            result.put("audioTrackPresent", audioTrackPresent);
            result.put("durationMs", durationMs);
            result.put("width", width);
            result.put("height", height);
            result.put("firstVideoFrameDecoded", firstVideoFrameDecoded);
            result.put("deterministicPlaybackVerified", false);
            result.put("note", "Native inspection proves container tracks, metadata and first-frame decode only; a later decoder/playback gate must set deterministicPlaybackVerified=true.");
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
