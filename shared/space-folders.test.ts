import { describe, expect, it } from "bun:test";
import { folderOf, rule, spaceColor, spaceFoldersOf, type SpaceFolders } from "./space-folders.ts";

const folders: SpaceFolders = {
  list: [
    { id: "code", name: "code", match: "~/Code/*" },
    { id: "client", name: "client", match: "~/Code/Client/app/*, ~/Notes" },
    { id: "web", name: "web", match: "web" },
  ],
  of: { dragged: "code", out: "", gone: "deleted-folder" },
  colors: {},
};

describe("herdr-app's sidebar folders", () => {
  it.each([
    ["~/Code/*", "/home/someone/Code/app", true],
    ["~/Code/*", "/Users/someone/Code/app/src", true],
    ["~/Code/*", "/home/someone/Code", false],
    ["~/Code/*", "/srv/home/someone/Code/app", false],
    ["web", "/srv/sites/web/app", true],
    ["web", "/srv/sites/webapp", false],
    ["web", "/srv/sites/myweb", false],
    ["/srv/", "/srv", true],
  ])("rule %p matches %p: %p", (pattern, path, matches) => {
    expect(rule(pattern)?.test(path)).toBe(matches);
  });

  it("an empty rule matches nothing", () => {
    expect(rule("  ")).toBeNull();
  });

  it("places a workspace where it was dragged, else in the folder whose rule reaches deepest", () => {
    expect(folderOf("dragged", folders, "/home/someone/Code/Client/app/x")).toBe("code");
    expect(folderOf("out", folders, "/home/someone/Code/app")).toBeNull();
    expect(folderOf("gone", folders, "/home/someone/Code/app")).toBeNull();
    expect(folderOf("new", folders, "/home/someone/Code/Client/app/x")).toBe("client");
    expect(folderOf("new", folders, "/home/someone/Code/other")).toBe("code");
    expect(folderOf("new", folders, "/home/someone/Notes")).toBe("client");
    expect(folderOf("new", folders, "/srv/web")).toBe("web");
    expect(folderOf("new", folders, "/srv/other")).toBeNull();
    expect(folderOf("new", folders, null)).toBeNull();
  });

  it("the first folder wins a tie", () => {
    const tied: SpaceFolders = { list: [{ id: "a", name: "a", match: "~/Code/*" }, { id: "b", name: "b", match: "~/Code/*" }], of: {}, colors: {} };
    expect(folderOf("new", tied, "/home/someone/Code/app")).toBe("a");
  });

  it("cuts a file to its fields and drops what has the wrong shape", () => {
    expect(spaceFoldersOf({ list: [{ id: "a", name: "A", folded: true, match: "x", color: "ansi4", path: "~/x" }, { id: "b", name: "B", folded: "yes" }, { name: "no id" }, 7], of: { sp1: "a", sp2: 3 }, colors: { sp1: "ansi3", sp2: "#5b8def", sp3: "red;background:url(x)", sp4: 4 }, at: 1 }))
      .toEqual({ list: [{ id: "a", name: "A", match: "x" }, { id: "b", name: "B", match: "" }], of: { sp1: "a" }, colors: { sp1: "ansi3", sp2: "#5b8def" } });
    expect(spaceFoldersOf(null)).toEqual({ list: [], of: {}, colors: {} });
    expect(spaceFoldersOf([])).toEqual({ list: [], of: {}, colors: {} });
  });

  it("fills an avatar from a `#hex` as it is, an `ansiN` name through the mod's table, and `ansi6` otherwise", () => {
    expect([spaceColor("#123456"), spaceColor("ansi3"), spaceColor("ansi9"), spaceColor(undefined)]).toEqual(["#123456", "#e3814f", "#22a99a", "#22a99a"]);
  });
});
