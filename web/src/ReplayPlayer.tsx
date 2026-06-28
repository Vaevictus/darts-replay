import { useEffect, useMemo, useRef, useState } from "react";
import type { Visit, Config } from "@shared/types.js";
import { Dartboard } from "./Dartboard.js";
import { Overlay, type OverlayConfig } from "./Overlay.js";
import { BoardOverlay, revealedCount, hasImpactTiming } from "./BoardOverlay.js";
import { useVideoController, SPEEDS, formatTime } from "./useVideoController.js";
import { patchVisit } from "./api.js";

interface Props {
  visit: Visit;
  fps: number;
  overlay: OverlayConfig;
  onOverlayChange: (c: OverlayConfig) => void;
  boardCal: Config["calibration"]["board"];
  syncOffsetMs: number;
  onSyncOffsetChange: (ms: number) => void;
  autoPlay?: boolean;
  onClose?: () => void;
}

const ZOOMS = [1, 1.5, 2, 3];

export function ReplayPlayer({
  visit,
  fps,
  overlay,
  onOverlayChange,
  boardCal,
  syncOffsetMs,
  onSyncOffsetChange,
  autoPlay,
  onClose,
}: Props) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const ctrl = useVideoController(videoEl, fps);

  // Reveal darts in sync with playback. Memoize on the count so the board SVG
  // only rebuilds when a dart actually lands, not on every time tick.
  const shownCount = revealedCount(visit.darts, visit.clipStartMs, ctrl.time, syncOffsetMs);
  const shownDarts = useMemo(() => visit.darts.slice(0, shownCount), [visit.darts, shownCount]);
  const synced = hasImpactTiming(visit.darts, visit.clipStartMs);

  // When the selected clip changes, force the <video> to load the new source and
  // (if auto-playing) start it. Swapping a video's src alone doesn't reliably
  // reload it — without this, clicking another clip mid-playback kept the old one.
  useEffect(() => {
    if (!videoEl) return;
    videoEl.load();
    if (autoPlay) void videoEl.play().catch(() => {});
  }, [videoEl, visit.clipUrl, autoPlay]);

  // A–B loop — markers are clip-specific, so clear them when the clip changes.
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    setA(null);
    setB(null);
    setLoop(false);
  }, [visit.id]);
  useEffect(() => {
    if (loop && a !== null && b !== null && b > a && ctrl.time >= b) ctrl.seek(a);
  }, [loop, a, b, ctrl]);

  // Zoom + pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onPanDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    panning.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = panning.current;
      if (!p) return;
      setPan({ x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) });
    };
    const up = () => (panning.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // Self-review metadata (good/bad form, save, note)
  const [note, setNote] = useState(visit.note);
  useEffect(() => setNote(visit.note), [visit.id, visit.note]);
  const rate = (rating: Visit["rating"]) =>
    void patchVisit(visit.id, { rating: visit.rating === rating ? null : rating }).catch(() => {});
  const toggleSave = () => void patchVisit(visit.id, { saved: !visit.saved }).catch(() => {});
  const saveNote = () => {
    if (note !== visit.note) void patchVisit(visit.id, { note }).catch(() => {});
  };

  return (
    <div className="player">
      <div className="player__stage">
        <div className="player__frame" onPointerDown={onPanDown}>
          <div
            className="player__zoom"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <video
              ref={setVideoEl}
              key={visit.id}
              src={visit.clipUrl ?? undefined}
              autoPlay={autoPlay}
              muted
              playsInline
              loop={!loop}
            />
          </div>
          <Overlay config={overlay} onChange={onOverlayChange} />
          <BoardOverlay cal={boardCal} darts={shownDarts} />
        </div>
        {onClose && (
          <button className="player__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className="controls">
        <div className="controls__row">
          <button onClick={() => ctrl.stepFrame(-1)} aria-label="Previous frame">
            ◀▏
          </button>
          <button onClick={ctrl.toggle}>{ctrl.paused ? "▶ Play" : "❚❚ Pause"}</button>
          <button onClick={() => ctrl.stepFrame(1)} aria-label="Next frame">
            ▕▶
          </button>
          <span className="controls__time">{formatTime(ctrl.time, fps)}</span>
          <span className="controls__speeds">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={ctrl.rate === s ? "active" : ""}
                onClick={() => ctrl.setRate(s)}
              >
                {s}×
              </button>
            ))}
          </span>
        </div>

        <input
          className="controls__scrub"
          type="range"
          min={0}
          max={ctrl.duration || 0}
          step={1 / fps}
          value={ctrl.time}
          onChange={(e) => ctrl.seek(Number(e.target.value))}
        />

        <div className="controls__row controls__row--sub">
          <span className="controls__group">
            <label>Loop</label>
            <button onClick={() => setA(ctrl.time)}>Set A{a !== null ? ` (${a.toFixed(2)})` : ""}</button>
            <button onClick={() => setB(ctrl.time)}>Set B{b !== null ? ` (${b.toFixed(2)})` : ""}</button>
            <button className={loop ? "active" : ""} onClick={() => setLoop((v) => !v)}>
              {loop ? "Looping" : "Loop A–B"}
            </button>
            <button
              onClick={() => {
                setA(null);
                setB(null);
                setLoop(false);
              }}
            >
              Clear
            </button>
          </span>
          <span className="controls__group">
            <label>Zoom</label>
            {ZOOMS.map((z) => (
              <button
                key={z}
                className={zoom === z ? "active" : ""}
                onClick={() => {
                  setZoom(z);
                  if (z === 1) setPan({ x: 0, y: 0 });
                }}
              >
                {z}×
              </button>
            ))}
          </span>
          <span className="controls__group">
            <label>Guides</label>
            <button
              className={overlay.enabled ? "active" : ""}
              onClick={() => onOverlayChange({ ...overlay, enabled: !overlay.enabled })}
            >
              {overlay.enabled ? "On" : "Off"}
            </button>
          </span>
          {synced && boardCal.show && (
            <span className="controls__group">
              <label>Impact sync</label>
              <input
                type="range"
                min={-500}
                max={2500}
                step={50}
                value={syncOffsetMs}
                onChange={(e) => onSyncOffsetChange(Number(e.target.value))}
                title="Delay the dart markers to line them up with the video"
              />
              <span className="controls__time">{syncOffsetMs >= 0 ? "+" : ""}{syncOffsetMs}ms</span>
            </span>
          )}
        </div>
      </div>

      <div className="review">
        <div className="review__board">
          <Dartboard darts={visit.darts} />
        </div>
        <div className="review__meta">
          <div className="review__rate">
            <button className={`rate good ${visit.rating === "good" ? "active" : ""}`} onClick={() => rate("good")}>
              👍 Good form
            </button>
            <button className={`rate bad ${visit.rating === "bad" ? "active" : ""}`} onClick={() => rate("bad")}>
              👎 Bad form
            </button>
            <button className={`rate save ${visit.saved ? "active" : ""}`} onClick={toggleSave}>
              {visit.saved ? "★ Saved" : "☆ Save"}
            </button>
          </div>
          <textarea
            className="review__note"
            placeholder="Notes on this throw (stance, elbow, sway…)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
          />
          <div className="review__score">
            visit #{visit.seq} · <strong>{visit.totalPoints}</strong> ·{" "}
            {visit.darts.map((d) => d.name).join(" ") || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
