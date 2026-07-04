// In-memory visit index with JSON persistence and clip retention. Survives a
// service restart so the gallery isn't empty after a bounce.

import { readFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Visit } from "@shared/types.js";
import { logger } from "../log.js";

const log = logger("store");

export class VisitStore {
  private visits: Visit[] = []; // newest first
  private indexPath: string;
  private clipDir: string;
  private retain: number;

  constructor(varDir: string, clipDir: string, retain: number) {
    mkdirSync(varDir, { recursive: true });
    mkdirSync(clipDir, { recursive: true });
    this.indexPath = join(varDir, "visits.json");
    this.clipDir = clipDir;
    this.retain = retain;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.indexPath, "utf8")) as Visit[];
      if (Array.isArray(data)) this.visits = data;
    } catch (err) {
      // Don't silently discard a corrupt index (it may hold the saved library).
      // Preserve it for recovery, warn loudly, then start clean.
      const backup = `${this.indexPath}.corrupt`;
      try {
        renameSync(this.indexPath, backup);
      } catch {
        /* best-effort backup */
      }
      log.error(`visits index at ${this.indexPath} is corrupt; backed up to ${backup} and starting clean. (${(err as Error).message})`);
    }
  }

  private async persist(): Promise<void> {
    // Atomic write so a crash mid-write can't corrupt the index (which would
    // otherwise cost the persistent saved-visit library on next boot).
    const tmp = `${this.indexPath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(this.visits, null, 2), "utf8");
      await rename(tmp, this.indexPath);
    } catch (err) {
      log.error(`failed to persist visits index: ${(err as Error).message}`);
    }
  }

  list(limit?: number): Visit[] {
    return limit ? this.visits.slice(0, limit) : [...this.visits];
  }

  get(id: string): Visit | undefined {
    return this.visits.find((v) => v.id === id);
  }

  latest(): Visit | undefined {
    return this.visits[0];
  }

  /** Highest visit sequence number persisted (0 if none) — used to seed the FSM
   * counter on boot so visit numbers don't restart at #1 after a bounce. */
  maxSeq(): number {
    return this.visits.reduce((m, v) => Math.max(m, v.seq), 0);
  }

  clipPath(id: string): string {
    return join(this.clipDir, `${id}.mp4`);
  }

  /** Add a visit, returning the ids of any visits pruned out (so clients can drop
   * cards whose clips no longer exist). */
  async add(visit: Visit): Promise<string[]> {
    this.visits = [visit, ...this.visits.filter((v) => v.id !== visit.id)];
    const dropped = await this.prune();
    await this.persist();
    return dropped.map((v) => v.id);
  }

  async update(id: string, patch: Partial<Visit>): Promise<Visit | undefined> {
    const idx = this.visits.findIndex((v) => v.id === id);
    if (idx === -1) return undefined;
    this.visits[idx] = { ...this.visits[idx], ...patch };
    await this.persist();
    return this.visits[idx];
  }

  /**
   * Keep all saved visits plus the newest `retain` unsaved ones; delete the
   * dropped clips. Saved visits form a persistent reference-form library and are
   * never auto-pruned.
   */
  private async prune(): Promise<Visit[]> {
    let keptUnsaved = 0;
    const keep: Visit[] = [];
    const dropped: Visit[] = [];
    for (const v of this.visits) {
      // this.visits is newest-first, so we keep the newest unsaved up to retain.
      if (v.saved || keptUnsaved < this.retain) {
        keep.push(v);
        if (!v.saved) keptUnsaved++;
      } else {
        dropped.push(v);
      }
    }
    if (dropped.length === 0) return [];
    this.visits = keep;
    for (const v of dropped) {
      await unlink(this.clipPath(v.id)).catch(() => {});
    }
    return dropped;
  }
}

const MAX_NOTE = 2000;

/**
 * Validate an untrusted visit patch (PATCH body). Returns the recognized,
 * well-typed subset and a list of errors. Mirrors validateConfigPatch.
 */
export function validateVisitPatch(input: unknown): {
  patch: Partial<Pick<Visit, "saved" | "rating" | "note">>;
  errors: string[];
} {
  const errors: string[] = [];
  const patch: Partial<Pick<Visit, "saved" | "rating" | "note">> = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { patch, errors: ["body must be an object"] };
  }
  const b = input as Record<string, unknown>;
  if ("saved" in b) {
    if (typeof b.saved === "boolean") patch.saved = b.saved;
    else errors.push("saved must be a boolean");
  }
  if ("rating" in b) {
    if (b.rating === "good" || b.rating === "bad" || b.rating === null) patch.rating = b.rating;
    else errors.push('rating must be "good", "bad", or null');
  }
  if ("note" in b) {
    if (typeof b.note === "string" && b.note.length <= MAX_NOTE) patch.note = b.note;
    else errors.push(`note must be a string of <= ${MAX_NOTE} chars`);
  }
  return { patch, errors };
}
