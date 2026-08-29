import { expect, test } from "@playwright/test";

test("native Chromium MP4 gate supports H.264 + AAC encode and MP4 playback", async ({ page }) => {
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
    const audioConfig: AudioEncoderConfig = {
      codec: "mp4a.40.2",
      sampleRate: 48_000,
      numberOfChannels: 1,
      bitrate: 64_000,
    };

    const videoSupport = await VideoEncoder.isConfigSupported(videoConfig);
    const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);

    const videoElement = document.createElement("video");
    const mimeType = 'video/mp4;codecs="avc1.42001E,mp4a.40.2"';
    const canPlay = videoElement.canPlayType(mimeType);
    const mediaSourceSupport = typeof MediaSource !== "undefined"
      ? MediaSource.isTypeSupported(mimeType)
      : false;

    let videoChunks = 0;
    let audioChunks = 0;
    let videoDecoderDescriptionBytes = 0;
    let audioDecoderDescriptionBytes = 0;

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

    if (audioSupport.supported) {
      const encoder = new AudioEncoder({
        output: (_chunk, metadata) => {
          audioChunks += 1;
          const description = metadata?.decoderConfig?.description;
          if (description instanceof ArrayBuffer) {
            audioDecoderDescriptionBytes = Math.max(audioDecoderDescriptionBytes, description.byteLength);
          } else if (ArrayBuffer.isView(description)) {
            audioDecoderDescriptionBytes = Math.max(audioDecoderDescriptionBytes, description.byteLength);
          }
        },
        error: (error) => {
          throw error;
        },
      });
      encoder.configure(audioSupport.config ?? audioConfig);

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
    }

    return {
      videoSupported: videoSupport.supported,
      audioSupported: audioSupport.supported,
      canPlay,
      mediaSourceSupport,
      videoChunks,
      audioChunks,
      videoDecoderDescriptionBytes,
      audioDecoderDescriptionBytes,
    };
  });

  expect(result.videoSupported).toBe(true);
  expect(result.audioSupported).toBe(true);
  expect(result.canPlay).not.toBe("");
  expect(result.mediaSourceSupport).toBe(true);
  expect(result.videoChunks).toBeGreaterThan(0);
  expect(result.audioChunks).toBeGreaterThan(0);
  expect(result.videoDecoderDescriptionBytes).toBeGreaterThan(0);
  expect(result.audioDecoderDescriptionBytes).toBeGreaterThan(0);
});
