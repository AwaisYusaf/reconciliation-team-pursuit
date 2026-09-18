/**
 * The autosave scheduler (Phase 11 §7.2, C3, P10, U-24). Pure — no React, no DOM — so it's
 * testable with fake timers in a node vitest environment. `use-autosave.ts` wraps this for the
 * screen with `useSyncExternalStore`.
 *
 * One save in flight at a time. Editing while a save runs queues a follow-up rather than a
 * second concurrent request; the follow-up sends whatever text is current at the moment it
 * runs, not a stale snapshot from when it was queued. A conflict (the server's exact
 * `conflictMessage`) stops both the timer and further saves until `reset` (a successful
 * Write again) — an ordinary failure just marks `failed` and waits for the next edit or Retry.
 */

export type AutosaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";

export type AutosaveSnapshot = {
  text: string;
  savedText: string;
  version: number;
  status: AutosaveStatus;
  error: string | null;
  dirty: boolean;
};

export type SaveResult = { ok: true; data: { version: number } } | { ok: false; error: string };

export type AutosaveDeps = {
  initialText: string;
  initialVersion: number;
  save: (text: string, version: number) => Promise<SaveResult>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Default 3000ms (C3). */
  delayMs?: number;
  /** The server's exact conflict message (`UI.summaryConflict`) — the one failure that stops
   *  autosave rather than just marking it failed. */
  conflictMessage: string;
};

export type AutosaveScheduler = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AutosaveSnapshot;
  edit: (text: string) => void;
  saveNow: () => void;
  /** Runs `saveNow` only when there's a pending timer, or the last save failed and the text is
   *  still dirty — used on `visibilitychange`/unmount, where flushing an already-clean, already
   *  saved state would be a no-op that only resets `status` to "saving" for nothing. */
  flush: () => void;
  /** For Write again: stop the timer, drop any queued follow-up, hold every further save
   *  (timer, Save, flush) until `reset`/`markConflict`/`release`, wait out an in-flight save,
   *  and return the version to send. Without the hold, a save landing mid-write bumps the
   *  version and the new draft is refused as a conflict. */
  settle: () => Promise<number>;
  /** Write again failed for a reason other than a conflict: lift the hold, and reschedule the
   *  timer if the text is still unsaved. */
  release: () => void;
  /** After a write: adopt the new text/version as saved, clear error and any pending timer. */
  reset: (text: string, version: number) => void;
  /** Into the conflict state directly — used when Write again itself reports the conflict. */
  markConflict: () => void;
  hasUnsavedWork: () => boolean;
  dispose: () => void;
};

/**
 * Whether the download buttons should be disabled and why (Phase 11 §7.4, P13): a download must
 * build from the saved text, so it's blocked while a save is running and while there's unsaved
 * text waiting to autosave. `null` once the on-screen text matches what's saved.
 */
export function downloadBlock(
  snapshot: Pick<AutosaveSnapshot, "dirty" | "status">,
): "saving" | "unsaved" | null {
  if (snapshot.status === "saving") return "saving";
  if (snapshot.dirty) return "unsaved";
  return null;
}

export function createAutosaveScheduler(deps: AutosaveDeps): AutosaveScheduler {
  const delayMs = deps.delayMs ?? 3000;

  let text = deps.initialText;
  let savedText = deps.initialText;
  let version = deps.initialVersion;
  let status: AutosaveStatus = "idle";
  let error: string | null = null;

  let timer: unknown = null;
  let saving: Promise<void> | null = null;
  let followUpQueued = false;
  let held = false;
  let settlers: Array<() => void> = [];

  const listeners = new Set<() => void>();
  let snapshot: AutosaveSnapshot = buildSnapshot();

  function buildSnapshot(): AutosaveSnapshot {
    return { text, savedText, version, status, error, dirty: text !== savedText };
  }

  function notify(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function clearPendingTimer(): void {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
  }

  function scheduleTimer(): void {
    clearPendingTimer();
    timer = deps.setTimer(() => {
      timer = null;
      void runSave();
    }, delayMs);
  }

  function releaseSettlers(): void {
    const toRelease = settlers;
    settlers = [];
    for (const resolve of toRelease) resolve();
  }

  async function runSave(): Promise<void> {
    if (saving) {
      followUpQueued = true;
      return;
    }
    if (held || status === "conflict" || text === savedText) {
      releaseSettlers();
      return;
    }

    const sending = text;
    status = "saving";
    error = null;
    notify();

    const run = (async () => {
      let result: SaveResult;
      try {
        result = await deps.save(sending, version);
      } catch {
        // Network drop or a thrown action: no server message to show beyond the status line.
        result = { ok: false, error: "" };
      }

      if (result.ok) {
        savedText = sending;
        version = result.data.version;
        // Text typed during the save already restarted the timer; "idle" until it runs, so the
        // status never claims a save is in flight when none is.
        status = text === savedText ? "saved" : "idle";
      } else if (result.error === deps.conflictMessage) {
        status = "conflict";
        error = result.error;
        followUpQueued = false;
      } else {
        status = "failed";
        error = result.error || null;
      }
    })();

    saving = run;
    await run;
    saving = null;
    notify();

    if (followUpQueued && !held && (status as AutosaveStatus) !== "conflict") {
      followUpQueued = false;
      await runSave();
      return;
    }
    followUpQueued = false;
    releaseSettlers();
  }

  function doSaveNow(): void {
    clearPendingTimer();
    if (saving) {
      followUpQueued = true;
      return;
    }
    void runSave();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    edit(next) {
      text = next;
      if (text === savedText) {
        clearPendingTimer();
      } else {
        // "Saved" must not stay on screen over text that isn't saved.
        if (status === "saved") status = "idle";
        if (status !== "conflict" && !held) scheduleTimer();
      }
      notify();
    },
    saveNow() {
      doSaveNow();
    },
    flush() {
      if (held) return;
      if (timer !== null || (status === "failed" && text !== savedText)) doSaveNow();
    },
    settle() {
      return new Promise<number>((resolve) => {
        clearPendingTimer();
        followUpQueued = false;
        held = true;
        if (saving) {
          settlers.push(() => resolve(version));
        } else {
          resolve(version);
        }
      });
    },
    release() {
      held = false;
      if (text !== savedText && status !== "conflict") scheduleTimer();
      notify();
    },
    reset(nextText, nextVersion) {
      clearPendingTimer();
      held = false;
      text = nextText;
      savedText = nextText;
      version = nextVersion;
      status = "idle";
      error = null;
      followUpQueued = false;
      notify();
    },
    markConflict() {
      clearPendingTimer();
      held = false;
      status = "conflict";
      error = deps.conflictMessage;
      followUpQueued = false;
      notify();
    },
    hasUnsavedWork() {
      // `dirty` (text !== savedText) already covers "conflict with dirty text" — a conflict
      // never clears the text, so it stays dirty until reset.
      return text !== savedText || status === "saving" || status === "failed";
    },
    dispose() {
      clearPendingTimer();
    },
  };
}
