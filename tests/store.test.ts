import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisitStore } from "../server/src/store/visits.js";
import type { Visit } from "@shared/types.js";

function visit(seq: number): Visit {
  return {
    id: `v${String(seq).padStart(4, "0")}_${1000 + seq}`,
    seq,
    darts: [],
    totalPoints: seq,
    startedAt: 1000 + seq,
    finishedAt: 2000 + seq,
    endReason: "takeout",
    clipUrl: `/clips/v${String(seq).padStart(4, "0")}_${1000 + seq}.mp4`,
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
    const visits = [1, 2, 3, 4, 5].map(visit);
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
});
