"use client";

/**
 * Thin React wrapper around the pure `createAutosaveScheduler` (Phase 11 §7.2). Owns the
 * `useSyncExternalStore` subscription and the two browser events C3 asks for: `visibilitychange`
 * flushes a pending save when the tab is hidden, `beforeunload` warns only while there's
 * something unsaved.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { UI } from "@/src/domain/strings";
import {
  createAutosaveScheduler,
  type AutosaveScheduler,
  type SaveResult,
} from "@/src/modules/monthly-summary/autosave";

export function useAutosave(args: {
  initialText: string;
  initialVersion: number;
  save: (text: string, version: number) => Promise<SaveResult>;
}): AutosaveScheduler {
  // Recreated whenever the identity of `save` (and therefore the summary being edited) changes
  // — the caller keys the component by `${sourceId}:${month}` (§6), so a fresh scheduler per
  // summary is exactly "remount on switch".
  const scheduler = useMemo(
    () =>
      createAutosaveScheduler({
        initialText: args.initialText,
        initialVersion: args.initialVersion,
        save: args.save,
        setTimer: (cb, ms) => window.setTimeout(cb, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        conflictMessage: UI.summaryConflict,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on mount per key
    [],
  );

  useSyncExternalStore(scheduler.subscribe, scheduler.getSnapshot, scheduler.getSnapshot);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") scheduler.flush();
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (scheduler.hasUnsavedWork()) event.preventDefault();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      scheduler.flush();
      scheduler.dispose();
    };
  }, [scheduler]);

  return scheduler;
}
