import { useEffect, useState, useCallback } from "react";

export interface VideoController {
  paused: boolean;
  time: number;
  duration: number;
  rate: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setRate: (r: number) => void;
  seek: (t: number) => void;
  /** Pause and move by `dir` frames (dir = ±1). */
  stepFrame: (dir: number) => void;
}

/**
 * Reactive transport state + imperative controls for a single <video>.
 *
 * Takes the element itself (not a ref) so listeners re-bind whenever the element
 * changes — the <video> is remounted (`key`) on every visit switch, and a
 * ref-based effect would leave its listeners stranded on the discarded element,
 * freezing time/duration (and the scrubber).
 */
export function useVideoController(el: HTMLVideoElement | null, fps: number): VideoController {
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onRate = () => setRateState(el.playbackRate);
    // Seed from the current element state (it may already be loaded).
    onDur();
    onTime();
    setPaused(el.paused);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ratechange", onRate);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ratechange", onRate);
    };
  }, [el]);

  const play = useCallback(() => el?.play().catch(() => {}), [el]);
  const pause = useCallback(() => el?.pause(), [el]);
  const toggle = useCallback(() => {
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [el]);
  const setRate = useCallback(
    (r: number) => {
      if (el) el.playbackRate = r;
    },
    [el],
  );
  const seek = useCallback(
    (t: number) => {
      if (!el) return;
      const max = Number.isFinite(el.duration) ? el.duration : t;
      el.currentTime = Math.max(0, Math.min(t, max));
    },
    [el],
  );
  const stepFrame = useCallback(
    (dir: number) => {
      if (!el) return;
      el.pause();
      const max = Number.isFinite(el.duration) ? el.duration : el.currentTime;
      el.currentTime = Math.max(0, Math.min(max, el.currentTime + dir / fps));
    },
    [el, fps],
  );

  return { paused, time, duration, rate, play, pause, toggle, setRate, seek, stepFrame };
}

export const SPEEDS = [1, 0.5, 0.25, 0.1] as const;

/** seconds + frame index, for the scrubber readout. */
export function formatTime(t: number, fps: number): string {
  const frame = Math.round(t * fps);
  return `${t.toFixed(2)}s · f${frame}`;
}
