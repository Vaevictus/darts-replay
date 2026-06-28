import { useEffect, useMemo, useState } from "react";
import type { Config } from "@shared/types.js";
import { Overlay, useOverlay } from "./Overlay.js";
import { BoardOverlay, type BoardCal } from "./BoardOverlay.js";
import { startPreview, stopPreview } from "./api.js";

interface Props {
  webcam: Config["webcam"]; // draft settings — the live view reflects unsaved edits
  cal: BoardCal;
  onCalChange: (c: BoardCal) => void;
}

/**
 * Live camera view for positioning. Pauses recording while mounted (pause-and-
 * stream) and shows the MJPEG feed with alignment guides and a draggable board.
 * The stream URL carries the draft webcam params, so changing device/resolution/
 * orientation re-connects the feed and previews the change before saving.
 */
export function CameraPreview({ webcam, cal, onCalChange }: Props) {
  const [overlay, setOverlay] = useOverlay();
  const [nonce, setNonce] = useState(0);
  const [errored, setErrored] = useState(false);

  // Enter preview mode on mount; always resume recording on unmount / tab close.
  useEffect(() => {
    void startPreview();
    const onHide = () => navigator.sendBeacon?.("/api/camera/preview/stop");
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void stopPreview();
    };
  }, []);

  const src = useMemo(() => {
    const p = new URLSearchParams({
      device: webcam.device,
      format: webcam.format,
      width: String(webcam.width),
      height: String(webcam.height),
      fps: String(webcam.fps),
      rotation: String(webcam.rotation),
      flipH: webcam.flipH ? "1" : "0",
      flipV: webcam.flipV ? "1" : "0",
      n: String(nonce),
    });
    return `/api/camera/stream?${p.toString()}`;
  }, [webcam, nonce]);

  // New URL on settings change → clear any prior error state.
  useEffect(() => setErrored(false), [src]);

  const setCal = (patch: Partial<BoardCal>) => onCalChange({ ...cal, ...patch });

  return (
    <div className="preview">
      <div className="preview__frame">
        {errored ? (
          <div className="preview__error">
            <p>No camera feed.</p>
            <small>Check the camera device/format, then reload.</small>
          </div>
        ) : (
          <img className="preview__img" src={src} alt="Live camera" onError={() => setErrored(true)} />
        )}
        <Overlay config={overlay} onChange={setOverlay} />
        <BoardOverlay cal={cal} wireframe onChange={onCalChange} />
      </div>

      <div className="preview__controls">
        <span className="preview__group">
          <button onClick={() => setNonce((n) => n + 1)}>↻ Reload feed</button>
        </span>

        <span className="preview__group">
          <label>Guides</label>
          <button
            className={overlay.enabled ? "active" : ""}
            onClick={() => setOverlay({ ...overlay, enabled: !overlay.enabled })}
          >
            {overlay.enabled ? "On" : "Off"}
          </button>
        </span>

        <span className="preview__group">
          <label>Board overlay</label>
          <button className={cal.show ? "active" : ""} onClick={() => setCal({ show: !cal.show })}>
            {cal.show ? "On" : "Off"}
          </button>
        </span>

        {cal.show && (
          <>
            <span className="preview__group">
              <label>Size</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                value={cal.scale}
                onChange={(e) => setCal({ scale: Number(e.target.value) })}
              />
            </span>
            <span className="preview__group">
              <label>Rotate</label>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={cal.rotation}
                onChange={(e) => setCal({ rotation: Number(e.target.value) })}
              />
            </span>
            <span className="preview__group">
              <label>Opacity</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={cal.opacity}
                onChange={(e) => setCal({ opacity: Number(e.target.value) })}
              />
            </span>
          </>
        )}
      </div>
      <p className="preview__hint">Recording is paused while this screen is open.</p>
    </div>
  );
}
