import { describe, expect, test } from "bun:test";
import { composerImageMimeType, normalizeComposerImageFile, uploadableImage, withoutJpegMetadata } from "./composerImageMime.ts";

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

const segment = (marker: number, body: readonly number[]): number[] => [0xff, marker, 0, body.length + 2, ...body];
const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
const icc = segment(0xe2, [1, 2, 3]);
const scan = [...segment(0xda, [9, 9]), 0x11, 0xff, 0xe1, 0x22, 0xff, 0xd9];
const withoutMetadataBytes: number[] = [0xff, 0xd8, ...jfif, ...icc, ...scan];
const jpegBytes: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, ...jfif, ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 7]), ...icc, ...segment(0xed, [8, 8]), ...scan]);

describe("withoutJpegMetadata", () => {
  test("drops APP1 and APP13, keeps every other segment and the scan byte for byte", async () => {
    const stripped = await withoutJpegMetadata(new Blob([jpegBytes], { type: "image/jpeg" }));
    expect([...new Uint8Array(await stripped.arrayBuffer())]).toEqual(withoutMetadataBytes);
  });

  test("leaves bytes that do not open as a JPEG alone", async () => {
    const other = new Blob(["not a jpeg"], { type: "image/jpeg" });
    expect(await withoutJpegMetadata(other)).toBe(other);
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
    ];
    const converted = await Promise.all(cases.map((file) => uploadableImage(file, jpeg)));
    expect(converted.map((file) => [file.name, file.type])).toEqual([
      ["IMG_0001.jpg", "image/jpeg"], ["IMG_0002.jpg", "image/jpeg"], ["photo.jpg", "image/jpeg"], ["photo.jpg", "image/jpeg"],
    ]);
    expect(converted[0]!.lastModified).toBe(7);
    expect(await converted[0]!.text()).toBe("jpeg bytes");
  });

  test("sends the photo as it is when this browser cannot decode it", async () => {
    const photo = new File(["heic bytes"], "IMG_0001.HEIC", { type: "image/heic" });
    expect(await uploadableImage(photo, async () => null)).toBe(photo);
    expect(await uploadableImage(photo, async () => { throw new Error("EncodingError"); })).toBe(photo);
  });

  test("sends every JPEG photo redrawn, which drops its camera metadata, even when that is no smaller", async () => {
    const photo = new File(["x".repeat(4096)], "IMG_3718.jpeg", { type: "image/jpeg", lastModified: 7 });
    const smaller = await uploadableImage(photo, jpeg);
    expect([smaller.name, smaller.type, smaller.lastModified, await smaller.text()]).toEqual(["IMG_3718.jpg", "image/jpeg", 7, "jpeg bytes"]);

    const small = new File(["tiny"], "IMG_3719.jpg", { type: "image/jpeg" });
    expect(await (await uploadableImage(small, jpeg)).text()).toBe("jpeg bytes");
  });

  test("cuts the location, device and date out of a JPEG this browser cannot redraw", async () => {
    const photo = new File([jpegBytes], "IMG_3720.jpg", { type: "image/jpeg", lastModified: 7 });
    const sent = await uploadableImage(photo, async () => null);
    expect([sent.name, sent.type, sent.lastModified]).toEqual(["IMG_3720.jpg", "image/jpeg", 7]);
    expect([...new Uint8Array(await sent.arrayBuffer())]).toEqual(withoutMetadataBytes);
  });

  test("leaves every other file alone without decoding it", async () => {
    const others = [new File(["png"], "shot.png", { type: "image/png" }), new File(["log"], "notes.heic.txt", { type: "text/plain" })];
    const decoded: Blob[] = [];
    for (const file of others) expect(await uploadableImage(file, async (blob) => { decoded.push(blob); return null; })).toBe(file);
    expect(decoded).toEqual([]);
  });
});
