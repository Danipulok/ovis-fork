import { useCallback, useEffect, useState } from "react";
import { LOCAL_MACHINE } from "../../shared/machines.ts";
import type { SpaceFolders } from "../../shared/space-folders.ts";
import { fetchSpaceFolders } from "./api.ts";

/** how often the folders are read again while the page is shown: herdr-app changes them with no event to us */
export const SPACE_FOLDERS_REFRESH_MS = 3_000;
const NONE: SpaceFolders = { list: [], of: {}, colors: {} };

/**
 * herdr-app's sidebar folders (shared/space-folders.ts) for this PC's roster, read when it mounts, when
 * the page is shown again and every 3 s; another PC's roster has none, since the file is on this disk.
 */
export function useSpaceFolders(machineId: string, online: boolean): SpaceFolders {
  const [folders, setFolders] = useState<SpaceFolders>(NONE);
  const shown = machineId === LOCAL_MACHINE && online;

  const read = useCallback((signal?: AbortSignal) => {
    fetchSpaceFolders(signal).then(setFolders, () => { /* no folders this time: the next read tries again */ });
  }, []);

  useEffect(() => {
    if (!shown) { setFolders(NONE); return; }
    const controller = new AbortController();
    read(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === "visible") read(); }, SPACE_FOLDERS_REFRESH_MS);
    const onVisible = (): void => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [shown, read]);

  return folders;
}
