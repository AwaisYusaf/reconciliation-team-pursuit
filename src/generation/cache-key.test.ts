import { describe, expect, it } from "vitest";

import { canonicalJson, inputsHash } from "./cache-key";

describe("canonicalJson", () => {
  it("sorts object keys, so column order cannot change the hash", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalJson({ outer: { z: 1, a: { y: 2, b: 3 } } })).toBe(
      '{"outer":{"a":{"b":3,"y":2},"z":1}}',
    );
  });

  it("preserves array order, because row order is data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("treats an absent key and an undefined key as the same data", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("distinguishes null from undefined at the top level", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("serialises dates stably rather than by locale", () => {
    expect(canonicalJson(new Date("2026-02-15T12:00:00.000Z"))).toBe(
      '"2026-02-15T12:00:00.000Z"',
    );
  });

  it("keeps money integers exact", () => {
    expect(canonicalJson({ cents: 45641_12 })).toBe('{"cents":4564112}');
  });
});

describe("inputsHash", () => {
  const snapshot = { month: "2026-02", rows: [{ id: "a", cents: 100 }] };

  it("is stable across key ordering", () => {
    expect(inputsHash({ snapshot, generatorVersion: "v1" })).toBe(
      inputsHash({
        snapshot: { rows: [{ cents: 100, id: "a" }], month: "2026-02" },
        generatorVersion: "v1",
      }),
    );
  });

  it("changes when the data changes", () => {
    expect(inputsHash({ snapshot, generatorVersion: "v1" })).not.toBe(
      inputsHash({ snapshot: { ...snapshot, rows: [{ id: "a", cents: 101 }] }, generatorVersion: "v1" }),
    );
  });

  it("changes when the generator version changes, so a layout change rebuilds", () => {
    expect(inputsHash({ snapshot, generatorVersion: "v1" })).not.toBe(
      inputsHash({ snapshot, generatorVersion: "v2" }),
    );
  });

  it("separates per-line-item outputs sharing one snapshot", () => {
    expect(inputsHash({ snapshot, generatorVersion: "v1", scope: "salary" })).not.toBe(
      inputsHash({ snapshot, generatorVersion: "v1", scope: "analytical" }),
    );
    // No scope and a null scope are the same output.
    expect(inputsHash({ snapshot, generatorVersion: "v1" })).toBe(
      inputsHash({ snapshot, generatorVersion: "v1", scope: null }),
    );
  });

  it("fits the column and stays hex", () => {
    expect(inputsHash({ snapshot, generatorVersion: "v1" })).toMatch(/^[0-9a-f]{32}$/);
  });
});
