import { useRef, useState } from "react";
import type { Visit } from "@shared/types.js";
import { Overlay, type OverlayConfig } from "./Overlay.js";
import { useVideoController, SPEEDS, formatTime } from "./useVideoController.js";

interface Props {
  a: Visit;
  b: Visit;
  fps: number;
  overlay: OverlayConfig;
  onOverlayChange: (c: OverlayConfig) => void;
  onClose: () => void;
}

/** Side-by-side compare with a linked controller. A per-side offset lets you
 * align the release moments, then step/scrub/play both in sync. */
export function CompareView({ a, b, fps, overlay, onOverlayChange, onClose }: Props) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const ca = useVideoController(aRef, fps);
  const cb = useVideoController(bRef, fps);
  const [offset, setOffset] = useState(0); // seconds added to A's time for B

  const seekBoth = (t: number) => {
    ca.seek(t);
    cb.seek(t + offset);
  };
  const stepBoth = (dir: number) => {
    ca.stepFrame(dir);
    cb.stepFrame(dir);
  };
  const toggleBoth = () => {
    if (ca.paused) {
      ca.play();
      cb.play();
    } else {
      ca.pause();
      cb.pause();
    }
  };
  const setRateBoth = (r: number) => {
    ca.setRate(r);
    cb.setRate(r);
  };
  const nudgeOffset = (frames: number) => {
    const next = offset + frames / fps;
    setOffset(next);
    cb.seek(ca.time + next);
  };

  const side = (visit: Visit, ref: React.RefObject<HTMLVideoElement | null>, label: string) => (
    <div className="compare__side">
      <div className="compare__label">
        {label}: #{visit.seq}{" "}
        {visit.rating === "good" ? "👍" : visit.rating === "bad" ? "👎" : ""} · {visit.totalPoints}
      </div>
      <div className="player__frame">
        <div className="player__zoom">
          <video ref={ref} key={visit.id} src={visit.clipUrl ?? undefined} muted playsInline />
        </div>
        <Overlay config={overlay} onChange={onOverlayChange} />
      </div>
    </div>
  );

  return (
    <div className="compare">
      <div className="compare__sides">
        {side(a, aRef, "A")}
        {side(b, bRef, "B")}
      </div>

      <div className="controls">
        <div className="controls__row">
          <button onClick={() => stepBoth(-1)} aria-label="Both previous frame">
            ◀▏
          </button>
          <button onClick={toggleBoth}>{ca.paused ? "▶ Play both" : "❚❚ Pause both"}</button>
          <button onClick={() => stepBoth(1)} aria-label="Both next frame">
            ▕▶
          </button>
          <span className="controls__time">A {formatTime(ca.time, fps)}</span>
          <span className="controls__speeds">
            {SPEEDS.map((s) => (
              <button key={s} className={ca.rate === s ? "active" : ""} onClick={() => setRateBoth(s)}>
                {s}×
              </button>
            ))}
          </span>
        </div>

        <input
          className="controls__scrub"
          type="range"
          min={0}
          max={ca.duration || 0}
          step={1 / fps}
          value={ca.time}
          onChange={(e) => seekBoth(Number(e.target.value))}
        />

        <div className="controls__row controls__row--sub">
          <span className="controls__group">
            <label>Align B</label>
            <button onClick={() => nudgeOffset(-1)}>−1 frame</button>
            <span className="controls__time">offset {offset >= 0 ? "+" : ""}{(offset * 1000).toFixed(0)}ms</span>
            <button onClick={() => nudgeOffset(1)}>+1 frame</button>
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
          <button className="compare__close" onClick={onClose}>
            ✕ Close compare
          </button>
        </div>
      </div>
    </div>
  );
}
