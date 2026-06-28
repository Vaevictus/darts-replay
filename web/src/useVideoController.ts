import { useEffect, useState, useCallback, type RefObject } from "react";

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

/** Reactive transport state + imperative controls for a single <video>. */
export function useVideoController(ref: RefObject<HTMLVideoElement | null>, fps: number): VideoController {
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onDur = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onRate = () => setRateState(v.playbackRate);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onTime);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ratechange", onRate);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ratechange", onRate);
    };
  }, [ref]);

  const play = useCallback(() => ref.current?.play().catch(() => {}), [ref]);
  const pause = useCallback(() => ref.current?.pause(), [ref]);
  const toggle = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [ref]);
  const setRate = useCallback(
    (r: number) => {
      if (ref.current) ref.current.playbackRate = r;
    },
    [ref],
  );
  const seek = useCallback(
    (t: number) => {
      const v = ref.current;
      if (!v) return;
      const max = Number.isFinite(v.duration) ? v.duration : t;
      v.currentTime = Math.max(0, Math.min(t, max));
    },
    [ref],
  );
  const stepFrame = useCallback(
    (dir: number) => {
      const v = ref.current;
      if (!v) return;
      v.pause();
      const max = Number.isFinite(v.duration) ? v.duration : v.currentTime;
      v.currentTime = Math.max(0, Math.min(max, v.currentTime + dir / fps));
    },
    [ref, fps],
  );

  return { paused, time, duration, rate, play, pause, toggle, setRate, seek, stepFrame };
}

export const SPEEDS = [1, 0.5, 0.25, 0.1] as const;

/** mm:ss.mmm + frame index, for the scrubber readout. */
export function formatTime(t: number, fps: number): string {
  const frame = Math.round(t * fps);
  return `${t.toFixed(2)}s · f${frame}`;
}
