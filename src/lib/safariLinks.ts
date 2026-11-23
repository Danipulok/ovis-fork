/**
 * The iPhone and iPad Home Screen web app opens a link to another site in a view of its own, where
 * the user is signed in nowhere. Safari's own scheme, `x-safari-https:`, hands the address to Safari
 * instead; Apple does not document it.
 * https://christiantietze.de/posts/2023/05/safari-for-mac-url-scheme/
 */
import { inNativeApp, onIos } from "./nativeApp.ts";

export interface LinkEnvironment {
  userAgent: string;
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
  return onIos(env) && env.standalone === true && !inNativeApp();
}

/** The address a link opens: Safari's scheme for another site's https address in the iOS Home Screen app, else the address itself. */
export function safariAddress(uri: string, env: LinkEnvironment = linkEnvironment()): string {
  if (!inIosHomeScreenApp(env) || !/^https:\/\//i.test(uri)) return uri;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }

  return url.origin === env.origin ? uri : `x-safari-${url.href}`;
}
