import type {PhotoInput} from "./types";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
// Three base64 images stay below the cloud proxy's 3.5 MiB JSON limit.
export const MAX_PREPARED_PHOTO_BYTES = 700 * 1024;
/** Decode and re-encode locally: bounded payload, no EXIF location metadata. */
export async function preparePhoto(file: File): Promise<PhotoInput> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Selecciona una imagen JPG, PNG o WebP.");
  if (!file.size || file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error("La foto original debe pesar como máximo 20 MB. Se optimiza automáticamente antes de enviarla.");
  let bitmap: ImageBitmap;
  try {bitmap = await createImageBitmap(file);}
  catch {throw new Error("No se pudo leer la imagen. Intenta con otra foto JPG, PNG o WebP.");}
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("La imagen es demasiado grande. Usa una foto de hasta 40 megapíxeles.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador no pudo preparar la imagen.");
    let data_url: string | undefined;
    for (const maximumEdge of [1600, 1280, 1024, 800]) {
      const scale = Math.min(1, maximumEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.76, 0.68, 0.6]) {
        const candidate = canvas.toDataURL("image/jpeg", quality);
        const prefix = "data:image/jpeg;base64,";
        if (!candidate.startsWith(prefix)) throw new Error("Este navegador no pudo optimizar la imagen.");
        const base64 = candidate.slice(prefix.length);
        if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Este navegador no pudo optimizar la imagen.");
        const bytes = base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
        if (bytes <= MAX_PREPARED_PHOTO_BYTES) {data_url = candidate; break;}
      }
      if (data_url) break;
    }
    if (!data_url) throw new Error("No se pudo reducir la foto al tamaño de carga permitido. Usa una imagen de menor resolución.");
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "foto";
    return {filename: `${stem}.jpg`, data_url};
  } finally {bitmap.close();}
}
