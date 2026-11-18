import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSpaceFoldersRequest, type SpaceFilesPaths } from "./space-folders.ts";

const roots: string[] = [];
const fileIn = (content: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-space-folders-"));
  roots.push(dir);
  const path = join(dir, "herdr-space-folders.json");
  if (content !== undefined) writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const stored = {
  list: [{ id: "a", name: "A", folded: false, path: "~/A/", match: "~/A/*", color: "ansi4" }, { id: "b", name: "B", folded: true, match: "" }],
  of: { sp1: "a" },
  archive: [{ id: "old" }],
  colors: { sp1: "ansi3" },
  at: 100,
};
/** herdr-app's shared state beside the folders file: no colors unless a test writes them */
const paths = (path: string | null): SpaceFilesPaths | null => path === null ? null : { folders: path, colors: join(path, "..", "shared.json") };
const get = (path: string | null) => handleSpaceFoldersRequest(new Request("http://x/api/space-folders"), "/api/space-folders", paths(path));

describe("/api/space-folders", () => {
  it("answers the file's folders and assignments", async () => {
    const response = get(fileIn(stored));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ list: [{ id: "a", name: "A", match: "~/A/*" }, { id: "b", name: "B", match: "" }], of: { sp1: "a" }, colors: {} });
  });

  it("answers no folders for a missing file, one that does not parse, and a server whose panes are elsewhere", async () => {
    for (const path of [fileIn(undefined), fileIn("{not json"), null]) expect(await get(path).json()).toEqual({ list: [], of: {}, colors: {} });
  });

  it("answers herdr-app's avatar colors in place of the file's own", async () => {
    const path = fileIn(stored);
    writeFileSync(join(path, "..", "shared.json"), JSON.stringify({ layout: {}, "space.colors": { sp1: "ansi5", sp2: "#3fae6a", sp3: 7 } }));
    expect((await get(path).json()).colors).toEqual({ sp1: "ansi5", sp2: "#3fae6a" });
    expect((await get(fileIn(undefined)).json()).colors).toEqual({});
  });

  it("takes GET only, and no write routes", () => {
    expect(handleSpaceFoldersRequest(new Request("http://x/api/space-folders", { method: "POST" }), "/api/space-folders", null).status).toBe(405);
    for (const route of ["/api/space-folders/fold", "/api/space-folders/place"]) expect(handleSpaceFoldersRequest(new Request(`http://x${route}`, { method: "POST" }), route, null).status).toBe(404);
  });
});
