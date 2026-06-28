import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "./useReplay.js";
import { boardCommand, type BoardCommand } from "./api.js";
import { useConfirm } from "./hooks.js";

/**
 * Quick Board-Manager actions in the topbar, mirroring the autodarts Play UI:
 * a live connection indicator, a Reset (re-arm to throw-ready), and a Calibrate.
 * Calibrate is two-step (click → confirm) since it disrupts an in-progress board.
 */
export function BoardActions({ status }: { status: Status }) {
  const [busy, setBusy] = useState<BoardCommand | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [calArmed, triggerCal] = useConfirm();
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMsg(null), 3000);
  };

  const run = useCallback(async (action: BoardCommand) => {
    setBusy(action);
    const r = await boardCommand(action);
    flash(r.ok, r.ok ? (action === "reset" ? "Board reset" : "Calibration started") : `Failed: ${r.error ?? "error"}`);
    setBusy(null);
  }, []);

  const disabled = busy !== null || !status.connected;

  return (
    <div className="boardbar">
      <span className="boardbar__conn" title={status.connected ? "Board connected" : "Board not reachable"}>
        <span className={`dot ${status.connected ? "ok" : "bad"}`} />
        <span className="boardbar__board">{status.board}</span>
      </span>
      <button onClick={() => void run("reset")} disabled={disabled} title="Re-arm the board to the throw-ready state">
        {busy === "reset" ? "Resetting…" : "↺ Reset"}
      </button>
      <button
        className={calArmed ? "warn" : ""}
        onClick={() => triggerCal(() => void run("calibrate"))}
        disabled={disabled}
        title="Run camera auto-calibration"
      >
        {busy === "calibrate" ? "Calibrating…" : calArmed ? "Confirm calibrate?" : "🎯 Calibrate"}
      </button>
      {msg && <span className={`boardbar__msg ${msg.ok ? "ok" : "bad"}`}>{msg.text}</span>}
    </div>
  );
}
