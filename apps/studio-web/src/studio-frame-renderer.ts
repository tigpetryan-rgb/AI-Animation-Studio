import { seekPreparedVideo, type PreparedMovieMedia } from "./studio-media-assets";
import {
  rationalSeconds,
  type MovieTimelineSample,
  type StudioMovieSession,
} from "./studio-movie-session";

export type MovieCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function normalizedLoop(seconds: number, periodSeconds: number): number {
  if (periodSeconds <= 0) return 0;
  const remainder = seconds % periodSeconds;
  return (remainder < 0 ? remainder + periodSeconds : remainder) / periodSeconds;
}

function drawDecodedImage(
  context: MovieCanvasContext,
  image: ImageBitmap,
  width: number,
  height: number,
  sourceSeconds: number,
  pan: "left-to-right" | "right-to-left",
): void {
  const targetAspect = width / height;
  const sourceAspect = image.width / image.height;
  let baseCropWidth: number;
  let baseCropHeight: number;

  if (sourceAspect >= targetAspect) {
    baseCropHeight = image.height;
    baseCropWidth = baseCropHeight * targetAspect;
  } else {
    baseCropWidth = image.width;
    baseCropHeight = baseCropWidth / targetAspect;
  }

  const zoom = 1.08;
  const cropWidth = baseCropWidth / zoom;
  const cropHeight = baseCropHeight / zoom;
  const maxX = Math.max(0, image.width - cropWidth);
  const maxY = Math.max(0, image.height - cropHeight);
  const phase = normalizedLoop(sourceSeconds, 2);
  const sx = pan === "left-to-right" ? maxX * phase : maxX * (1 - phase);
  const sy = maxY / 2;

  context.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, width, height);
}

export async function drawMovieTimelineFrame(
  context: MovieCanvasContext,
  session: StudioMovieSession,
  media: PreparedMovieMedia,
  sample: MovieTimelineSample,
  timelineSeconds: number,
  durationSeconds: number,
): Promise<void> {
  const { width, height } = session.exportProfile;
  const video = sample.video;
  if (video === undefined) {
    context.fillStyle = "rgb(8, 10, 14)";
    context.fillRect(0, 0, width, height);
    return;
  }

  const sourceSeconds = rationalSeconds(video.sourceTime);
  let mediaLabel: string;
  if (video.asset.mediaType === "image") {
    const image = media.images.get(video.asset.id);
    if (image === undefined) throw new Error(`Decoded image asset ${video.asset.id} is unavailable.`);
    drawDecodedImage(context, image, width, height, sourceSeconds, video.asset.pan);
    mediaLabel = "decoded image";
  } else {
    const decoded = media.videos.get(video.asset.id);
    if (decoded === undefined) throw new Error(`Decoded video asset ${video.asset.id} is unavailable.`);
    await seekPreparedVideo(decoded, sourceSeconds);
    context.drawImage(decoded.element, 0, 0, width, height);
    mediaLabel = "decoded video";
  }

  context.fillStyle = "rgba(5, 8, 14, 0.68)";
  context.fillRect(12, 12, 184, 60);
  context.fillStyle = "rgb(248, 250, 252)";
  context.font = "bold 14px sans-serif";
  context.fillText(video.asset.label, 20, 32);
  context.font = "11px sans-serif";
  context.fillText(`clip ${video.clip.id}`, 20, 49);
  context.fillText(`${mediaLabel} · source ${sourceSeconds.toFixed(2)}s`, 20, 64);

  const progress = durationSeconds <= 0 ? 0 : Math.min(1, timelineSeconds / durationSeconds);
  context.fillStyle = "rgba(255,255,255,0.24)";
  context.fillRect(20, height - 22, width - 40, 5);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.fillRect(20, height - 22, Math.round((width - 40) * progress), 5);
  context.font = "11px monospace";
  context.fillText(`${timelineSeconds.toFixed(2)} / ${durationSeconds.toFixed(2)}s`, 20, height - 32);
}
