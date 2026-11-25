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
  const ftyp = (major: string, compat: readonly string[] = []): Uint8Array<ArrayBuffer> => {
    const size = 16 + compat.length * 4;
    const bytes = new Uint8Array(new ArrayBuffer(size));
    new DataView(bytes.buffer).setUint32(0, size, false);
    const write = (offset: number, fourcc: string) => {
      for (let i = 0; i < 4; i++) bytes[offset + i] = fourcc.charCodeAt(i);
    };
    write(4, "ftyp");
    write(8, major);
    compat.forEach((brand, index) => write(16 + index * 4, brand));
    return bytes;
  };
  const STILL_HEIC = ftyp("heic", ["mif1", "heic"]);
  const STILL_HEIF = ftyp("mif1", ["mif1", "heif"]);
  const ANIMATED_HEIC = ftyp("msf1", ["msf1", "heic", "hevc"]);
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

  test("hands an agent a JPEG for an iPhone's HEIC or HEIF photo", async () => {
    const cases: readonly File[] = [
      new File([STILL_HEIC], "IMG_0001.HEIC", { type: "image/heic", lastModified: 7 }),
      new File([STILL_HEIC], "IMG_0002.heic", { type: "" }),
      new File([STILL_HEIC], "IMG_0003.HEIC", { type: "application/octet-stream" }),
      new File([STILL_HEIF], "photo.heif", { type: "image/heif" }),
    ];
    const converted = await Promise.all(cases.map((file) => uploadableImage(file, jpeg)));
    expect(converted.map((file) => [file.name, file.type])).toEqual([
      ["IMG_0001.jpg", "image/jpeg"], ["IMG_0002.jpg", "image/jpeg"], ["IMG_0003.jpg", "image/jpeg"], ["photo.jpg", "image/jpeg"],
    ]);
    expect(converted[0]!.lastModified).toBe(7);
    expect(await converted[0]!.text()).toBe("jpeg bytes");
  });

  test("preserves animated HEIC/HEIF sequences without collapsing frames, even when declared as image/heic or unnamed MIME", async () => {
    const sequences = [
      new File([ANIMATED_HEIC], "sticker.heics", { type: "image/heic-sequence" }),
      new File([ANIMATED_HEIC], "animated.heic", { type: "image/heic-sequence" }),
      new File([ANIMATED_HEIC], "burst.heif", { type: "image/heif-sequence" }),
      new File([ANIMATED_HEIC], "sticker.heics", { type: "image/heic" }),
      new File([ANIMATED_HEIC], "sticker.heic", { type: "" }),
    ];
    const decoded: Blob[] = [];
    for (const file of sequences) {
      expect(await uploadableImage(file, async (blob) => { decoded.push(blob); return jpeg(); })).toBe(file);
    }
    expect(decoded).toEqual([]);
  });

  test("sends the photo as it is when this browser cannot decode it", async () => {
    const photo = new File([STILL_HEIC], "IMG_0001.HEIC", { type: "image/heic" });
    expect(await uploadableImage(photo, async () => null)).toBe(photo);
    expect(await uploadableImage(photo, async () => { throw new Error("EncodingError"); })).toBe(photo);
  });

  test("leaves non-HEIF payloads and other files alone without decoding them", async () => {
    const others = [
      new File([PNG_BYTES], "shot.png", { type: "image/png" }),
      new File([PNG_BYTES], "renamed.heic", { type: "image/png" }),
      new File([PNG_BYTES], "renamed.heic", { type: "application/octet-stream" }),
      new File([PNG_BYTES], "renamed.heic", { type: "" }),
      new File(["log"], "notes.heic.txt", { type: "text/plain" }),
    ];
    const decoded: Blob[] = [];
    for (const file of others) expect(await uploadableImage(file, async (blob) => { decoded.push(blob); return jpeg(); })).toBe(file);
    expect(decoded).toEqual([]);
  });
});
