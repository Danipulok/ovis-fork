/**
 * herdr-app's sidebar folders (the `folders` mod), as `~/.config/herdr-space-folders.json` keeps them:
 * `{ list: [{ id, name, match }], of: { workspaceId: folderId | "" } }`. A workspace goes where it was
 * dragged (`""` is out of every folder), else to the folder whose `match` rules reach deepest into the
 * folder it works in. GET /api/space-folders reads the file (server/space-folders.ts), and the sidebar
 * names a workspace in a folder `<folder> / <workspace>`.
 * The matching is a port of the mod's `rule`, `reach`, `deepest` and `folderOf`:
 * https://github.com/Danipulok/herdr-mods/blob/6d95261a9d60e3e533487d21bd43ce9e1f748877/mods/folders/main.js#L140-L174
 */
export interface SpaceFolder { id: string; name: string; match: string }
/** `colors`: a workspace id's avatar color, an `ansiN` name or a `#hex`, as herdr-app keeps them in `space.colors` */
export interface SpaceFolders { list: SpaceFolder[]; of: Record<string, string>; colors: Record<string, string> }

const MAX_FOLDERS = 200;
const MAX_TEXT_LENGTH = 1000;
const COLOR_NAME = /^(?:ansi\d{1,2}|#[0-9a-fA-F]{3,8})$/;

const text = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_TEXT_LENGTH;

function folderOfRaw(raw: unknown): SpaceFolder | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { id, name, match } = raw as Record<string, unknown>;
  if (!text(id) || id === "" || !text(name)) return null;
  return { id, name, match: text(match) ? match : "" };
}

/** The folders and assignments of a file or an answer, cut to their fields; empty when the shape is wrong. */
export function spaceFoldersOf(raw: unknown): SpaceFolders {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { list: [], of: {}, colors: {} };
  const { list, of, colors } = raw as Record<string, unknown>;
  const folders = Array.isArray(list) ? list.slice(0, MAX_FOLDERS).flatMap((entry) => folderOfRaw(entry) ?? []) : [];
  const assigned = typeof of === "object" && of !== null && !Array.isArray(of)
    ? Object.fromEntries(Object.entries(of).filter((entry): entry is [string, string] => text(entry[1])))
    : {};
  const painted = typeof colors === "object" && colors !== null && !Array.isArray(colors)
    ? Object.fromEntries(Object.entries(colors).filter((entry): entry is [string, string] => typeof entry[1] === "string" && COLOR_NAME.test(entry[1])))
    : {};
  return { list: folders, of: assigned, colors: painted };
}

/**
 * A rule takes a folder and everything in it: "~" is any home, "*" any one folder name, and a rule
 * starting with neither "/" nor "~" is a folder name at any depth ("web").
 */
export function rule(pattern: string): RegExp | null {
  const trimmed = pattern.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const body = trimmed.replace(/^~/, "\u0000").split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")
    .replace("\u0000", "(?:/home/[^/]+|/Users/[^/]+|/root)");
  return new RegExp(`${/^[/~]/.test(trimmed) ? "^" : "(?:^|/)"}${body}(?:/|$)`);
}

/** How deep into the path a folder's rules reach: 0 when none match. */
const reach = (folder: SpaceFolder, path: string | null): number => !path ? 0 : Math.max(0, ...folder.match.split(",").map((pattern) => {
  const found = rule(pattern)?.exec(path);
  return found ? 1 + found.index + found[0].replace(/\/$/, "").length : 0;
}));

/** The folder whose rules reach deepest; the first one on a tie. */
function deepest(list: SpaceFolder[], score: (folder: SpaceFolder) => number): string | null {
  let best: SpaceFolder | null = null;
  let most = 0;
  for (const folder of list) {
    const depth = score(folder);
    if (depth > most) { best = folder; most = depth; }
  }
  return best?.id ?? null;
}

/**
 * The folder a workspace goes in, null for none. `place` is the folder it works in: the mod reads its
 * first terminal's live folder, else the folder the space was made in, which Ovis does not see, so a
 * workspace with no pane folder is placed by `of` alone.
 */
export function folderOf(workspaceId: string, { list, of }: SpaceFolders, place: string | null): string | null {
  const id = of[workspaceId];
  if (id !== undefined) return list.some((folder) => folder.id === id) ? id : null;
  return deepest(list, (folder) => reach(folder, place));
}

/**
 * What a folder's stored color name looks like, as the mod paints it:
 * https://github.com/Danipulok/herdr-mods/blob/87daa79826fe94fc7cdfa2fd091101d7f2254c67/mods/folders/main.js#L243
 */
export const FOLDER_COLORS: Readonly<Record<string, string>> = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

/** A workspace avatar's fill: a `#hex` as it is, an `ansiN` name through the mod's table, `ansi6` when unset or unknown. */
export const spaceColor = (name: string | undefined): string => name?.startsWith("#") ? name : FOLDER_COLORS[name ?? ""] ?? FOLDER_COLORS["ansi6"]!;
