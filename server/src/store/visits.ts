// In-memory visit index with JSON persistence and clip retention. Survives a
// service restart so the gallery isn't empty after a bounce.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Visit } from "@shared/types.js";

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
    } catch {
      /* start clean if the index is corrupt */
    }
  }

  private async persist(): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(this.visits, null, 2), "utf8").catch(() => {});
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

  clipPath(id: string): string {
    return join(this.clipDir, `${id}.mp4`);
  }

  async add(visit: Visit): Promise<void> {
    this.visits = [visit, ...this.visits.filter((v) => v.id !== visit.id)];
    await this.prune();
    await this.persist();
  }

  async update(id: string, patch: Partial<Visit>): Promise<Visit | undefined> {
    const idx = this.visits.findIndex((v) => v.id === id);
    if (idx === -1) return undefined;
    this.visits[idx] = { ...this.visits[idx], ...patch };
    await this.persist();
    return this.visits[idx];
  }

  /** Drop visits beyond the retain count and delete their clip files. */
  private async prune(): Promise<void> {
    if (this.visits.length <= this.retain) return;
    const dropped = this.visits.slice(this.retain);
    this.visits = this.visits.slice(0, this.retain);
    for (const v of dropped) {
      await unlink(this.clipPath(v.id)).catch(() => {});
    }
  }
}
