package com.aianimationstudio.runtime;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class RuntimeDeviceProfile {
    private static final String ZERO_SHA = "0000000000000000000000000000000000000000";
    private static final Set<String> RELEVANT_MEDIA_TYPES = new HashSet<>(Arrays.asList(
            "video/avc",
            "video/hevc",
            "video/av01",
            "video/x-vnd.on2.vp9",
            "audio/opus",
            "audio/mp4a-latm"
    ));

    private RuntimeDeviceProfile() {}

    static JSONObject create(Context context) throws JSONException {
        JSONObject root = new JSONObject();
        root.put("schemaVersion", 2);
        root.put("platform", "android");
        root.put("runtimeKind", BuildConfig.STUDIO_RUNTIME_KIND);
        root.put("nativeComposeUi", true);
        root.put("webViewUsed", false);
        root.put("browserDomUsed", false);

        root.put("manufacturer", Build.MANUFACTURER);
        root.put("brand", Build.BRAND);
        root.put("model", Build.MODEL);
        root.put("device", Build.DEVICE);
        root.put("product", Build.PRODUCT);
        root.put("board", Build.BOARD);
        root.put("hardware", Build.HARDWARE);
        root.put("buildId", Build.ID);
        root.put("buildFingerprint", Build.FINGERPRINT);
        root.put("androidRelease", Build.VERSION.RELEASE);
        root.put("androidSdkInt", Build.VERSION.SDK_INT);
        root.put("androidIncremental", Build.VERSION.INCREMENTAL);
        root.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        root.put("supportedAbis", new JSONArray(Arrays.asList(Build.SUPPORTED_ABIS)));

        boolean emulated = isProbablyEmulator();
        root.put("emulated", emulated);
        root.put("physicalDeviceCandidate", !emulated);

        root.put("studioRepository", BuildConfig.STUDIO_REPOSITORY);
        root.put("studioCommitSha", BuildConfig.STUDIO_COMMIT_SHA);
        root.put("studioSourceDate", BuildConfig.STUDIO_SOURCE_DATE);
        root.put("exactStudioBuildBound", !ZERO_SHA.equals(BuildConfig.STUDIO_COMMIT_SHA));

        root.put("runtimePackage", BuildConfig.APPLICATION_ID);
        root.put("runtimeVersion", BuildConfig.VERSION_NAME);
        root.put("runtimeVersionCode", BuildConfig.VERSION_CODE);
        root.put("mediaCodecs", collectMediaCodecs());
        return root;
    }

    private static JSONArray collectMediaCodecs() {
        JSONArray codecs = new JSONArray();
        MediaCodecInfo[] infos = new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos();
        for (MediaCodecInfo info : infos) {
            for (String type : info.getSupportedTypes()) {
                String normalized = type.toLowerCase(Locale.ROOT);
                if (!RELEVANT_MEDIA_TYPES.contains(normalized)) continue;

                try {
                    MediaCodecInfo.CodecCapabilities capabilities = info.getCapabilitiesForType(type);
                    JSONObject codec = new JSONObject();
                    codec.put("name", info.getName());
                    codec.put("mimeType", normalized);
                    codec.put("encoder", info.isEncoder());
                    codec.put("hardwareAccelerated", info.isHardwareAccelerated());
                    codec.put("softwareOnly", info.isSoftwareOnly());
                    codec.put("vendor", info.isVendor());
                    codec.put("maxSupportedInstances", capabilities.getMaxSupportedInstances());
                    codecs.put(codec);
                } catch (RuntimeException | JSONException ignored) {
                    // Broken vendor codec descriptors should not make the whole runtime identity unreadable.
                }
            }
        }
        return codecs;
    }

    private static boolean isProbablyEmulator() {
        String fingerprint = Build.FINGERPRINT.toLowerCase(Locale.ROOT);
        String model = Build.MODEL.toLowerCase(Locale.ROOT);
        String manufacturer = Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        String hardware = Build.HARDWARE.toLowerCase(Locale.ROOT);
        String product = Build.PRODUCT.toLowerCase(Locale.ROOT);
        String brand = Build.BRAND.toLowerCase(Locale.ROOT);
        String device = Build.DEVICE.toLowerCase(Locale.ROOT);

        return fingerprint.startsWith("generic")
                || fingerprint.startsWith("unknown")
                || model.contains("google_sdk")
                || model.contains("emulator")
                || model.contains("android sdk built for")
                || manufacturer.contains("genymotion")
                || hardware.contains("goldfish")
                || hardware.contains("ranchu")
                || hardware.contains("vbox86")
                || product.contains("sdk")
                || product.contains("emulator")
                || product.contains("simulator")
                || (brand.startsWith("generic") && device.startsWith("generic"));
    }
}
