import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";

import { SettingsProvider } from "../lib/settings.ts";
import { KeyId } from "./KeyId.tsx";
import { CompactRelay } from "./RelayPanel.tsx";

const SERVER_ID = "c".repeat(32);

describe("the compact pairing window", () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let renderer: ReactTestRenderer | undefined;
  let fetch: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    for (const key of ["window", "document", "navigator", "localStorage", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const stored = new Map<string, string>();
    const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
    const events = new EventTarget();
    const media = { matches: false, addEventListener() {}, removeEventListener() {} };
    const define = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    define("IS_REACT_ACT_ENVIRONMENT", true);
    define("localStorage", storage);
    define("navigator", { languages: ["en-US"], platform: "Linux" });
    define("window", { localStorage: storage, matchMedia: () => media, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), setTimeout, clearTimeout });
    define("document", { visibilityState: "visible", querySelector: () => null, documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    define("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ code: "AB3DE7FGH", expires_at: new Date(Date.now() + 600_000).toISOString(), server_id: SERVER_ID }), { preconnect: globalThis.fetch.preconnect }));
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    fetch?.mockRestore();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  it("shows this PC's ID under the code, for the phone's comparison", async () => {
    await act(async () => {
      renderer = create(createElement(SettingsProvider, null, createElement(CompactRelay, { qr: null, qrExpires: null, failure: null, reset: 0, onMinted: () => {} })));
    });

    expect(renderer!.root.findAllByType(KeyId).map((node) => node.props.id)).toEqual([SERVER_ID]);
  });
});
