import { supabaseClient } from "./supabase";

export const PHOTO_MAX_BYTES = 250 * 1024;
const PHOTO_TARGET_BYTES = PHOTO_MAX_BYTES - 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 1600;
const MIN_DIMENSION = 320;
const MAX_QUALITY = 0.92;
const MIN_QUALITY = 0.5;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("This browser could not compress the image.")),
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the compressed image."));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Choose a valid image file."));
    };
    image.src = objectUrl;
  });
}

async function bestJpegForCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const highest = await canvasToJpeg(canvas, MAX_QUALITY);
  if (highest.size <= PHOTO_TARGET_BYTES) return highest;

  const lowest = await canvasToJpeg(canvas, MIN_QUALITY);
  if (lowest.size > PHOTO_TARGET_BYTES) return null;

  let low = MIN_QUALITY;
  let high = MAX_QUALITY;
  let best: Blob = lowest;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToJpeg(canvas, quality);
    if (blob.size <= PHOTO_TARGET_BYTES) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best;
}

/**
 * Removes image metadata, preserves as much resolution and JPEG quality as
 * possible, and always returns an upload safely below the 250 KB limit.
 */
export async function fileToScaledDataURL(file: File, maxDimension = DEFAULT_MAX_DIMENSION): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Choose an image smaller than 25 MB.");

  const image = await loadImage(file);
  let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));

  for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const compressed = await bestJpegForCanvas(canvas);
    if (compressed) return blobToDataUrl(compressed);

    if (Math.max(width, height) <= MIN_DIMENSION) break;
    const minimumQualityBlob = await canvasToJpeg(canvas, MIN_QUALITY);
    const sizeRatio = Math.sqrt(PHOTO_TARGET_BYTES / minimumQualityBlob.size);
    scale *= Math.max(0.65, Math.min(0.9, sizeRatio * 0.95));
  }

  throw new Error("This image could not be compressed below 250 KB without excessive quality loss.");
}

export interface SavedPhotoFile {
  ok: boolean;
  fileName?: string;
  storagePath?: string;
}

export async function savePhotoFile(name: string, photoData: string, treeId?: string): Promise<SavedPhotoFile> {
  const client = supabaseClient();
  if (client && treeId) {
    const blob = await (await fetch(photoData)).blob();
    if (blob.size > PHOTO_MAX_BYTES) throw new Error("The compressed photo is still larger than 250 KB.");
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "person";
    const storagePath = `${treeId}/${safeName}-${crypto.randomUUID()}.jpg`;
    const { error } = await client.storage.from("family-tree-photos").upload(storagePath, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { ok: true, storagePath };
  }

  if (!import.meta.env.DEV) return { ok: false };

  const res = await fetch("/__family_tree_photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, photoData }),
  });

  if (res.status === 404) return { ok: false };
  if (!res.ok) throw new Error(`Could not save photo (${res.status}).`);
  return (await res.json()) as SavedPhotoFile;
}
