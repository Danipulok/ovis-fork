/**
 * GET /api/space-folders: herdr-app's sidebar folders (shared/space-folders.ts) read from the file its
 * `folders` mod keeps, with the workspaces' avatar colors, herdr-app's `space.colors` in
 * `~/.config/herdr-app/shared.json`. A server whose panes are on another machine has no such files
 * (`paths` null): no folders and no colors.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spaceFoldersOf } from "../shared/space-folders.ts";
import { jsonResponse } from "./http.ts";

export const spaceFoldersPath = (home = homedir()): string => join(home, ".config", "herdr-space-folders.json");
export const spaceColorsPath = (home = homedir()): string => join(home, ".config", "herdr-app", "shared.json");

export interface SpaceFilesPaths { folders: string; colors: string }

/** The file as JSON; null when there is none or it does not parse. */
function readFile(path: string | null): Record<string, unknown> | null {
  if (path === null) return null;

  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

export function handleSpaceFoldersRequest(request: Request, pathname: string, paths: SpaceFilesPaths | null): Response {
  const reply = (body: unknown, status = 200) => jsonResponse(body, status, { "cache-control": "no-store" });
  if (pathname !== "/api/space-folders") return reply({ error: { code: "not_found", message: "Unknown space-folders route" } }, 404);
  if (request.method !== "GET") return reply({ error: { code: "method_not_allowed", message: "Use GET /api/space-folders" } }, 405);

  return reply(spaceFoldersOf({ ...readFile(paths?.folders ?? null), colors: readFile(paths?.colors ?? null)?.["space.colors"] }));
}
