/**
 * `createAutosaveScheduler` (Phase 11 §7.2, U-24). Fake timers throughout — `setTimer`/
 * `clearTimer` are injected as `vi.fn()` wrappers around `setTimeout`/`clearTimeout` so every
 * test controls time explicitly rather than racing real timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaveScheduler, type SaveResult } from "./autosave";

const CONFLICT = "Someone else wrote a new summary while you were editing.";

function deps(overrides: Partial<Parameters<typeof createAutosaveScheduler>[0]> = {}) {
  return {
    initialText: "hello",
    initialVersion: 1,
    save: vi.fn<(text: string, version: number) => Promise<SaveResult>>(),
    setTimer: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    conflictMessage: CONFLICT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("debounce", () => {
  it("does not save at 2999ms and saves at 3000ms after an edit", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("hello world");
    await vi.advanceTimersByTimeAsync(2999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("hello world", 1);
  });

  it("each edit restarts the 3s timer rather than stacking", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("a");
    await vi.advanceTimersByTimeAsync(2000);
    s.edit("ab"); // restarts the clock
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab", 1);
  });

  it("no save when the text is edited back to savedText — timer is cleared", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("changed");
    await vi.advanceTimersByTimeAsync(1000);
    s.edit("hello"); // back to initial/savedText
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(s.getSnapshot().dirty).toBe(false);
  });
});

describe("single flight", () => {
  it("edit during a pending save queues exactly one follow-up carrying the latest text and the new version", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    let resolveFirst!: (r: SaveResult) => void;
    const firstPromise = new Promise<SaveResult>((resolve) => {
      resolveFirst = resolve;
    });
    save.mockReturnValueOnce(firstPromise);
    save.mockResolvedValueOnce({ ok: true, data: { version: 3 } });

    const s = createAutosaveScheduler(deps({ save }));
    s.edit("v1");
    await vi.advanceTimersByTimeAsync(3000); // starts the first save
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("v1", 1);

    // Edit again while saving — reschedules the debounce timer, doesn't fire a second concurrent
    // call yet.
    s.edit("v2");
    expect(save).toHaveBeenCalledTimes(1);
    // Edit again before that timer fires — the follow-up must carry the LATEST text.
    s.edit("v3");
    expect(save).toHaveBeenCalledTimes(1);

    // The rescheduled timer fires 3s after the last edit; runSave sees `saving` still true and
    // marks a follow-up queued (still no second call — save is still in flight).
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, data: { version: 2 } });
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("v3", 2); // new version from the first save
  });

  it("manual saveNow cancels the pending timer — no extra save fires at 3s", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("changed");
    await vi.advanceTimersByTimeAsync(1000);
    s.saveNow();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("version passed and updated across consecutive saves", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValueOnce({ ok: true, data: { version: 2 } });
    save.mockResolvedValueOnce({ ok: true, data: { version: 3 } });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("a");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenNthCalledWith(1, "a", 1);
    expect(s.getSnapshot().version).toBe(2);

    s.edit("b");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(2, "b", 2);
    expect(s.getSnapshot().version).toBe(3);
  });
});

describe("conflict", () => {
  it("save returning the exact conflictMessage sets status conflict and stops further saves via edit/saveNow/flush", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: false, error: CONFLICT });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("changed");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("conflict"));
    expect(s.getSnapshot().error).toBe(CONFLICT);

    save.mockClear();
    s.edit("changed again");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();

    s.saveNow();
    expect(save).not.toHaveBeenCalled();

    s.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("a server error string → failed with that message; Retry (saveNow) works", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValueOnce({ ok: false, error: "Server says no." });
    save.mockResolvedValueOnce({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("changed");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("failed"));
    expect(s.getSnapshot().error).toBe("Server says no.");

    s.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    // No edit happened between the retry and its resolution, so text === savedText → "saved".
    expect(s.getSnapshot().status).toBe("saved");
    expect(s.getSnapshot().version).toBe(2);
  });

  it("a thrown save → failed with error null", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockRejectedValueOnce(new Error("network drop"));
    const s = createAutosaveScheduler(deps({ save }));

    s.edit("changed");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("failed"));
    expect(s.getSnapshot().error).toBeNull();
  });
});

describe("hasUnsavedWork", () => {
  it("true while dirty, saving, or failed; false once clean and saved", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    let resolveSave!: (r: SaveResult) => void;
    save.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const s = createAutosaveScheduler(deps({ save }));
    expect(s.hasUnsavedWork()).toBe(false);

    s.edit("dirty");
    expect(s.hasUnsavedWork()).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    expect(s.getSnapshot().status).toBe("saving");
    expect(s.hasUnsavedWork()).toBe(true);

    resolveSave({ ok: true, data: { version: 2 } });
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("saved"));
    expect(s.hasUnsavedWork()).toBe(false);
  });

  it("failed and dirty → true", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValueOnce({ ok: false, error: "nope" });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("dirty");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("failed"));
    expect(s.hasUnsavedWork()).toBe(true);
  });

  it("no stuck 'saving' when text is edited back to savedText mid-save — status resolves to idle, not saved, and hasUnsavedWork reflects the new dirt correctly", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    let resolveSave!: (r: SaveResult) => void;
    save.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("sent");
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.getSnapshot().status).toBe("saving");

    // Text edited during the save, ending up back at what's currently `savedText` ("hello") —
    // note savedText only updates once the in-flight save resolves, so mid-flight it's still
    // "hello"; editing back to "hello" here exercises `edit`'s own compare against the
    // *current* savedText while a save is in flight.
    s.edit("hello");

    resolveSave({ ok: true, data: { version: 2 } });
    await vi.waitFor(() => expect(s.getSnapshot().status).not.toBe("saving"));
    // savedText is now "sent" (what was actually sent), text is "hello" → dirty again, so the
    // scheduler must not report a stale "saved"/clean state.
    expect(s.getSnapshot().text).toBe("hello");
    expect(s.getSnapshot().savedText).toBe("sent");
    expect(s.getSnapshot().status).toBe("idle");
    expect(s.hasUnsavedWork()).toBe(true);
  });
});

describe("visibility flush", () => {
  it("flush with a pending timer saves immediately", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("changed");
    s.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it("flush when clean is a no-op", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));
    s.flush();
    expect(save).not.toHaveBeenCalled();
    expect(s.getSnapshot().status).toBe("idle");
  });
});

describe("settle", () => {
  it("waits for an in-flight save and resolves its NEW version, cancels a pending timer, and holds edit/saveNow/flush/queued follow-up while in flight", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    let resolveSave!: (r: SaveResult) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("in flight");
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.getSnapshot().status).toBe("saving");

    const settlePromise = s.settle();

    // While held: edit, saveNow, flush and a would-be follow-up must never call save again.
    s.edit("during hold");
    s.saveNow();
    s.flush();
    expect(save).toHaveBeenCalledTimes(1);

    resolveSave({ ok: true, data: { version: 5 } });
    const version = await settlePromise;
    expect(version).toBe(5);
    expect(save).toHaveBeenCalledTimes(1); // no follow-up call fired despite edits during the hold

    // Still held after settle resolves (release/reset lifts it) — edit must not schedule.
    s.edit("still held");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("settle with no in-flight save resolves immediately with the current version and cancels the pending timer", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("pending timer only");
    const version = await s.settle();
    expect(version).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled(); // the pending timer was cancelled by settle

    // Held, no save in flight (saving === null): saveNow/flush must still be refused by
    // runSave's own `held` guard, not merely by the "saving" in-flight check.
    s.saveNow();
    expect(save).not.toHaveBeenCalled();
    s.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("settle while a follow-up is queued resolves (doesn't hang) and the follow-up never runs", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    let resolveSave!: (r: SaveResult) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("first");
    await vi.advanceTimersByTimeAsync(3000);
    s.edit("second"); // queues a follow-up (save still in flight)

    const settlePromise = s.settle();
    resolveSave({ ok: true, data: { version: 2 } });
    const version = await settlePromise;
    expect(version).toBe(2);
    expect(save).toHaveBeenCalledTimes(1); // the queued follow-up was dropped by settle, not run
  });
});

describe("flush's own held guard", () => {
  it("held with status failed and dirty text (flush's own second condition would otherwise fire) still refuses to save", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValueOnce({ ok: false, error: "server error" });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("dirty");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().status).toBe("failed");

    // settle() with no in-flight save resolves immediately and holds — status stays "failed"
    // and text stays dirty, exactly the state flush()'s own second condition would fire on.
    await s.settle();
    expect(s.getSnapshot().status).toBe("failed");
    expect(s.getSnapshot().dirty).toBe(true);

    save.mockClear();
    s.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("release", () => {
  it("lifts the hold and reschedules the timer when the text is still dirty", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("dirty");
    await s.settle(); // no in-flight save; holds immediately
    expect(s.getSnapshot().dirty).toBe(true);

    s.release();
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("dirty", 1);
  });

  it("does not reschedule when text is clean after release", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));
    await s.settle();
    s.release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("adopts new text/version, clears held/error/status, and cancels the pending timer", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: false, error: "some failure" });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("x");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("failed"));

    s.reset("fresh text", 9);
    const snap = s.getSnapshot();
    expect(snap).toMatchObject({ text: "fresh text", savedText: "fresh text", version: 9, status: "idle", error: null, dirty: false });

    // Held is lifted by reset — editing again must be able to schedule a save.
    save.mockClear();
    save.mockResolvedValue({ ok: true, data: { version: 10 } });
    s.edit("changed after reset");
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledWith("changed after reset", 9);
  });
});

describe("markConflict", () => {
  it("sets status conflict directly, cancels the timer, and lifts any hold", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("x");
    s.markConflict();
    expect(s.getSnapshot()).toMatchObject({ status: "conflict", error: CONFLICT });

    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("edit turning saved into idle", () => {
  it("a fresh edit after a successful save (status 'saved') flips status back to idle", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    save.mockResolvedValue({ ok: true, data: { version: 2 } });
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("x");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.getSnapshot().status).toBe("saved"));

    s.edit("x more");
    expect(s.getSnapshot().status).toBe("idle");
  });
});

describe("subscribe / getSnapshot", () => {
  it("notifies listeners and changes snapshot identity on edit", () => {
    const s = createAutosaveScheduler(deps());
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    const before = s.getSnapshot();

    s.edit("new text");
    expect(listener).toHaveBeenCalledTimes(1);
    const after = s.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.text).toBe("new text");

    unsubscribe();
    s.edit("more");
    expect(listener).toHaveBeenCalledTimes(1); // no further notifications once unsubscribed
  });

  it("getSnapshot returns the same reference between notifications (no unnecessary rerenders)", () => {
    const s = createAutosaveScheduler(deps());
    const first = s.getSnapshot();
    const second = s.getSnapshot();
    expect(first).toBe(second);
  });
});

describe("dispose", () => {
  it("cancels a pending timer so no save fires after dispose", async () => {
    const save = vi.fn<(text: string, version: number) => Promise<SaveResult>>();
    const s = createAutosaveScheduler(deps({ save }));
    s.edit("x");
    s.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
