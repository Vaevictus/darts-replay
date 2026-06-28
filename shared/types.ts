// Pure shared types. DOM-free, runs in Node and the browser bundle.

/** Raw shape of a segment as returned by the autodarts board manager /api/state. */
export interface RawSegment {
  name: string; // e.g. "T20", "S1", "25", "BULL", "OUTSIDE"
  number: number; // 1..20, 25 for bull, 0 for miss
  bed: string; // "Triple" | "SingleInner" | "SingleOuter" | "Double" | "Bull" | "DoubleBull" | "Outside"
  multiplier: number; // 0..3
}

/** Raw throw entry from /api/state. coords are normalized to the board radius (~ -1..1). */
export interface RawThrow {
  segment: RawSegment;
  coords: { x: number; y: number };
}

/** Raw /api/state payload. Field set confirmed live on the box 2026-06-28. */
export interface RawBoardState {
  connected: boolean;
  running: boolean;
  status: string; // live values seen: "Stopped", "Throw" (+ event e.g. "Manual reset"); "Takeout" expected
  event: string;
  numThrows: number;
  throws?: RawThrow[]; // OMITTED entirely by the board when there are 0 darts
}

/** A single normalized dart within a visit. */
export interface Dart {
  index: number; // 1-based position within the visit
  name: string; // segment name, e.g. "T20"
  number: number; // 1..20, 25 (bull), 0 (miss)
  bed: string;
  multiplier: number; // 0..3
  points: number; // number * multiplier
  coords: { x: number; y: number } | null; // normalized board coords, null if unknown
}

export type EndReason = "third-dart" | "takeout" | "timeout" | "manual";

/** A completed visit (up to 3 darts) with its recording. */
export interface Visit {
  id: string; // deterministic, also the clip filename stem
  seq: number; // monotonically increasing per server run
  darts: Dart[];
  totalPoints: number;
  startedAt: number; // epoch ms of the first dart
  finishedAt: number; // epoch ms the visit was locked
  endReason: EndReason;
  clipUrl: string | null; // /clips/<id>.mp4 once extracted, null while pending
  // Self-review metadata (this is a form tool — "good"/"bad" is form, not score).
  saved: boolean; // kept beyond the retention ring (a reference-form library)
  rating: "good" | "bad" | null; // the user's assessment of their form for this visit
  note: string; // free-text note ("dropped my elbow", etc.)
}

export interface Config {
  board: { host: string; port: number; pollIntervalMs: number };
  webcam: {
    device: string;
    width: number;
    height: number;
    fps: number;
    format: "h264" | "mjpeg" | "yuyv422"; // v4l2 input_format
    // How to produce the recorded stream. "x264" (MJPEG->libx264 ultrafast) is the
    // default: native-H264 "copy" carries no PTS (segments mis-slice) and VAAPI is
    // unavailable on the box. "x264" costs ~0.7 of one core at 720p30.
    encoder: "copy" | "x264" | "vaapi";
  };
  recorder: {
    segmentDir: string; // tmpfs ring dir
    clipDir: string; // persisted clips
    segmentSeconds: number;
    ringSeconds: number;
    preRollMs: number;
    postRollMs: number;
  };
  visit: {
    inactivityTimeoutMs: number; // fallback finish after last dart
    thirdDartGraceMs: number; // settle time before locking on the 3rd dart
    collectTimeoutMs: number; // wait after takeout before re-arming
  };
  retainCount: number; // visits/clips to keep
  server: { port: number };
}
