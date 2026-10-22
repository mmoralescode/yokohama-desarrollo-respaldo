import {expect, test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import ts from "typescript";
import {MAX_PHOTO_BYTES, MAX_PREPARED_PHOTO_BYTES, preparePhoto} from "../lib/photos";

test("noisy evidence is adaptively optimized to 700 KiB and three photos fit the cloud body", async ({page}) => {
  const source = ts.transpileModule(readFileSync(join(__dirname, "../lib/photos.ts"), "utf8"), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText.replace(/^export /gm, "");
  await page.addScriptTag({content: `${source}\nwindow.prepareEvidencePhoto = preparePhoto;`});
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 1600;
    const context = canvas.getContext("2d")!, image = context.createImageData(1600, 1600);
    let seed = 20261004;
    for (let index = 0; index < image.data.length; index += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      image.data[index] = seed & 255; image.data[index + 1] = seed >>> 8 & 255; image.data[index + 2] = seed >>> 16 & 255; image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), "image/png"));
    const file = new File([blob], "Evidencia prueba.png", {type: "image/png"});
    const attempts: {quality?: number; width: number; height: number}[] = [];
    const encode = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: number) {attempts.push({quality, width: this.width, height: this.height}); return encode.call(this, type, quality);};
    try {
      const prepare = (window as unknown as {prepareEvidencePhoto: (file: File) => Promise<{filename: string; data_url: string}>}).prepareEvidencePhoto;
      const photo = await prepare(file);
      const binary = atob(photo.data_url.split(",")[1]);
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(binary, value => value.charCodeAt(0))], {type: "image/jpeg"}));
      const dimensions = {width: bitmap.width, height: bitmap.height}; bitmap.close();
      return {filename: photo.filename, bytes: binary.length, magic: [binary.charCodeAt(0), binary.charCodeAt(1)], dimensions, attempts,
        sourceBytes: file.size, bodyBytes: new TextEncoder().encode(JSON.stringify({photos: [photo, photo, photo], resolution_notes: "Reparación ficticia validada"})).length};
    } finally {HTMLCanvasElement.prototype.toDataURL = encode;}
  });
  expect(result.filename).toBe("Evidencia-prueba.jpg"); expect(result.bytes).toBeLessThanOrEqual(MAX_PREPARED_PHOTO_BYTES);
  expect(result.magic).toEqual([255, 216]); expect(result.sourceBytes).toBeGreaterThan(MAX_PREPARED_PHOTO_BYTES);
  expect(result.attempts.length).toBeGreaterThan(1); expect(Math.max(result.dimensions.width, result.dimensions.height)).toBeLessThanOrEqual(1600);
  expect(result.bodyBytes).toBeLessThan(3.5 * 1024 * 1024); expect(MAX_PHOTO_BYTES).toBe(3 * 1024 * 1024);
});

test("invalid source files fail without decoding and decoded failures always release their bitmap", async () => {
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let decoded = 0, closed = 0;
  Object.defineProperty(globalThis, "createImageBitmap", {configurable: true, value: async () => {decoded++; return {width: 1600, height: 1000, close: () => {closed++;}};}});
  Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: () => ({getContext: () => ({fillRect() {}, drawImage() {}}), toDataURL: () => "data:image/png;base64,AAAA"})}});
  try {
    await expect(preparePhoto(new File(["bad"], "unsafe.svg", {type: "image/svg+xml"}))).rejects.toThrow("JPG, PNG o WebP");
    await expect(preparePhoto(new File([], "empty.png", {type: "image/png"}))).rejects.toThrow("20 MB");
    expect(decoded).toBe(0);
    await expect(preparePhoto(new File(["example"], "valid.png", {type: "image/png"}))).rejects.toThrow("no pudo optimizar");
    expect(closed).toBe(1);
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: () => ({getContext: () => ({fillRect() {}, drawImage() {}}), toDataURL: () => `data:image/jpeg;base64,${"A".repeat(1024 * 1024)}`})}});
    await expect(preparePhoto(new File(["example"], "too-large.png", {type: "image/png"}))).rejects.toThrow("tamaño de carga");
    expect(closed).toBe(2);
  } finally {
    if (originalBitmap) Object.defineProperty(globalThis, "createImageBitmap", originalBitmap); else Reflect.deleteProperty(globalThis, "createImageBitmap");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
