import { useReplay } from "./useReplay.js";
import { Dartboard } from "./Dartboard.js";
import type { Visit } from "@shared/types.js";

function scoreLine(v: Visit): string {
  if (v.darts.length === 0) return "no darts";
  return v.darts.map((d) => d.name).join("  ");
}

function VisitCard({ visit, onPlay }: { visit: Visit; onPlay: (v: Visit) => void }) {
  return (
    <button className="card" onClick={() => onPlay(visit)} disabled={!visit.clipUrl}>
      <div className="card__board">
        <Dartboard darts={visit.darts} />
      </div>
      <div className="card__meta">
        <span className="card__score">{visit.totalPoints}</span>
        <span className="card__darts">{scoreLine(visit)}</span>
        <span className="card__status">{visit.clipUrl ? "▶ replay" : "recording…"}</span>
      </div>
    </button>
  );
}

export function App() {
  const { status, visits, nowPlaying, playVisit, clearPlaying } = useReplay();

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
        {nowPlaying ? (
          <div className="player">
            <video
              key={nowPlaying.id}
              src={nowPlaying.clipUrl ?? undefined}
              autoPlay
              muted
              playsInline
              controls
              loop
            />
            <div className="player__board">
              <Dartboard darts={nowPlaying.darts} />
              <div className="player__score">
                <strong>{nowPlaying.totalPoints}</strong>
                <span>{scoreLine(nowPlaying)}</span>
              </div>
            </div>
            <button className="player__close" onClick={clearPlaying}>
              ✕
            </button>
          </div>
        ) : (
          <div className="stage__idle">
            <p>Waiting for your next throw…</p>
            <small>{status.board}</small>
          </div>
        )}
      </section>

      <section className="gallery">
        <h2>Last {visits.length} visits</h2>
        <div className="gallery__grid">
          {visits.map((v) => (
            <VisitCard key={v.id} visit={v} onPlay={playVisit} />
          ))}
          {visits.length === 0 && <p className="empty">No visits yet — throw some darts.</p>}
        </div>
      </section>
    </div>
  );
}
