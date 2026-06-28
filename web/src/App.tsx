import { useEffect, useMemo, useState } from "react";
import { useReplay } from "./useReplay.js";
import { Dartboard } from "./Dartboard.js";
import { ReplayPlayer } from "./ReplayPlayer.js";
import { CompareView } from "./CompareView.js";
import { Settings } from "./Settings.js";
import { BoardActions } from "./BoardActions.js";
import { Heatmap } from "./Heatmap.js";
import { useConfirm } from "./hooks.js";
import {
  useFps,
  useBoardCalibration,
  useSyncOffset,
  useHeatmapMode,
  useHeatmapScale,
  useHeatmapStore,
} from "./useConfig.js";
import { useOverlay } from "./Overlay.js";
import type { Visit } from "@shared/types.js";

type Filter = "all" | "saved" | "good" | "bad";

function ratingBadge(v: Visit): string {
  if (v.saved) return v.rating === "good" ? "★👍" : v.rating === "bad" ? "★👎" : "★";
  return v.rating === "good" ? "👍" : v.rating === "bad" ? "👎" : "";
}

function VisitCard({
  visit,
  onPlay,
  onToggleCompare,
  comparing,
}: {
  visit: Visit;
  onPlay: (v: Visit) => void;
  onToggleCompare: (v: Visit) => void;
  comparing: boolean;
}) {
  return (
    <div className={`card ${comparing ? "card--cmp" : ""}`}>
      <button className="card__play" onClick={() => onPlay(visit)} disabled={!visit.clipUrl}>
        <div className="card__board">
          <Dartboard darts={visit.darts} />
        </div>
        <div className="card__meta">
          <span className="card__badge">{ratingBadge(visit)}</span>
          <span className="card__score">{visit.totalPoints}</span>
          <span className="card__status">{visit.clipUrl ? "▶ review" : "recording…"}</span>
        </div>
      </button>
      <button className="card__cmp" onClick={() => onToggleCompare(visit)} disabled={!visit.clipUrl}>
        {comparing ? "⇄ selected" : "⇄ compare"}
      </button>
    </div>
  );
}

export function App() {
  const { status, visits, liveDarts, nowPlaying, playVisit, clearPlaying } = useReplay();
  const fps = useFps();
  const [boardCal, reloadBoardCal] = useBoardCalibration();
  const [syncOffset, setSyncOffset] = useSyncOffset();
  const [overlay, setOverlay] = useOverlay();
  const [filter, setFilter] = useState<Filter>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(true);
  const [heatMode, setHeatMode] = useHeatmapMode();
  const [heatScale, setHeatScale] = useHeatmapScale();
  const [resetArmed, triggerReset] = useConfirm();
  const { coords: storeCoords, ingest: ingestHeat, reset: resetHeat } = useHeatmapStore();

  // The heatmap draws from its own accumulating store (survives visit pruning),
  // seeded from whatever visits we've seen. Plus the in-progress visit's darts,
  // shown live and gated to RECORDING so they aren't double-counted once landed.
  useEffect(() => ingestHeat(visits), [visits, ingestHeat]);
  const liveCoords = useMemo(
    () =>
      (status.phase === "RECORDING" ? liveDarts : [])
        .map((d) => d.coords)
        .filter((c): c is { x: number; y: number } => !!c),
    [liveDarts, status.phase],
  );
  const heatCoords = useMemo(() => [...storeCoords, ...liveCoords], [storeCoords, liveCoords]);

  // Resolve to the live visit objects so rating/save edits reflect immediately.
  const byId = (id: string | undefined) => visits.find((v) => v.id === id);
  const playing = nowPlaying ? (byId(nowPlaying.id) ?? nowPlaying) : null;
  const cmp = compareIds.map(byId).filter((v): v is Visit => !!v);

  const filtered = useMemo(() => {
    if (filter === "saved") return visits.filter((v) => v.saved);
    if (filter === "good") return visits.filter((v) => v.rating === "good");
    if (filter === "bad") return visits.filter((v) => v.rating === "bad");
    return visits;
  }, [visits, filter]);

  const toggleCompare = (v: Visit) =>
    setCompareIds((ids) =>
      ids.includes(v.id) ? ids.filter((x) => x !== v.id) : [...ids, v.id].slice(-2),
    );

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎯 Darts Replay</h1>
        <BoardActions status={status} />
        <div className="status">
          <span className="status__phase">{status.phase}</span>
          {status.phase === "RECORDING" && <span className="status__darts">{status.dartsCount}/3</span>}
          <button className="topbar__settings" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            ⚙
          </button>
        </div>
      </header>

      {settingsOpen && (
        <Settings
          onClose={() => {
            setSettingsOpen(false);
            reloadBoardCal();
          }}
        />
      )}

      <section className="stage">
        {compareOpen && cmp.length === 2 ? (
          <CompareView
            a={cmp[0]}
            b={cmp[1]}
            fps={fps}
            overlay={overlay}
            onOverlayChange={setOverlay}
            boardCal={boardCal}
            syncOffsetMs={syncOffset}
            onClose={() => setCompareOpen(false)}
          />
        ) : playing?.clipUrl ? (
          <ReplayPlayer
            visit={playing}
            fps={fps}
            overlay={overlay}
            onOverlayChange={setOverlay}
            boardCal={boardCal}
            syncOffsetMs={syncOffset}
            onSyncOffsetChange={setSyncOffset}
            autoPlay
            onClose={clearPlaying}
          />
        ) : (
          <div className="stage__idle">
            <p>Waiting for your next throw…</p>
            <small>{status.board}</small>
          </div>
        )}
      </section>

      {cmp.length > 0 && (
        <div className="cmpbar">
          <span>
            Compare: {cmp.map((v) => `#${v.seq}`).join(" vs ")}
            {cmp.length < 2 && " — pick one more"}
          </span>
          <button disabled={cmp.length !== 2} onClick={() => setCompareOpen(true)}>
            Compare
          </button>
          <button onClick={() => { setCompareIds([]); setCompareOpen(false); }}>Clear</button>
        </div>
      )}

      <section className="heatmap">
        <div className="heatmap__head">
          <button className="heatmap__title" onClick={() => setHeatmapOpen((o) => !o)}>
            {heatmapOpen ? "▾" : "▸"} Heatmap
          </button>
          <span className="heatmap__count">{heatCoords.length} darts</span>
        </div>
        {heatmapOpen && (
          <>
            <div className="heatmap__body">
              {heatCoords.length === 0 ? (
                <p className="heatmap__empty">Throw to build your heatmap.</p>
              ) : (
                <Heatmap coords={heatCoords} mode={heatMode} scale={heatScale} />
              )}
            </div>
            <div className="heatmap__controls">
              <button onClick={() => setHeatMode(heatMode === "ramp" ? "glow" : "ramp")} title="Color style">
                {heatMode === "ramp" ? "🔵→🔴 Ramp" : "🟠 Glow"}
              </button>
              {heatMode === "ramp" && (
                <button
                  onClick={() => setHeatScale(heatScale === "relative" ? "absolute" : "relative")}
                  title="Relative scales colors to your densest spot; Absolute needs real pile-up to go red"
                >
                  {heatScale === "relative" ? "Relative" : "Absolute"}
                </button>
              )}
              <button
                className="heatmap__reset"
                onClick={() => triggerReset(resetHeat)}
                title="Clear the accumulated heatmap data"
              >
                {resetArmed ? "Confirm reset?" : "↺ Reset data"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="gallery">
        <div className="gallery__head">
          <h2>Visits</h2>
          <div className="filters">
            {(["all", "saved", "good", "bad"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="gallery__grid">
          {filtered.map((v) => (
            <VisitCard
              key={v.id}
              visit={v}
              onPlay={playVisit}
              onToggleCompare={toggleCompare}
              comparing={compareIds.includes(v.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="empty">{filter === "all" ? "No visits yet — throw some darts." : `No ${filter} visits.`}</p>
          )}
        </div>
      </section>
    </div>
  );
}
