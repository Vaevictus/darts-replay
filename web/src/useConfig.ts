import { useCallback, useEffect, useMemo, useState } from "react";
import type { Config, Visit } from "@shared/types.js";
import type { HeatmapMode, HeatmapScale } from "./Heatmap.js";
import { getConfig, putConfig } from "./api.js";

const HEAT_MODE_KEY = "darts-replay.heatmapMode";
const HEAT_SCALE_KEY = "darts-replay.heatmapScale";
const HEAT_STORE_KEY = "darts-replay.heatmapStore";

/** Heatmap color style (blue→red ramp vs orange glow), persisted in localStorage. */
export function useHeatmapMode(): [HeatmapMode, (m: HeatmapMode) => void] {
  const [mode, setMode] = useState<HeatmapMode>(() => {
    const raw = localStorage.getItem(HEAT_MODE_KEY);
    return raw === "glow" || raw === "ramp" ? raw : "ramp";
  });
  const set = useCallback((m: HeatmapMode) => {
    setMode(m);
    try {
      localStorage.setItem(HEAT_MODE_KEY, m);
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  return [mode, set];
}

/** Heatmap intensity scale (relative-to-densest vs absolute), persisted. */
export function useHeatmapScale(): [HeatmapScale, (s: HeatmapScale) => void] {
  const [scale, setScale] = useState<HeatmapScale>(() => {
    const raw = localStorage.getItem(HEAT_SCALE_KEY);
    return raw === "relative" || raw === "absolute" ? raw : "relative";
  });
  const set = useCallback((s: HeatmapScale) => {
    setScale(s);
    try {
      localStorage.setItem(HEAT_SCALE_KEY, s);
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  return [scale, set];
}

type Coord = { x: number; y: number };
type HeatStore = Record<string, [number, number]>; // "visitId#dartIndex" -> [x, y]

export interface HeatmapStore {
  coords: Coord[];
  ingest: (visits: Visit[]) => void;
  reset: () => void;
}

/**
 * Persistent accumulator of every dart position seen, keyed by visit+dart so it
 * dedupes and keeps growing past the trailing visit-retention window. Reset wipes
 * it. This is the dataset the heatmap is drawn from (plus live in-progress darts).
 */
export function useHeatmapStore(): HeatmapStore {
  const [store, setStore] = useState<HeatStore>(() => {
    try {
      const raw = localStorage.getItem(HEAT_STORE_KEY);
      return raw ? (JSON.parse(raw) as HeatStore) : {};
    } catch {
      return {};
    }
  });

  const persist = (s: HeatStore) => {
    try {
      localStorage.setItem(HEAT_STORE_KEY, JSON.stringify(s));
    } catch {
      /* storage may be unavailable */
    }
  };

  const ingest = useCallback((visits: Visit[]) => {
    setStore((prev) => {
      let next: HeatStore | null = null;
      for (const v of visits) {
        for (const d of v.darts) {
          if (!d.coords) continue;
          const key = `${v.id}#${d.index}`;
          if (prev[key] || next?.[key]) continue;
          if (!next) next = { ...prev };
          next[key] = [d.coords.x, d.coords.y];
        }
      }
      if (!next) return prev; // nothing new — keep the same reference
      persist(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setStore({});
    persist({});
  }, []);

  const coords = useMemo(() => Object.values(store).map(([x, y]) => ({ x, y })), [store]);
  return { coords, ingest, reset };
}

const DEFAULT_BOARD_CAL: Config["calibration"]["board"] = {
  x: 0.5,
  y: 0.5,
  scale: 0.6,
  rotation: 0,
  opacity: 0.4,
  show: false,
};

/** The calibrated board-overlay placement, for rendering it over replay videos.
 * Returns the value plus a `reload` to refresh it after the Settings screen edits it. */
export function useBoardCalibration(): [Config["calibration"]["board"], () => void] {
  const [cal, setCal] = useState(DEFAULT_BOARD_CAL);
  const reload = useCallback(() => {
    getConfig()
      .then((c) => setCal(c.calibration.board))
      .catch(() => {});
  }, []);
  useEffect(() => reload(), [reload]);
  return [cal, reload];
}

const SYNC_KEY = "darts-replay.syncOffsetMs";
const DEFAULT_SYNC_OFFSET = 600; // ms to delay impact reveals (video pipeline lags detection)

/** How long (ms) to delay synced dart-impact reveals so markers match the video.
 * A setup-specific constant (recording latency), persisted in localStorage. */
export function useSyncOffset(): [number, (ms: number) => void] {
  const [offset, setOffset] = useState(() => {
    const raw = localStorage.getItem(SYNC_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_SYNC_OFFSET;
  });
  const set = useCallback((ms: number) => {
    setOffset(ms);
    try {
      localStorage.setItem(SYNC_KEY, String(ms));
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  return [offset, set];
}

/** Fetch the capture fps once (for frame-accurate stepping). Defaults to 30. */
export function useFps(): number {
  const [fps, setFps] = useState(30);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        const f = c?.webcam?.fps;
        if (typeof f === "number" && f > 0) setFps(f);
      })
      .catch(() => {});
  }, []);
  return fps;
}

export interface ConfigEditor {
  config: Config | null; // last saved
  draft: Config | null; // working copy
  setDraft: (c: Config) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<Config | undefined>;
  reset: () => void; // discard edits
}

/** Load /api/config into an editable draft and persist it via PUT. */
export function useConfigEditor(): ConfigEditor {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getConfig()
      .then((c) => {
        if (!live) return;
        setConfig(c);
        setDraft(c);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(draft), [config, draft]);

  const save = useCallback(async () => {
    if (!draft) return undefined;
    setSaving(true);
    setError(null);
    try {
      const saved = await putConfig(draft);
      setConfig(saved);
      setDraft(saved);
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const reset = useCallback(() => setDraft(config), [config]);

  return { config, draft, setDraft, dirty, saving, error, save, reset };
}
