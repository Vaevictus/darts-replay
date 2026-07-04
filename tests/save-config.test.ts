import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the config module at a temp file BEFORE importing it (the paths are
// resolved from env at module-eval time). Vitest isolates test files, so this
// override doesn't leak into other suites.
const dir = mkdtempSync(join(tmpdir(), "dr-saveconfig-"));
const cfgPath = join(dir, "config.json");
process.env.DARTS_CONFIG = cfgPath;
process.env.DARTS_DATA = join(dir, "data");
const { saveConfig } = await import("../server/src/config.js");

describe("saveConfig", () => {
  afterEach(() => {
    try {
      rmSync(cfgPath);
    } catch {
      /* may not exist */
    }
  });

  it("writes defaults+patch when no config file exists, leaving no temp file", async () => {
    expect(existsSync(cfgPath)).toBe(false);
    const next = await saveConfig({ retainCount: 7 });
    expect(next.retainCount).toBe(7);
    expect(existsSync(cfgPath)).toBe(true);
    expect(existsSync(`${cfgPath}.tmp`)).toBe(false); // atomic rename cleaned up
  });

  it("merges a patch over an existing valid config, keeping siblings", async () => {
    writeFileSync(cfgPath, JSON.stringify({ retainCount: 3, board: { port: 4000 } }));
    const next = await saveConfig({ board: { port: 5000 } });
    expect(next.board.port).toBe(5000);
    expect(next.retainCount).toBe(3); // preserved
  });

  it("REFUSES to overwrite a malformed config (protects camera setup + credentials)", async () => {
    const garbage = "{ not valid json,,,";
    writeFileSync(cfgPath, garbage);
    await expect(saveConfig({ retainCount: 9 })).rejects.toThrow(/malformed|refus/i);
    // The malformed file must be left byte-for-byte intact, not clobbered.
    expect(readFileSync(cfgPath, "utf8")).toBe(garbage);
  });
});
