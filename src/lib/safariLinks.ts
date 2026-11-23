/**
 * The iPhone and iPad Home Screen web app opens a link to another site in a view of its own, where
 * the user is signed in nowhere. Safari's own scheme, `x-safari-https:`, hands the address to Safari
 * instead; Apple does not document it.
 * https://christiantietze.de/posts/2023/05/safari-for-mac-url-scheme/
 */
import { inNativeApp } from "./nativeApp.ts";

export interface LinkEnvironment {
  userAgent: string;
  /** iPadOS reports a Mac user agent; touch points tell the two apart */
  maxTouchPoints: number;
  standalone: boolean | undefined;
  origin: string;
}

function linkEnvironment(): LinkEnvironment {
  if (typeof navigator === "undefined" || typeof location === "undefined") return { userAgent: "", maxTouchPoints: 0, standalone: undefined, origin: "" };

  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: "standalone" in navigator ? navigator.standalone === true : undefined,
    origin: location.origin,
  };
}

function inIosHomeScreenApp(env: LinkEnvironment): boolean {
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  return ios && env.standalone === true && !inNativeApp();
}

/** The address a link opens: Safari's scheme for another site's http(s) address in the iOS Home Screen app, else the address itself. */
export function safariAddress(uri: string, env: LinkEnvironment = linkEnvironment()): string {
  if (!inIosHomeScreenApp(env) || !/^https?:\/\//i.test(uri)) return uri;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }

  return url.origin === env.origin ? uri : `x-safari-${url.href}`;
}

/** A plain click on a link to another site goes to Safari; a click a handler of the app already took is left alone. */
export function safariLinkClick(event: MouseEvent, open: (address: string) => void, env: LinkEnvironment = linkEnvironment()): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (link === null) return;

  const address = safariAddress(link.href, env);
  if (address === link.href) return;

  event.preventDefault();
  open(address);
}

function openAddress(address: string): void {
  const link = document.createElement("a");
  link.href = address;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

export function watchSafariLinks(): () => void {
  const onClick = (event: MouseEvent): void => safariLinkClick(event, openAddress);
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
