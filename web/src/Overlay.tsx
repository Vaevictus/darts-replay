import { useCallback, useEffect, useRef } from "react";
import type { OverlayConfig } from "@shared/types.js";
import { usePersistedState } from "./hooks.js";

export type { OverlayConfig };

const KEY = "darts-replay.overlay";
export const DEFAULT_OVERLAY: OverlayConfig = { enabled: true, vertical: [0.5], horizontal: [0.4, 0.58] };

export function useOverlay() {
  return usePersistedState<OverlayConfig>(
    KEY,
    DEFAULT_OVERLAY,
    (raw) => ({ ...DEFAULT_OVERLAY, ...(JSON.parse(raw) as OverlayConfig) }),
    JSON.stringify,
  );
}

interface Props {
  config: OverlayConfig;
  onChange?: (c: OverlayConfig) => void; // omit to render read-only
}

/** Absolutely fills its (position:relative) parent and draws the guides. */
export function Overlay({ config, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ axis: "v" | "h"; index: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const root = rootRef.current;
      if (!d || !root || !onChange) return;
      const r = root.getBoundingClientRect();
      if (d.axis === "v") {
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const vertical = [...config.vertical];
        vertical[d.index] = x;
        onChange({ ...config, vertical });
      } else {
        const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        const horizontal = [...config.horizontal];
        horizontal[d.index] = y;
        onChange({ ...config, horizontal });
      }
    },
    [config, onChange],
  );

  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", up);
    };
  }, [onPointerMove]);

  if (!config.enabled) return null;
  const editable = !!onChange;

  return (
    <div ref={rootRef} className="overlay" aria-hidden>
      {config.vertical.map((x, i) => (
        <div key={`v${i}`} className="overlay__v" style={{ left: `${x * 100}%` }}>
          {editable && (
            <span
              className="overlay__handle overlay__handle--v"
              onPointerDown={() => (drag.current = { axis: "v", index: i })}
            />
          )}
        </div>
      ))}
      {config.horizontal.map((y, i) => (
        <div key={`h${i}`} className="overlay__h" style={{ top: `${y * 100}%` }}>
          {editable && (
            <span
              className="overlay__handle overlay__handle--h"
              onPointerDown={() => (drag.current = { axis: "h", index: i })}
            />
          )}
        </div>
      ))}
    </div>
  );
}
