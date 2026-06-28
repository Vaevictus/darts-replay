import { useEffect, useState } from "react";
import type { Config } from "@shared/types.js";
import { useConfigEditor } from "./useConfig.js";
import { getCameras, testBoard, type Camera, type BoardTestResult } from "./api.js";
import { CameraPreview } from "./CameraPreview.js";

const ROTATIONS: Config["webcam"]["rotation"][] = [0, 90, 180, 270];

interface Health {
  board: string;
  ringHealthy: boolean;
  ringBytes: number;
  previewing: boolean;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__input">
        <input
          type="number"
          value={value}
          min={min}
          step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="field__suffix">{suffix}</span>}
      </span>
    </label>
  );
}

function CameraSection({
  webcam,
  cameras,
  onChange,
}: {
  webcam: Config["webcam"];
  cameras: Camera[];
  onChange: (patch: Partial<Config["webcam"]>) => void;
}) {
  const selected = cameras.find((c) => c.path === webcam.device);
  const caps = selected?.caps ?? [];
  const hasCaps = caps.length > 0;

  // Format options: the camera's detected formats, else the full config set.
  const detected = Array.from(new Set(caps.map((c) => c.normalized).filter((f): f is NonNullable<typeof f> => !!f)));
  const formatOptions: readonly string[] = hasCaps ? detected : ["mjpeg", "h264", "yuyv422"];
  const sizes = caps.find((c) => c.normalized === webcam.format)?.sizes ?? [];
  const size = sizes.find((s) => s.w === webcam.width && s.h === webcam.height);

  return (
    <div className="settings__grid">
      <label className="field">
        <span className="field__label">Camera</span>
        <select value={webcam.device} onChange={(e) => onChange({ device: e.target.value })}>
          {!cameras.some((c) => c.path === webcam.device) && (
            <option value={webcam.device}>{webcam.device} (current)</option>
          )}
          {cameras.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name === c.path ? c.path : `${c.name} — ${c.path}`}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Format</span>
        <select value={webcam.format} onChange={(e) => onChange({ format: e.target.value as Config["webcam"]["format"] })}>
          {formatOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      {hasCaps ? (
        <>
          <label className="field">
            <span className="field__label">Resolution</span>
            <select
              value={`${webcam.width}x${webcam.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                onChange({ width: w, height: h });
              }}
            >
              {sizes.map((s) => (
                <option key={`${s.w}x${s.h}`} value={`${s.w}x${s.h}`}>
                  {s.w}×{s.h}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">FPS</span>
            <select value={webcam.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
              {(size?.fps ?? [webcam.fps]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <NumberField label="Width" value={webcam.width} min={16} onChange={(width) => onChange({ width })} />
          <NumberField label="Height" value={webcam.height} min={16} onChange={(height) => onChange({ height })} />
          <NumberField label="FPS" value={webcam.fps} min={1} onChange={(fps) => onChange({ fps })} />
        </>
      )}
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { draft, setDraft, dirty, saving, error, save, reset } = useConfigEditor();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [test, setTest] = useState<BoardTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    getCameras()
      .then(setCameras)
      .catch(() => setCameras([]));
  }, []);

  // Poll health while open (ring is paused during preview — expected).
  useEffect(() => {
    let live = true;
    const tick = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((h) => live && setHealth(h))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!draft) {
    return (
      <div className="settings">
        <div className="settings__panel">
          <p className="settings__loading">{error ? `Error: ${error}` : "Loading settings…"}</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const setSection = <K extends keyof Config>(section: K, patch: Partial<Config[K]>) =>
    setDraft({ ...draft, [section]: { ...(draft[section] as object), ...patch } });
  const setBoard = (patch: Partial<Config["board"]>) => setSection("board", patch);
  const setWebcam = (patch: Partial<Config["webcam"]>) => setSection("webcam", patch);
  const setRecorder = (patch: Partial<Config["recorder"]>) => setSection("recorder", patch);
  const setVisit = (patch: Partial<Config["visit"]>) => setSection("visit", patch);
  const setCal = (board: Config["calibration"]["board"]) => setDraft({ ...draft, calibration: { board } });
  const setSharing = (patch: Partial<Config["sharing"]>) => setSection("sharing", patch);
  const setStreamable = (patch: Partial<Config["sharing"]["streamable"]>) =>
    setDraft({ ...draft, sharing: { ...draft.sharing, streamable: { ...draft.sharing.streamable, ...patch } } });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await testBoard(draft.board.host, draft.board.port));
    } finally {
      setTesting(false);
    }
  };

  const onSave = () => {
    void save().catch(() => {});
  };
  const orientationIgnored = draft.webcam.encoder === "copy";

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings__panel">
        <header className="settings__head">
          <h2>⚙ Settings</h2>
          <button className="settings__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="settings__body">
          {/* Live view first — it's the reason most people open this screen. */}
          <section className="settings__section">
            <h3>Live camera view</h3>
            <CameraPreview webcam={draft.webcam} cal={draft.calibration.board} onCalChange={setCal} />
          </section>

          <section className="settings__section">
            <h3>Camera</h3>
            <CameraSection webcam={draft.webcam} cameras={cameras} onChange={setWebcam} />
          </section>

          <section className="settings__section">
            <h3>Orientation</h3>
            <div className="settings__row">
              <span className="field__label">Rotation</span>
              <span className="btnrow">
                {ROTATIONS.map((r) => (
                  <button
                    key={r}
                    className={draft.webcam.rotation === r ? "active" : ""}
                    onClick={() => setWebcam({ rotation: r })}
                  >
                    {r}°
                  </button>
                ))}
              </span>
              <button className={draft.webcam.flipH ? "active" : ""} onClick={() => setWebcam({ flipH: !draft.webcam.flipH })}>
                Flip H
              </button>
              <button className={draft.webcam.flipV ? "active" : ""} onClick={() => setWebcam({ flipV: !draft.webcam.flipV })}>
                Flip V
              </button>
            </div>
            <p className="settings__note">
              Portrait (90°/270°) captures your whole stance and feet.
              {orientationIgnored && " ⚠ Orientation is ignored with the 'copy' encoder — switch to x264 in Advanced."}
            </p>
          </section>

          <section className="settings__section">
            <h3>Autodarts board</h3>
            <div className="settings__grid">
              <label className="field">
                <span className="field__label">Host</span>
                <span className="field__input">
                  <input value={draft.board.host} onChange={(e) => setBoard({ host: e.target.value })} />
                </span>
              </label>
              <NumberField label="Port" value={draft.board.port} min={1} onChange={(port) => setBoard({ port })} />
              <NumberField
                label="Poll interval"
                value={draft.board.pollIntervalMs}
                min={20}
                suffix="ms"
                onChange={(pollIntervalMs) => setBoard({ pollIntervalMs })}
              />
            </div>
            <div className="settings__row">
              <button onClick={runTest} disabled={testing}>
                {testing ? "Testing…" : "Test connection"}
              </button>
              {test && (
                <span className={`test ${test.ok ? "ok" : "bad"}`}>
                  {test.ok ? `✓ reachable — ${test.status}` : `✗ ${test.error ?? "unreachable"}`}
                </span>
              )}
            </div>
          </section>

          <section className="settings__section">
            <h3>Timing</h3>
            <div className="settings__grid">
              <NumberField
                label="Inactivity timeout"
                value={draft.visit.inactivityTimeoutMs}
                min={0}
                suffix="ms"
                onChange={(v) => setVisit({ inactivityTimeoutMs: v })}
              />
              <NumberField
                label="Third-dart grace"
                value={draft.visit.thirdDartGraceMs}
                min={0}
                suffix="ms"
                onChange={(v) => setVisit({ thirdDartGraceMs: v })}
              />
              <NumberField
                label="Collect timeout"
                value={draft.visit.collectTimeoutMs}
                min={0}
                suffix="ms"
                onChange={(v) => setVisit({ collectTimeoutMs: v })}
              />
              <NumberField
                label="Pre-roll"
                value={draft.recorder.preRollMs}
                min={0}
                suffix="ms"
                onChange={(v) => setRecorder({ preRollMs: v })}
              />
              <NumberField
                label="Post-roll"
                value={draft.recorder.postRollMs}
                min={0}
                suffix="ms"
                onChange={(v) => setRecorder({ postRollMs: v })}
              />
            </div>
          </section>

          <section className="settings__section">
            <button className="settings__toggle" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "▾" : "▸"} Retention & advanced
            </button>
            {advanced && (
              <div className="settings__grid">
                <NumberField
                  label="Clips kept"
                  value={draft.retainCount}
                  min={1}
                  onChange={(retainCount) => setDraft({ ...draft, retainCount })}
                />
                <NumberField
                  label="Ring buffer"
                  value={draft.recorder.ringSeconds}
                  min={5}
                  suffix="s"
                  onChange={(v) => setRecorder({ ringSeconds: v })}
                />
                <NumberField
                  label="Segment length"
                  value={draft.recorder.segmentSeconds}
                  min={1}
                  suffix="s"
                  onChange={(v) => setRecorder({ segmentSeconds: v })}
                />
                <label className="field">
                  <span className="field__label">Encoder</span>
                  <select
                    value={draft.webcam.encoder}
                    onChange={(e) => setWebcam({ encoder: e.target.value as Config["webcam"]["encoder"] })}
                  >
                    {(["x264", "copy", "vaapi"] as const).map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Segment dir</span>
                  <span className="field__input">
                    <input value={draft.recorder.segmentDir} onChange={(e) => setRecorder({ segmentDir: e.target.value })} />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Clip dir</span>
                  <span className="field__input">
                    <input value={draft.recorder.clipDir} onChange={(e) => setRecorder({ clipDir: e.target.value })} />
                  </span>
                </label>
              </div>
            )}
          </section>

          <section className="settings__section">
            <h3>Sharing</h3>
            <p className="settings__note">
              Defaults for the Share dialog (📤 on a clip). Overlays are burned into a re-encoded
              MP4 for posting to e.g. /r/darts.
            </p>
            <div className="settings__row">
              <span className="field__label">Burn by default</span>
              {(
                [
                  ["burnBoard", "Board"],
                  ["burnGuides", "Guides"],
                  ["burnDarts", "Darts"],
                  ["burnCaption", "Caption"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={draft.sharing[k] ? "active" : ""}
                  onClick={() => setSharing({ [k]: !draft.sharing[k] })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="settings__grid">
              <label className="field">
                <span className="field__label">Default host</span>
                <select
                  value={draft.sharing.defaultHost}
                  onChange={(e) => setSharing({ defaultHost: e.target.value as Config["sharing"]["defaultHost"] })}
                >
                  <option value="none">None — download only</option>
                  <option value="catbox">catbox.moe (no account)</option>
                  <option value="streamable">Streamable (account)</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Streamable email</span>
                <span className="field__input">
                  <input
                    value={draft.sharing.streamable.email}
                    onChange={(e) => setStreamable({ email: e.target.value })}
                    placeholder="for Streamable uploads"
                  />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Streamable password</span>
                <span className="field__input">
                  <input
                    type="password"
                    value={draft.sharing.streamable.password}
                    onChange={(e) => setStreamable({ password: e.target.value })}
                    placeholder="leave blank to keep current"
                  />
                </span>
              </label>
            </div>
            <p className="settings__note">catbox.moe needs no account. Streamable embeds inline on Reddit but needs your login.</p>
          </section>

          <section className="settings__section settings__health">
            <h3>Status</h3>
            {health ? (
              <ul>
                <li>Board: {health.board}</li>
                <li>
                  Recording:{" "}
                  {health.previewing
                    ? "paused (live view open)"
                    : health.ringHealthy
                      ? "healthy"
                      : "not producing segments"}
                </li>
                <li>Ring buffer: {(health.ringBytes / 1e6).toFixed(1)} MB</li>
              </ul>
            ) : (
              <p>—</p>
            )}
          </section>
        </div>

        <footer className="settings__foot">
          {error && <span className="settings__err">{error}</span>}
          <button onClick={reset} disabled={!dirty || saving}>
            Revert
          </button>
          <button className="primary" onClick={onSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
