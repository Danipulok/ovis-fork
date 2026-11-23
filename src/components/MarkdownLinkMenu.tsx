/**
 * A long press on a rendered Markdown link in the Android app and the iOS Home Screen app opens the
 * phone's link sheet; why and how: DESIGN.md, Markdown.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Share2 } from "lucide-react";

import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from "./TabStrip.tsx";
import { copyText } from "../lib/clipboard.ts";
import { useT } from "../lib/i18n.ts";
import { inAndroidApp } from "../lib/nativeApp.ts";
import { inIosHomeScreenApp } from "../lib/safariLinks.ts";
import { useSettings } from "../lib/settings.ts";
import { openExternal } from "../lib/externalLink.ts";

export function pressedLink(event: MouseEvent): HTMLAnchorElement | null {
  // Android ends a dragged text selection with a contextmenu typed "mouse": that is the selection's, not the link's
  if ((event as Partial<PointerEvent>).pointerType === "mouse") return null;
  return event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".markdown a[href]") : null;
}

/** The address's host, or "" for one no URL parser takes (an older WebView has no URL.canParse). */
function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return "";
  }
}

export function MarkdownLinkMenu() {
  const t = useT();
  const { settings } = useSettings();
  const [pressed, setPressed] = useState<{ link: HTMLAnchorElement; point: { x: number; y: number } } | null>(null);
  const close = useCallback(() => setPressed(null), []);
  useEffect(() => {
    if (!inAndroidApp()) return;
    const onContextMenu = (event: MouseEvent): void => {
      const link = pressedLink(event);
      if (link === null) return;
      // the WebView would select the link's words instead, which copies them and not the address
      event.preventDefault();
      setPressed({ link, point: { x: event.clientX, y: event.clientY } });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
  useEffect(() => {
    if (!inIosHomeScreenApp()) return;
    // iOS fires no contextmenu for a touch: https://bugs.webkit.org/show_bug.cgi?id=213953
    const root = document.documentElement;
    root.toggleAttribute("data-ios-link-menu", true);
    let held: { x: number; y: number; timer: number } | null = null;
    let opened: HTMLAnchorElement | null = null;
    const cancel = (): void => {
      if (held !== null) window.clearTimeout(held.timer);
      held = null;
    };
    const onDown = (event: PointerEvent): void => {
      cancel();
      opened = null;
      if (event.pointerType !== "touch" || !event.isPrimary) return;

      const link = pressedLink(event);
      if (link === null) return;

      const point = { x: event.clientX, y: event.clientY };
      held = { ...point, timer: window.setTimeout(() => {
        held = null;
        opened = link;
        setPressed({ link, point });
      }, LONG_PRESS_MS) };
    };
    const onMove = (event: PointerEvent): void => {
      if (held !== null && Math.hypot(event.clientX - held.x, event.clientY - held.y) > LONG_PRESS_SLOP) cancel();
    };
    // a lift may still click the link, which would open it under its own sheet
    const onClick = (event: MouseEvent): void => {
      if (opened === null || !(event.target instanceof Node) || !opened.contains(event.target)) return;
      opened = null;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", cancel);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("click", onClick, true);
    return () => {
      cancel();
      root.removeAttribute("data-ios-link-menu");
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  if (pressed === null) return null;
  const { link, point } = pressed;
  const href = link.href;
  const text = link.textContent?.trim() ?? "";
  // Markdown links any address it reads, one no URL parser takes (port 99999) included
  const title = text !== "" && text !== href ? text : hostOf(href) || href;
  const items: RowMenuItem[] = [
    { id: "copy", label: t("Copy link"), icon: Link2, run: () => { void copyText(href); } },
    { id: "open", label: t("Open link"), icon: ExternalLink, run: () => {
      if (link.isConnected) link.click();
      else openExternal(href, "link", settings.reuseExternalLinkTab);
    } },
    ...(typeof navigator.share === "function" ? [{ id: "share", label: t("Share link"), icon: Share2, run: () => {
      // the share sheet rejects when the user closes it: nothing to tell them
      navigator.share({ url: href }).catch(() => undefined);
    } }] : []),
  ];
  return <RowMenu anchor={link} point={point} restoreFocusTo={null} title={title} detail={title === href ? undefined : href} items={items} onClose={close} />;
}
