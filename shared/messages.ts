// Messages pushed from server to client over /ws. Shared by both tiers.

import type { Visit, Config } from "./types.js";
import type { Phase } from "./state-machine.js";

export type ServerMessage =
  | { type: "state"; phase: Phase; dartsCount: number; board: string }
  | { type: "visit"; visit: Visit } // visit created, clip pending
  | { type: "visit-ready"; visit: Visit } // clip ready -> autoplay
  | { type: "play"; visitId: string } // manual replay request
  | { type: "config"; config: Config };
