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

const HEIC_TYPES: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);
const HEIC_NAME = /\.(heic|heif)$/i;
const HEIF_STILL_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "mif1", "heif"]);
const HEIF_SEQUENCE_BRANDS: ReadonlySet<string> = new Set(["msf1", "hevc", "hevx", "hevs", "avis"]);
/** A 48 MP iPhone photo is a 190 MB canvas, near iOS's 8192 by 8192 limit; 4096 a side keeps it at 64 MB.
 *  https://github.com/WebKit/WebKit/blob/09c9c87594bc34ed7d62db836b29091798073eb8/Source/WebCore/html/CanvasBase.cpp#L119-L131 */
const MAX_JPEG_SIDE = 4096;

function brandAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

/**
 * Inspects an ISO-BMFF `ftyp` header and returns true only for still HEIC/HEIF images.
 * Animated sequences (e.g. `msf1`, `hevc`, `hevs`) return false even when they also list `heic`,
 * and non-HEIF payloads (such as a PNG renamed `.heic`) return false.
 */
export function isStillHeifContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  if (brandAt(bytes, 4) !== "ftyp") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(0, false);
  const end = declared === 0 ? bytes.byteLength : Math.min(bytes.byteLength, declared);
  if (end < 16) return false;
  const brands = [brandAt(bytes, 8)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(brandAt(bytes, offset));
  if (brands.some((brand) => HEIF_SEQUENCE_BRANDS.has(brand))) return false;
  return brands.some((brand) => HEIF_STILL_BRANDS.has(brand));
}

/** Decodes an image this browser can draw and encodes it as JPEG; null when the canvas refuses. */
async function canvasJpeg(image: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(image);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    if (element.naturalWidth <= 0 || element.naturalHeight <= 0) return null;

    const scale = Math.min(1, MAX_JPEG_SIDE / Math.max(element.naturalWidth, element.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob !== null && blob.size > 0 && blob.type === "image/jpeg" ? blob : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An iPhone's HEIC or HEIF photo as a JPEG, since the agents read only PNG, JPEG, GIF and WebP
 * (https://platform.claude.com/docs/en/build-with-claude/vision); any other file, or one this browser
 * cannot decode, as it is. Animated HEIC/HEIF sequences, non-HEIF payloads, and explicit non-HEIC MIME types stay untouched.
 */
export async function uploadableImage<T extends Blob>(file: T, toJpeg: (image: Blob) => Promise<Blob | null> = canvasJpeg): Promise<T | File> {
  const name = file instanceof File ? file.name : "";
  const normalizedType = file.type.toLowerCase().split(";", 1)[0]!.trim();
  const heicCandidate = HEIC_TYPES.has(normalizedType)
    || ((normalizedType === "" || normalizedType === "application/octet-stream") && HEIC_NAME.test(name));
  if (!heicCandidate) return file;

  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (!isStillHeifContainer(header)) return file;

  const jpeg = await toJpeg(file).catch(() => null);
  if (jpeg === null) return file;

  const base = HEIC_NAME.test(name) ? name.replace(HEIC_NAME, "") : name || "photo";
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg", lastModified: file instanceof File ? file.lastModified : Date.now() });
}
