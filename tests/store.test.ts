import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisitStore, validateVisitPatch } from "../server/src/store/visits.js";
import type { Visit } from "@shared/types.js";

function visit(seq: number, over: Partial<Visit> = {}): Visit {
  return {
    id: `v${String(seq).padStart(4, "0")}_${1000 + seq}`,
    seq,
    darts: [],
    totalPoints: seq,
    startedAt: 1000 + seq,
    finishedAt: 2000 + seq,
    endReason: "takeout",
    clipUrl: `/clips/v${String(seq).padStart(4, "0")}_${1000 + seq}.mp4`,
    saved: false,
    rating: null,
    note: "",
    ...over,
  };
}

describe("VisitStore", () => {
  let dir: string;
  let varDir: string;
  let clipDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dr-store-"));
    varDir = join(dir, "var");
    clipDir = join(varDir, "clips");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds visits newest-first and exposes get/latest", async () => {
    const store = new VisitStore(varDir, clipDir, 10);
    await store.add(visit(1));
    await store.add(visit(2));
    expect(store.list().map((v) => v.seq)).toEqual([2, 1]);
    expect(store.latest()?.seq).toBe(2);
    expect(store.get(visit(1).id)?.seq).toBe(1);
  });

  it("prunes beyond retainCount and deletes the dropped clip files", async () => {
    const retain = 3;
    const store = new VisitStore(varDir, clipDir, retain);
    const visits = [1, 2, 3, 4, 5].map((n) => visit(n));
    for (const v of visits) {
      writeFileSync(store.clipPath(v.id), "x"); // dummy clip file
      await store.add(v);
    }
    expect(store.list().map((v) => v.seq)).toEqual([5, 4, 3]);
    // Oldest two clips removed, retained ones kept.
    expect(existsSync(store.clipPath(visits[0].id))).toBe(false);
    expect(existsSync(store.clipPath(visits[1].id))).toBe(false);
    expect(existsSync(store.clipPath(visits[4].id))).toBe(true);
  });

  it("persists the index across instances", async () => {
    const a = new VisitStore(varDir, clipDir, 10);
    await a.add(visit(7));
    const b = new VisitStore(varDir, clipDir, 10);
    expect(b.get(visit(7).id)?.seq).toBe(7);
  });

  it("keeps saved visits beyond retainCount while still pruning unsaved ones", async () => {
    const retain = 2;
    const store = new VisitStore(varDir, clipDir, retain);
    const saved = visit(1, { saved: true });
    writeFileSync(store.clipPath(saved.id), "x");
    await store.add(saved);
    // Add enough unsaved visits to exceed retain several times over.
    const unsaved = [2, 3, 4, 5].map((n) => visit(n));
    for (const v of unsaved) {
      writeFileSync(store.clipPath(v.id), "x");
      await store.add(v);
    }
    const seqs = store.list().map((v) => v.seq);
    // newest 2 unsaved (5, 4) + the saved one (1) survive; 2 and 3 pruned.
    expect(seqs).toEqual([5, 4, 1]);
    expect(existsSync(store.clipPath(saved.id))).toBe(true);
    expect(existsSync(store.clipPath(visit(2).id))).toBe(false);
    expect(existsSync(store.clipPath(visit(5).id))).toBe(true);
  });
});

describe("validateVisitPatch", () => {
  it("accepts rating, saved and note", () => {
    const { patch, errors } = validateVisitPatch({ rating: "good", saved: true, note: "elbow up" });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ rating: "good", saved: true, note: "elbow up" });
  });

  it("accepts null rating (clearing it)", () => {
    expect(validateVisitPatch({ rating: null }).errors).toEqual([]);
  });

  it("rejects bad values", () => {
    expect(validateVisitPatch({ rating: "great" }).errors.length).toBeGreaterThan(0);
    expect(validateVisitPatch({ saved: "yes" }).errors.length).toBeGreaterThan(0);
    expect(validateVisitPatch({ note: 5 }).errors.length).toBeGreaterThan(0);
    expect(validateVisitPatch("nope").errors.length).toBeGreaterThan(0);
  });
});
