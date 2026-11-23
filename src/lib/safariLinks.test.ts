import { describe, expect, it } from "bun:test";
import { safariAddress, safariLinkClick, type LinkEnvironment } from "./safariLinks.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";
const homeScreen: LinkEnvironment = { userAgent: IPHONE, maxTouchPoints: 5, standalone: true, origin: "https://ovis.example.com" };

describe("safariAddress", () => {
  it("hands another site's address to Safari in the iPhone and iPad Home Screen app", () => {
    expect(safariAddress("https://gitlab.com/group/project/-/issues/7", homeScreen)).toBe("x-safari-https://gitlab.com/group/project/-/issues/7");
    expect(safariAddress("HTTP://example.org/a?b=1#c", homeScreen)).toBe("x-safari-http://example.org/a?b=1#c");
    expect(safariAddress("https://gitlab.com/", { ...homeScreen, userAgent: IPAD })).toBe("x-safari-https://gitlab.com/");
  });

  it("keeps the app's own pages in the app, and every address but http(s) as it is", () => {
    expect(safariAddress("https://ovis.example.com/settings", homeScreen)).toBe("https://ovis.example.com/settings");
    for (const uri of ["mailto:user@example.com", "file:///tmp/a.txt", "https://example.org:99999/"]) expect(safariAddress(uri, homeScreen)).toBe(uri);
  });

  it("changes nothing in a Safari tab, on a Mac or on Android", () => {
    const uri = "https://gitlab.com/";
    expect(safariAddress(uri, { ...homeScreen, standalone: false })).toBe(uri);
    expect(safariAddress(uri, { ...homeScreen, userAgent: IPAD, maxTouchPoints: 0 })).toBe(uri);
    expect(safariAddress(uri, { ...homeScreen, userAgent: "Mozilla/5.0 (Linux; Android 16) Mobile", standalone: undefined })).toBe(uri);
  });
});

describe("safariLinkClick", () => {
  class FakeLink { constructor(readonly href: string) {} }
  class FakeTarget {
    constructor(private readonly link: FakeLink | null) {}
    closest(): FakeLink | null { return this.link; }
  }
  const saved = globalThis.Element;
  const click = (href: string | null, init: Partial<MouseEvent> = {}): { prevented: boolean; opened: string[] } => {
    Object.defineProperty(globalThis, "Element", { configurable: true, writable: true, value: FakeTarget });
    const opened: string[] = [];
    let prevented = false;
    const event = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init, target: new FakeTarget(href === null ? null : new FakeLink(href)), preventDefault: () => { prevented = true; } } as unknown as MouseEvent;
    try {
      safariLinkClick(event, (address) => opened.push(address), homeScreen);
    } finally {
      Object.defineProperty(globalThis, "Element", { configurable: true, writable: true, value: saved });
    }
    return { prevented, opened };
  };

  it("opens a tapped link to another site in Safari instead of the app's own view", () => {
    expect(click("https://gitlab.com/")).toEqual({ prevented: true, opened: ["x-safari-https://gitlab.com/"] });
  });

  it("leaves the app's own links, taps on no link, a click a handler took and a modified click alone", () => {
    for (const result of [
      click("https://ovis.example.com/x"), click(null), click("https://gitlab.com/", { defaultPrevented: true }),
      click("https://gitlab.com/", { button: 1 }), click("https://gitlab.com/", { metaKey: true }),
    ]) expect(result).toEqual({ prevented: false, opened: [] });
  });
});
