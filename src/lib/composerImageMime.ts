const IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function composerImageMimeType(name: string, type: string): string | null {
  const normalizedType = type.toLowerCase();
  if (normalizedType !== "" && normalizedType !== "application/octet-stream") return null;

  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  return IMAGE_MIME_TYPE_BY_EXTENSION[name.slice(dotIndex + 1).toLowerCase()] ?? null;
}

export function normalizeComposerImageFile(file: File): File {
  const mimeType = composerImageMimeType(file.name, file.type);
  return mimeType === null
    ? file
    : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
}

const HEIC_TYPES: ReadonlySet<string> = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_NAME = /\.(heic|heif)$/i;
/**
 * A phone photo is drawn at most 2048 px a side, about 1 MB as JPEG, so it goes over the relay at
 * once: OpenAI scales a longer side down to 2048 anyway
 * (https://developers.openai.com/api/docs/guides/images-vision), Claude to 2576 on its newest models
 * and 1568 on the rest (https://platform.claude.com/docs/en/build-with-claude/vision). A whole
 * 48 MP photo is also a 190 MB canvas, past what iOS draws.
 * https://github.com/WebKit/WebKit/blob/09c9c87594bc34ed7d62db836b29091798073eb8/Source/WebCore/html/CanvasBase.cpp#L119-L131
 */
const MAX_PHOTO_SIDE = 2048;

/** Decodes an image this browser can draw and encodes it as JPEG; null when the canvas refuses. */
async function canvasJpeg(image: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(image);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();

    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(element.naturalWidth, element.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.naturalWidth * scale);
    canvas.height = Math.round(element.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const JPEG_START = 0xd8;
const JPEG_SCAN = 0xda;
/** APP1 holds Exif and XMP (location, device, date), APP13 IPTC: https://exiftool.org/TagNames/JPEG.html */
const JPEG_METADATA: ReadonlySet<number> = new Set([0xe1, 0xed]);

/** The JPEG's bytes without its APP1 and APP13 segments; anything that does not open as a JPEG as it is. */
export async function withoutJpegMetadata<T extends Blob>(file: T): Promise<T | Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== JPEG_START) return file;

  const kept: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] !== JPEG_SCAN) {
    const end = offset + 2 + ((bytes[offset + 2]! << 8) | bytes[offset + 3]!);
    if (!JPEG_METADATA.has(bytes[offset + 1]!)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }

  kept.push(bytes.subarray(offset));
  return new Blob(kept, { type: file.type });
}

/**
 * A phone photo as a JPEG of at most `MAX_PHOTO_SIDE` a side: an iPhone's HEIC or HEIF one always,
 * since the agents read only PNG, JPEG, GIF and WebP
 * (https://platform.claude.com/docs/en/build-with-claude/vision), a JPEG one too, which drops its
 * camera metadata; a JPEG this browser cannot redraw loses that metadata from its bytes instead. Any
 * other file (a screenshot's PNG), or a HEIC one this browser cannot decode, as it is.
 */
export async function uploadableImage<T extends Blob>(file: T, toJpeg: (image: Blob) => Promise<Blob | null> = canvasJpeg): Promise<T | File> {
  const name = file instanceof File ? file.name : "";
  const lastModified = file instanceof File ? file.lastModified : Date.now();
  const heic = HEIC_TYPES.has(file.type.toLowerCase()) || HEIC_NAME.test(name);
  if (!heic && file.type.toLowerCase() !== "image/jpeg") return file;

  const jpeg = await toJpeg(file).catch(() => null);
  if (jpeg === null && heic) return file;

  if (jpeg === null) return new File([await withoutJpegMetadata(file)], name, { type: file.type, lastModified });

  const base = HEIC_NAME.test(name) ? name.replace(HEIC_NAME, "") : name.replace(/\.(jpe?g)$/i, "") || "photo";
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg", lastModified });
}
