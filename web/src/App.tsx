import { useMemo, useState } from "react";
import { useReplay } from "./useReplay.js";
import { Dartboard } from "./Dartboard.js";
import { ReplayPlayer } from "./ReplayPlayer.js";
import { CompareView } from "./CompareView.js";
import { useFps } from "./useConfig.js";
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
  const { status, visits, nowPlaying, playVisit, clearPlaying } = useReplay();
  const fps = useFps();
  const [overlay, setOverlay] = useOverlay();
  const [filter, setFilter] = useState<Filter>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

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
        <div className="status">
          <span className={`dot ${status.connected ? "ok" : "bad"}`} />
          <span className="status__board">{status.board}</span>
          <span className="status__phase">{status.phase}</span>
          {status.phase === "RECORDING" && <span className="status__darts">{status.dartsCount}/3</span>}
        </div>
      </header>

      <section className="stage">
        {compareOpen && cmp.length === 2 ? (
          <CompareView
            a={cmp[0]}
            b={cmp[1]}
            fps={fps}
            overlay={overlay}
            onOverlayChange={setOverlay}
            onClose={() => setCompareOpen(false)}
          />
        ) : playing?.clipUrl ? (
          <ReplayPlayer
            visit={playing}
            fps={fps}
            overlay={overlay}
            onOverlayChange={setOverlay}
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
