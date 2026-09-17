"use client";

/**
 * Runs OpenAI reads for the receipt/proof files currently on the form, at most two at a time
 * (Phase 10 §3.6), and caches results by file key. Any non-ok response, thrown fetch, or bad
 * JSON is treated as "no amount found" for that one file — a read never blocks the others or
 * the form's own save. Results for keys no longer present (a file was removed) are dropped from
 * the cache; results that arrive after unmount are ignored.
 */
import { useEffect, useRef, useState } from "react";

import {
  fileSetSignature,
  nextKeysToRead,
  type FileReadResult,
  type ReadKind,
} from "@/src/domain/amount-suggestion";

export type AmountReadInput = {
  key: string;
  kind: ReadKind;
  name: string;
} & ({ source: "upload"; file: File } | { source: "attached"; documentId: string });

const MAX_CONCURRENT = 2;

type ReadAmountsResponse = {
  ok: boolean;
  data?: {
    found: boolean;
    subtotalCents?: number;
    taxCents?: number;
    feesCents?: number;
    totalCents?: number;
  };
};

async function readOne(input: AmountReadInput): Promise<FileReadResult> {
  const form = new FormData();
  if (input.source === "upload") {
    form.set("file", input.file);
    form.set("kind", input.kind);
  } else {
    form.set("documentId", input.documentId);
  }

  try {
    const response = await fetch("/api/files/read-amounts", { method: "POST", body: form });
    if (!response.ok) return { status: "none" };
    const json = (await response.json()) as ReadAmountsResponse;
    if (!json.ok || !json.data?.found) return { status: "none" };
    const { subtotalCents = 0, taxCents = 0, feesCents = 0, totalCents = 0 } = json.data;
    return { status: "found", amounts: { subtotalCents, taxCents, feesCents, totalCents } };
  } catch {
    return { status: "none" };
  }
}

export function useAmountReads({
  files,
  enabled,
}: {
  files: readonly AmountReadInput[];
  enabled: boolean;
}): { results: ReadonlyMap<string, FileReadResult>; signature: string } {
  const [cache, setCache] = useState<Map<string, FileReadResult>>(new Map());
  // Mirrors `cache` so the read loop always starts from the latest completed set, without a
  // stale closure over the state captured when the effect last ran.
  const cacheRef = useRef(cache);
  const inFlight = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const filesByKey = useRef<Map<string, AmountReadInput>>(new Map());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Kept current after every render (not during it — refs may not be written at render time),
  // so a read started from an event handler or another effect always sees the latest File
  // objects, even when the key set (and so `signature`) hasn't itself changed.
  useEffect(() => {
    filesByKey.current = new Map(files.map((file) => [file.key, file]));
  });

  const presentKeys = files.map((file) => file.key);
  const signature = fileSetSignature(presentKeys);

  useEffect(() => {
    if (!enabled) return;

    const present = new Set(presentKeys);
    for (const key of inFlight.current) {
      if (!present.has(key)) inFlight.current.delete(key);
    }
    // The ref is written here, synchronously, never inside a setState updater: React may defer
    // an updater while another update is pending (typing a vendor name), and `pump` would then
    // see a finished file as neither cached nor in flight and pay OpenAI to read it again.
    const pruned = new Map([...cacheRef.current].filter(([key]) => present.has(key)));
    if (pruned.size !== cacheRef.current.size) {
      cacheRef.current = pruned;
      setCache(pruned);
    }

    function pump() {
      const cachedKeys = new Set(cacheRef.current.keys());
      // The latest render's keys, never this effect run's: `pump` is re-entered from a read that
      // finishes after the files changed, and a captured list would never start a file added
      // while both slots were busy — the panel would read "Reading…" forever.
      const latestKeys = [...filesByKey.current.keys()];
      const toStart = nextKeysToRead(latestKeys, cachedKeys, inFlight.current, MAX_CONCURRENT);
      for (const key of toStart) {
        const input = filesByKey.current.get(key);
        if (!input) continue;
        inFlight.current.add(key);
        void readOne(input).then((result) => {
          inFlight.current.delete(key);
          // Dropped: the component unmounted, or this file is no longer on the form.
          if (!mounted.current || !filesByKey.current.has(key)) return;
          // Ref first, synchronously — see the note above the pruning step.
          const next = new Map(cacheRef.current);
          next.set(key, result);
          cacheRef.current = next;
          setCache(next);
          pump();
        });
      }
    }
    pump();
    // `signature` already changes whenever the file set does; `files` itself is read through
    // `filesByKey.current`, which is always the latest render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);

  const results = new Map<string, FileReadResult>();
  for (const key of presentKeys) {
    results.set(key, cache.get(key) ?? { status: "pending" });
  }

  return { results, signature };
}
