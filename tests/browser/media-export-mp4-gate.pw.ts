import { expect, test } from "@playwright/test";

test("native Chromium MP4 gate finds a browser-native H.264 audio pairing", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    if (
      typeof VideoEncoder === "undefined"
      || typeof VideoFrame === "undefined"
      || typeof AudioEncoder === "undefined"
      || typeof AudioData === "undefined"
      || typeof OffscreenCanvas === "undefined"
    ) {
      throw new Error("Required WebCodecs primitives are unavailable.");
    }

    const videoConfig: VideoEncoderConfig = {
      codec: "avc1.42001E",
      width: 160,
      height: 90,
      bitrate: 300_000,
      framerate: 12,
      latencyMode: "realtime",
    };
    const aacConfig: AudioEncoderConfig = {
      codec: "mp4a.40.2",
      sampleRate: 48_000,
      numberOfChannels: 1,
      bitrate: 64_000,
    };
    const opusConfig: AudioEncoderConfig = {
      codec: "opus",
      sampleRate: 48_000,
      numberOfChannels: 1,
      bitrate: 64_000,
    };

    const [videoSupport, aacSupport, opusSupport] = await Promise.all([
      VideoEncoder.isConfigSupported(videoConfig),
      AudioEncoder.isConfigSupported(aacConfig),
      AudioEncoder.isConfigSupported(opusConfig),
    ]);

    const videoElement = document.createElement("video");
    const aacMimeType = 'video/mp4;codecs="avc1.42001E,mp4a.40.2"';
    const opusMimeType = 'video/mp4;codecs="avc1.42001E,opus"';
    const aacCanPlay = videoElement.canPlayType(aacMimeType);
    const opusCanPlay = videoElement.canPlayType(opusMimeType);
    const aacMediaSourceSupport = typeof MediaSource !== "undefined"
      ? MediaSource.isTypeSupported(aacMimeType)
      : false;
    const opusMediaSourceSupport = typeof MediaSource !== "undefined"
      ? MediaSource.isTypeSupported(opusMimeType)
      : false;

    let videoChunks = 0;
    let videoDecoderDescriptionBytes = 0;

    if (videoSupport.supported) {
      const encoder = new VideoEncoder({
        output: (_chunk, metadata) => {
          videoChunks += 1;
          const description = metadata?.decoderConfig?.description;
          if (description instanceof ArrayBuffer) {
            videoDecoderDescriptionBytes = Math.max(videoDecoderDescriptionBytes, description.byteLength);
          } else if (ArrayBuffer.isView(description)) {
            videoDecoderDescriptionBytes = Math.max(videoDecoderDescriptionBytes, description.byteLength);
          }
        },
        error: (error) => {
          throw error;
        },
      });
      encoder.configure(videoSupport.config ?? videoConfig);

      const canvas = new OffscreenCanvas(160, 90);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("2D canvas context unavailable.");
      context.fillStyle = "rgb(20, 60, 120)";
      context.fillRect(0, 0, 160, 90);
      const frame = new VideoFrame(canvas, { timestamp: 0, duration: 83_333 });
      encoder.encode(frame, { keyFrame: true });
      frame.close();
      await encoder.flush();
      encoder.close();
    }

    const encodeAudioProbe = async (
      support: AudioEncoderSupport,
      fallbackConfig: AudioEncoderConfig,
    ): Promise<{ chunks: number; decoderDescriptionBytes: number }> => {
      if (!support.supported) return { chunks: 0, decoderDescriptionBytes: 0 };

      let chunks = 0;
      let decoderDescriptionBytes = 0;
      const encoder = new AudioEncoder({
        output: (_chunk, metadata) => {
          chunks += 1;
          const description = metadata?.decoderConfig?.description;
          if (description instanceof ArrayBuffer) {
            decoderDescriptionBytes = Math.max(decoderDescriptionBytes, description.byteLength);
          } else if (ArrayBuffer.isView(description)) {
            decoderDescriptionBytes = Math.max(decoderDescriptionBytes, description.byteLength);
          }
        },
        error: (error) => {
          throw error;
        },
      });
      encoder.configure(support.config ?? fallbackConfig);

      const frameCount = 1024;
      const samples = new Float32Array(frameCount);
      for (let frame = 0; frame < frameCount; frame += 1) {
        samples[frame] = Math.sin((2 * Math.PI * 440 * frame) / 48_000) * 0.2;
      }
      const audio = new AudioData({
        format: "f32",
        sampleRate: 48_000,
        numberOfFrames: frameCount,
        numberOfChannels: 1,
        timestamp: 0,
        data: samples,
      });
      encoder.encode(audio);
      audio.close();
      await encoder.flush();
      encoder.close();
      return { chunks, decoderDescriptionBytes };
    };

    const [aacEncoded, opusEncoded] = await Promise.all([
      encodeAudioProbe(aacSupport, aacConfig),
      encodeAudioProbe(opusSupport, opusConfig),
    ]);

    return {
      videoSupported: videoSupport.supported,
      videoChunks,
      videoDecoderDescriptionBytes,
      aacSupported: aacSupport.supported,
      aacChunks: aacEncoded.chunks,
      aacDecoderDescriptionBytes: aacEncoded.decoderDescriptionBytes,
      aacCanPlay,
      aacMediaSourceSupport,
      opusSupported: opusSupport.supported,
      opusChunks: opusEncoded.chunks,
      opusDecoderDescriptionBytes: opusEncoded.decoderDescriptionBytes,
      opusCanPlay,
      opusMediaSourceSupport,
    };
  });

  expect(result.videoSupported).toBe(true);
  expect(result.videoChunks).toBeGreaterThan(0);
  expect(result.videoDecoderDescriptionBytes).toBeGreaterThan(0);

  const nativeAacPath = result.aacSupported
    && result.aacChunks > 0
    && result.aacDecoderDescriptionBytes > 0
    && result.aacCanPlay !== "";
  const nativeOpusPath = result.opusSupported
    && result.opusChunks > 0
    && result.opusCanPlay !== "";

  expect(nativeAacPath || nativeOpusPath).toBe(true);
});
