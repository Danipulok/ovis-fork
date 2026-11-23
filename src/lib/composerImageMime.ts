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
/** A 48 MP iPhone photo is a 190 MB canvas, near iOS's 8192 by 8192 limit; 4096 a side keeps it at 64 MB.
 *  https://github.com/WebKit/WebKit/blob/09c9c87594bc34ed7d62db836b29091798073eb8/Source/WebCore/html/CanvasBase.cpp#L119-L131 */
const MAX_JPEG_SIDE = 4096;

/** Decodes an image this browser can draw and encodes it as JPEG; null when the canvas refuses. */
async function canvasJpeg(image: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(image);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();

    const scale = Math.min(1, MAX_JPEG_SIDE / Math.max(element.naturalWidth, element.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.naturalWidth * scale);
    canvas.height = Math.round(element.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An iPhone's HEIC or HEIF photo as a JPEG, since the agents read only PNG, JPEG, GIF and WebP
 * (https://platform.claude.com/docs/en/build-with-claude/vision); any other file, or one this browser
 * cannot decode, as it is.
 */
export async function uploadableImage<T extends Blob>(file: T, toJpeg: (image: Blob) => Promise<Blob | null> = canvasJpeg): Promise<T | File> {
  const name = file instanceof File ? file.name : "";
  if (!HEIC_TYPES.has(file.type.toLowerCase()) && !HEIC_NAME.test(name)) return file;

  const jpeg = await toJpeg(file).catch(() => null);
  if (jpeg === null) return file;

  const base = HEIC_NAME.test(name) ? name.replace(HEIC_NAME, "") : name || "photo";
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg", lastModified: file instanceof File ? file.lastModified : Date.now() });
}
