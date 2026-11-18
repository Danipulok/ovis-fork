import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";

import type { SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import type { AppActions } from "../lib/actions.ts";
import { AppLayoutContext, appLayoutOf, ReorderContext } from "../lib/machineContext.tsx";
import { SettingsProvider } from "../lib/settings.ts";
import { inactiveSidebarFilter } from "../lib/sidebarFilter.ts";
import { SidebarFilterProvider } from "../lib/sidebarFilterContext.ts";
import { currentSidebarPins, setSidebarPins } from "../lib/sidebarPins.ts";
import { SETTINGS_STORAGE_KEY } from "../lib/themeBoot.ts";
import { ReorderCoordinator } from "../lib/workspaceOrder.ts";
import type { SpaceFolders } from "../../shared/space-folders.ts";
import { Sidebar } from "./Sidebar.tsx";

const TUI = appLayoutOf({ version: "0.9.5", protocol: 22 });

/** a workspace a launcher tagged `herdr workspace report-metadata --token role=background` */
const workspace = (id: string): WorkspaceInfo =>
  ({ workspace_id: id, label: id, active_tab_id: `${id}:t`, number: 1, tab_count: 1, pane_count: 1, focused: false, agent_status: "idle", worktree: null });
const roster = (workspaces: WorkspaceInfo[], cwd: Record<string, string> = {}): SessionSnapshot => ({
  protocol: 22, version: "test", workspaces, layouts: [], agents: [],
  tabs: workspaces.map((w) => ({ tab_id: w.active_tab_id, workspace_id: w.workspace_id, label: w.label, number: 1, pane_count: 1, focused: false, agent_status: "idle" })),
  panes: workspaces.map((w) => ({ pane_id: `${w.workspace_id}:p`, workspace_id: w.workspace_id, tab_id: w.active_tab_id, terminal_id: `${w.workspace_id}:term`, revision: 1, focused: false,
    agent: "claude", agent_status: "idle", ...(cwd[w.workspace_id] ? { cwd: cwd[w.workspace_id] } : {}) })),
});
const actions = new Proxy({}, { get: () => () => {} }) as AppActions;
const FOLDERS: SpaceFolders = {
  list: [{ id: "f1", name: "client", match: "" }, { id: "f2", name: "code", match: "~/Code/*" }, { id: "f3", name: "empty", match: "" }],
  of: { a: "f1", hidden: "f1", out: "" },
  colors: { a: "ansi3", loose: "#123456" },
};

describe("herdr-app's folders in the sidebar's names", () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let renderer: ReactTestRenderer | undefined;
  let pinsBefore: string[];
  let fetch: ReturnType<typeof spyOn> | undefined;
  let stored: Map<string, string>;

  beforeEach(() => {
    for (const key of ["window", "document", "navigator", "getComputedStyle", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    stored = new Map<string, string>();
    const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
    const events = new EventTarget();
    const media = { matches: false, addEventListener() {}, removeEventListener() {} };
    const define = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("localStorage", storage);
    define("navigator", { languages: ["en-US"], platform: "Linux" });
    define("window", { localStorage: storage, matchMedia: () => media, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout });
    define("document", { visibilityState: "visible", activeElement: null, documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, querySelector: () => null, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    define("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/space-folders")) return Response.json(FOLDERS);
      return Response.json({ error: "not_found" }, { status: 404 });
    }, { preconnect: globalThis.fetch.preconnect }));
    pinsBefore = currentSidebarPins();
    setSidebarPins([]);
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    fetch?.mockRestore();
    setSidebarPins(pinsBefore);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  async function draw(snapshot: SessionSnapshot, selected: string, layout = TUI): Promise<void> {
    const coordinator = new ReorderCoordinator();
    await act(async () => {
      renderer = create(createElement(SettingsProvider, null, createElement(SidebarFilterProvider, { value: { filter: inactiveSidebarFilter(), reportBranches: () => {} } },
        createElement(AppLayoutContext.Provider, { value: layout }, createElement(ReorderContext.Provider, { value: coordinator },
          createElement(Sidebar, { snapshot, online: true, selectedPaneId: selected, actions }))))));
    });
  }
  const shownRows = () => renderer!.root.findAll((node) => typeof node.type === "string" && typeof node.props["data-workspace"] === "string").map((node) => node.props["data-workspace"] as string);
  const names = () => renderer!.root.findAll((node) => node.type === "span" && node.props.className === "workspace-name").map((node) => node.children.join(""));
  const places = () => renderer!.root.findAll((node) => node.type === "span" && node.props.className === "workspace-place").map((node) => node.children.join(""));
  const folderHeadings = () => renderer!.root.findAll((node) => typeof node.props.className === "string" && node.props.className.includes("workspace-folder"));

  it("names a workspace in a folder after it, `<folder> / <workspace>`, in herdr's order and with no folder headings", async () => {
    await draw(roster([workspace("loose"), workspace("b"), workspace("a"), workspace("out")], { b: "/home/someone/Code/app", out: "/home/someone/Code/other" }), "loose:p");
    expect(shownRows()).toEqual(["loose", "b", "a", "out"]);
    expect(names()).toEqual(["loose", "code / b", "client / a", "out"]);
    expect(folderHeadings()).toEqual([]);
  });

  it("puts the folder on the line that names the workspace, on two-line rows", async () => {
    stored.set(SETTINGS_STORAGE_KEY, JSON.stringify({ sidebarRows: "two" }));
    const snapshot = roster([workspace("a"), workspace("hidden"), workspace("b")], { a: "/srv/a" });
    const titled = { a: { title: "a" }, hidden: { label: "fix login" }, b: { label: "write docs" } } as const;
    await draw({ ...snapshot, panes: snapshot.panes.map((pane) => ({ ...pane, ...titled[pane.workspace_id as keyof typeof titled] })) }, "a:p");
    expect(names()).toEqual(["client / a", "client / hidden", "b"]);
    expect(places()).toEqual(["fix login", "write docs"]);
  });

  it("drops a branch that only repeats the name from the end of a compact row in a folder", async () => {
    const checkout = { checkout_path: "/srv/login-page", is_linked_worktree: false, repo_key: "repo", repo_name: "login-page", repo_root: "/srv/login-page" };
    const listing = { source: { repo_key: "repo", repo_name: "login-page", repo_root: "/srv/login-page", source_checkout_path: "/srv/login-page", source_workspace_id: "login-page" },
      worktrees: [{ path: "/srv/login-page", branch: "feat/login-page", label: "login-page", is_linked_worktree: false, is_bare: false, is_detached: false, is_prunable: false, open_workspace_id: "login-page" }] };
    fetch!.mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/space-folders")) return Response.json({ ...FOLDERS, of: { "login-page": "f1" } });
      if (url.includes("/api/worktree/inventory")) return Response.json({ entries: [{ workspace_id: "login-page", listing }] });
      return Response.json({ error: "not_found" }, { status: 404 });
    }, { preconnect: globalThis.fetch.preconnect }));
    await draw(roster([{ ...workspace("login-page"), worktree: checkout }]), "login-page:p");
    const deadline = Date.now() + 5_000;
    while (!fetch!.mock.calls.some((call: unknown[]) => String(call[0]).includes("/api/worktree/inventory"))) {
      if (Date.now() > deadline) throw new Error("the sidebar never read the branches");
      await Bun.sleep(10);
    }
    await act(async () => {});

    const tails = renderer!.root.findAll((node) => node.type === "span" && node.props.className === "workspace-branch-tail").map((node) => node.children.join(""));
    expect([names(), tails]).toEqual([["client / login-page"], []]);
  });

  it("leads each workspace with herdr-app's avatar, its first letter on its color, `ansi6` when it has none", async () => {
    await draw(roster([workspace("a"), workspace("loose"), workspace("out")]), "loose:p");
    const avatars = renderer!.root.findAll((node) => node.type === "span" && node.props.className === "workspace-avatar-tile")
      .map((node) => `${node.children.join("")} ${(node.props.style as { backgroundColor: string }).backgroundColor}`);
    expect(avatars).toEqual(["A #e3814f", "L #123456", "O #22a99a"]);
  });

  it("names no folder without a folders file", async () => {
    fetch!.mockImplementation(Object.assign(async () => Response.json({ error: "not_found" }, { status: 404 }), { preconnect: globalThis.fetch.preconnect }));
    await draw(roster([workspace("a"), workspace("loose")]), "loose:p");
    expect(names()).toEqual(["a", "loose"]);
  });
});
