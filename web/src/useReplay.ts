import { useEffect, useRef, useState, useCallback } from "react";
import type { Visit, Dart } from "@shared/types.js";
import type { ServerMessage } from "@shared/messages.js";
import { invalidateConfigCache } from "./api.js";

export interface Status {
  phase: string;
  dartsCount: number;
  board: string;
  connected: boolean;
}

export interface ReplayState {
  status: Status;
  visits: Visit[]; // newest first
  liveDarts: Dart[]; // in-progress visit's darts (not yet a completed visit)
  nowPlaying: Visit | null;
  playVisit: (v: Visit) => void;
  clearPlaying: () => void;
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export function useReplay(): ReplayState {
  const [status, setStatus] = useState<Status>({
    phase: "IDLE",
    dartsCount: 0,
    board: "—",
    connected: false,
  });
  const [visits, setVisits] = useState<Visit[]>([]);
  const [liveDarts, setLiveDarts] = useState<Dart[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Visit | null>(null);
  const visitsRef = useRef<Visit[]>([]);
  visitsRef.current = visits;

  const upsert = useCallback((v: Visit) => {
    setVisits((prev) => {
      const rest = prev.filter((x) => x.id !== v.id);
      return [v, ...rest].sort((a, b) => b.finishedAt - a.finishedAt);
    });
  }, []);

  const remove = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setVisits((prev) => prev.filter((x) => !gone.has(x.id)));
    // If the clip currently on screen was pruned, stop playing it (it now 404s).
    setNowPlaying((cur) => (cur && gone.has(cur.id) ? null : cur));
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setStatus((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setStatus((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return; // ignore malformed frames rather than crashing the socket handler
        }
        switch (msg.type) {
          case "state":
            setStatus((s) => ({ ...s, phase: msg.phase, dartsCount: msg.dartsCount, board: msg.board }));
            setLiveDarts(msg.darts ?? []);
            break;
          case "visit":
            upsert(msg.visit);
            break;
          case "visit-ready":
            upsert(msg.visit);
            if (msg.visit.clipUrl) setNowPlaying(msg.visit); // auto-replay
            break;
          case "visit-removed":
            remove(msg.ids);
            break;
          case "play": {
            const v = visitsRef.current.find((x) => x.id === msg.visitId);
            if (v) setNowPlaying(v);
            break;
          }
          case "config":
            // Another client changed the config — drop the cache so later reads refetch.
            invalidateConfigCache();
            break;
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [upsert, remove]);

  const playVisit = useCallback((v: Visit) => setNowPlaying(v), []);
  const clearPlaying = useCallback(() => setNowPlaying(null), []);

  return { status, visits, liveDarts, nowPlaying, playVisit, clearPlaying };
}
