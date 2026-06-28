import { useCallback, useEffect, useRef } from "react";
import { Dartboard } from "./Dartboard.js";
import type { BoardOptions } from "@shared/dartboard.js";
import type { Config, Dart } from "@shared/types.js";

export type BoardCal = Config["calibration"]["board"];

// Larger than the small summary board's default so the numbered hit markers read
// clearly when scaled down over the video.
const OVERLAY_MARKER_RADIUS = 0.085;

// Stable option objects so the board SVG isn't rebuilt every render (the player
// re-renders ~4×/s on timeupdate; rebuilding here dropped video frames).
const FULL_OPTS: BoardOptions = { showNumbers: true, markerRadius: OVERLAY_MARKER_RADIUS };
const WIRE_OPTS: BoardOptions = { wireframe: true, showNumbers: true, markerRadius: OVERLAY_MARKER_RADIUS };

/** Whether a clip has the per-dart timestamps + clip start needed to sync impacts. */
export function hasImpactTiming(darts: Dart[], clipStartMs: number | undefined): clipStartMs is number {
  return clipStartMs != null && darts.every((d) => typeof d.at === "number");
}

/**
 * How many darts have landed by `time`, revealed in order as they were detected
 * (synced to the clip). `offsetMs` delays reveals to compensate for the video
 * pipeline lagging board detection. Returns all darts for clips without timing
 * data. Callers slice + memoize on this count so the board only re-renders when
 * it changes.
 */
export function revealedCount(
  darts: Dart[],
  clipStartMs: number | undefined,
  time: number,
  offsetMs = 0,
): number {
  if (!hasImpactTiming(darts, clipStartMs)) return darts.length;
  let n = 0;
  for (const d of darts) if ((d.at! - clipStartMs + offsetMs) / 1000 <= time) n++;
  return n;
}

interface Props {
  cal: BoardCal;
  // Darts to plot on the board (replay/compare show the visit's hits).
  darts?: Dart[];
  // Use the see-through wireframe (alignment aid) instead of the full rendered board.
  wireframe?: boolean;
  // Supply to make it draggable (config screen); omit for a read-only overlay.
  onChange?: (c: BoardCal) => void;
}

/**
 * A dartboard rendered over a camera/replay frame at the calibrated position.
 * In the config screen it's a draggable wireframe alignment aid; over a replay
 * it's the full rendered board with the visit's hit markers. Must be placed
 * inside a `position:relative` parent.
 */
export function BoardOverlay({ cal, darts = [], wireframe = false, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const editable = !!onChange;

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !onChange) return;
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const r = parent.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      onChange({ ...cal, x, y });
    },
    [cal, onChange],
  );

  useEffect(() => {
    if (!editable) return;
    const up = () => (dragging.current = false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
  }, [editable, onMove]);

  if (!cal.show) return null;
  return (
    <div
      ref={ref}
      className={`board-overlay ${editable ? "" : "board-overlay--ro"}`}
      style={{
        left: `${cal.x * 100}%`,
        top: `${cal.y * 100}%`,
        height: `${cal.scale * 100}%`,
        opacity: cal.opacity,
        transform: `translate(-50%, -50%) rotate(${cal.rotation}deg)`,
      }}
      onPointerDown={
        editable
          ? (e) => {
              dragging.current = true;
              e.preventDefault();
            }
          : undefined
      }
      title={editable ? "Drag to position the board over the camera view" : undefined}
    >
      <Dartboard darts={darts} options={wireframe ? WIRE_OPTS : FULL_OPTS} />
    </div>
  );
}
