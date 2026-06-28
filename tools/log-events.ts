// Live board logger. Polls /api/state and prints every meaningful change while
// also appending raw snapshots to var/event-log.jsonl. Run this on the box while
// throwing full / partial / bust visits to confirm the live `status` strings and
// takeout behaviour, and to capture a sample log for FSM tests.
//
//   npm run probe            # uses config.json board host/port
//   npm run probe -- 5000    # stop after 5000 ms of inactivity (optional)

import { appendFileSync, mkdirSync } from "node:fs";
import { loadConfigSync, resolvePath } from "../server/src/config.js";
import { classifyStatus } from "../shared/board.js";
import type { RawBoardState } from "../shared/types.js";

const cfg = loadConfigSync();
const url = `http://${cfg.board.host}:${cfg.board.port}/api/state`;
const logPath = resolvePath("var/event-log.jsonl");
mkdirSync(resolvePath("var"), { recursive: true });

let prev = "";
console.log(`Polling ${url} every ${cfg.board.pollIntervalMs}ms. Logging to ${logPath}`);
console.log("Throw some visits (full, 2-dart, 1-dart, bust). Ctrl-C to stop.\n");

async function tick() {
  let state: RawBoardState | null = null;
  try {
    const res = await fetch(url);
    state = (await res.json()) as RawBoardState;
  } catch {
    state = null;
  }

  const throws = state?.throws ?? [];
  const fingerprint = state
    ? `${state.status}|${state.numThrows}|${throws.map((t) => t.segment.name).join(",")}`
    : "DISCONNECTED";

  if (fingerprint !== prev) {
    prev = fingerprint;
    const ts = new Date().toISOString().slice(11, 23);
    if (state) {
      const darts = throws.map((t) => t.segment.name).join(" ") || "—";
      console.log(
        `[${ts}] status=${state.status} (${classifyStatus(state.status)}) ` +
          `event=${state.event} numThrows=${state.numThrows} darts=[${darts}]`,
      );
      appendFileSync(logPath, JSON.stringify({ at: Date.now(), state }) + "\n");
    } else {
      console.log(`[${ts}] (no response from board)`);
    }
  }
}

setInterval(() => void tick(), cfg.board.pollIntervalMs);
