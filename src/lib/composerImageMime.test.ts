import { describe, expect, test } from "bun:test";
import { composerImageMimeType, normalizeComposerImageFile, uploadableImage } from "./composerImageMime.ts";

describe("composerImageMimeType", () => {
  test("infers supported image types for missing and generic MIME types", () => {
    const cases: readonly [string, string][] = [
      ["shot.PNG", "image/png"],
      ["photo.jpg", "image/jpeg"],
      ["photo.jpeg", "image/jpeg"],
      ["animation.gif", "image/gif"],
      ["screen.webp", "image/webp"],
    ];
    for (const [name, mime] of cases) {
      expect(composerImageMimeType(name, "")).toBe(mime);
      expect(composerImageMimeType(name, "application/octet-stream")).toBe(mime);
    }
  });

  test("leaves explicit MIME types and unknown extensions alone", () => {
    expect(composerImageMimeType("photo.png", "text/plain")).toBeNull();
    expect(composerImageMimeType("photo.heic", "")).toBeNull();
    expect(composerImageMimeType("photo", "application/octet-stream")).toBeNull();
    expect(composerImageMimeType(".png", "")).toBeNull();
  });

  test("normalizes a generic image file for the image upload path", async () => {
    const source = new File(["image bytes"], "screen.png", { type: "application/octet-stream", lastModified: 123 });
    const normalized = normalizeComposerImageFile(source);
    expect(normalized).not.toBe(source);
    expect(normalized.type).toBe("image/png");
    expect(normalized.name).toBe(source.name);
    expect(normalized.lastModified).toBe(source.lastModified);
    expect(await normalized.text()).toBe("image bytes");
    const unknown = new File(["x"], "notes.txt");
    expect(normalizeComposerImageFile(unknown)).toBe(unknown);
  });
});

describe("uploadableImage", () => {
  const jpeg = async (): Promise<Blob> => new Blob(["jpeg bytes"], { type: "image/jpeg" });

  test("hands an agent a JPEG for an iPhone's HEIC or HEIF photo", async () => {
    const cases: readonly File[] = [
      new File(["heic bytes"], "IMG_0001.HEIC", { type: "image/heic", lastModified: 7 }),
      new File(["heic bytes"], "IMG_0002.heic", { type: "" }),
      new File(["heif bytes"], "photo.heif", { type: "image/heif" }),
      new File(["heic bytes"], "photo", { type: "image/heic-sequence" }),
      new File(["heif bytes"], "burst", { type: "image/heif-sequence" }),
    ];
    const converted = await Promise.all(cases.map((file) => uploadableImage(file, jpeg)));
    expect(converted.map((file) => [file.name, file.type])).toEqual([
      ["IMG_0001.jpg", "image/jpeg"], ["IMG_0002.jpg", "image/jpeg"], ["photo.jpg", "image/jpeg"], ["photo.jpg", "image/jpeg"], ["burst.jpg", "image/jpeg"],
    ]);
    expect(converted[0]!.lastModified).toBe(7);
    expect(await converted[0]!.text()).toBe("jpeg bytes");
  });

  test("sends the photo as it is when this browser cannot decode it", async () => {
    const photo = new File(["heic bytes"], "IMG_0001.HEIC", { type: "image/heic" });
    expect(await uploadableImage(photo, async () => null)).toBe(photo);
    expect(await uploadableImage(photo, async () => { throw new Error("EncodingError"); })).toBe(photo);
  });

  test("leaves every other file alone without decoding it", async () => {
    const others = [new File(["png"], "shot.png", { type: "image/png" }), new File(["log"], "notes.heic.txt", { type: "text/plain" })];
    const decoded: Blob[] = [];
    for (const file of others) expect(await uploadableImage(file, async (blob) => { decoded.push(blob); return null; })).toBe(file);
    expect(decoded).toEqual([]);
  });
});
