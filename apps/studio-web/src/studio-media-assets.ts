import type { MovieVideoAsset, StudioMovieSession } from "./studio-movie-session";

export interface PreparedMovieMedia {
  readonly images: ReadonlyMap<string, ImageBitmap>;
  close(): void;
}

export interface MovieMediaLoadDependencies {
  readonly fetchAsset?: typeof fetch;
  readonly decodeImage?: (blob: Blob) => Promise<ImageBitmap>;
  readonly baseUrl?: string;
}

function videoAssets(session: StudioMovieSession): readonly MovieVideoAsset[] {
  return Object.values(session.assets)
    .filter((asset): asset is MovieVideoAsset => asset.kind === "video")
    .sort((a, b) => a.id.localeCompare(b.id));
}

function requireBaseUrl(value?: string): string {
  if (value !== undefined) return value;
  if (typeof document !== "undefined") return document.baseURI;
  throw new Error("Movie media loading requires a base URL outside the browser document.");
}

export async function prepareMovieMedia(
  session: StudioMovieSession,
  dependencies: MovieMediaLoadDependencies = {},
): Promise<PreparedMovieMedia> {
  const fetchAsset = dependencies.fetchAsset ?? globalThis.fetch;
  const decodeImage = dependencies.decodeImage ?? globalThis.createImageBitmap;
  if (typeof fetchAsset !== "function") throw new Error("Fetch is unavailable for movie media loading.");
  if (typeof decodeImage !== "function") throw new Error("createImageBitmap is unavailable for movie media decoding.");

  const baseUrl = requireBaseUrl(dependencies.baseUrl);
  const images = new Map<string, ImageBitmap>();

  try {
    for (const asset of videoAssets(session)) {
      const url = new URL(asset.uri, baseUrl);
      const response = await fetchAsset(url);
      if (!response.ok) {
        throw new Error(`Failed to load image asset ${asset.id}: HTTP ${response.status}.`);
      }
      const blob = await response.blob();
      if (blob.type.length > 0 && !blob.type.startsWith("image/")) {
        throw new Error(`Image asset ${asset.id} returned unsupported content type ${blob.type}.`);
      }
      const bitmap = await decodeImage(blob);
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        bitmap.close();
        throw new Error(`Image asset ${asset.id} decoded with invalid dimensions.`);
      }
      images.set(asset.id, bitmap);
    }
  } catch (error) {
    for (const image of images.values()) image.close();
    throw error;
  }

  return Object.freeze({
    images,
    close(): void {
      for (const image of images.values()) image.close();
      images.clear();
    },
  });
}
