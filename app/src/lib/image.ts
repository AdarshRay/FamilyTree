/**
 * Read an uploaded image file and return a downscaled JPEG data URL.
 * Keeps localStorage small and rendering fast (cards are tiny anyway).
 */
export function fileToScaledDataURL(file: File, max = 440): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not a valid image"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no 2d context"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
import { supabaseClient } from "./supabase";
