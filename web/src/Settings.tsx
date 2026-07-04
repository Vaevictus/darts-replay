import { useEffect, useState, type ReactNode } from "react";
import type { Config } from "@shared/types.js";
import { useConfigEditor, HEAT_KERNEL_DEFAULT, HEAT_KERNEL_MIN, HEAT_KERNEL_MAX } from "./useConfig.js";
import { getCameras, testBoard, type Camera, type BoardTestResult } from "./api.js";
import { CameraPreview } from "./CameraPreview.js";
import { Heatmap, type HeatmapMode, type HeatmapScale } from "./Heatmap.js";

const ROTATIONS: Config["webcam"]["rotation"][] = [0, 90, 180, 270];

/** The heatmap prefs live in App (localStorage hooks are per-instance, so the
 * state is lifted there and passed in) — edits here apply to the real heatmap
 * instantly, without Save. */
export interface HeatmapPrefs {
  mode: HeatmapMode;
  setMode: (m: HeatmapMode) => void;
  scale: HeatmapScale;
  setScale: (s: HeatmapScale) => void;
  kernel: number;
  setKernel: (k: number) => void;
  /** Real accumulated dart positions, for the live preview. */
  coords: { x: number; y: number }[];
}

interface Health {
  board: string;
  ringHealthy: boolean;
  ringBytes: number;
  previewing: boolean;
}

type SectionId = "camera" | "board" | "replays" | "heatmap" | "sharing" | "advanced" | "status";

const SECTIONS: { id: SectionId; icon: string; label: string; blurb: string }[] = [
  { id: "camera", icon: "🎥", label: "Camera", blurb: "Set up the camera that films you." },
  { id: "board", icon: "🎯", label: "Board", blurb: "Connect to your Autodarts board." },
  { id: "replays", icon: "🎬", label: "Replays", blurb: "How your throws are recorded and saved." },
  { id: "heatmap", icon: "🔥", label: "Heatmap", blurb: "How your dart-landing map is drawn." },
  { id: "sharing", icon: "📤", label: "Sharing", blurb: "Defaults for posting replays online." },
  { id: "advanced", icon: "🔧", label: "Advanced", blurb: "Technical plumbing — most people never touch these." },
  { id: "status", icon: "🩺", label: "Status", blurb: "A quick health check. Nothing to change here." },
];

// Grouping presets for the heatmap kernel. "Standard" is the app default (≈ one
// dart's width on a real board — see Heatmap.tsx).
const KERNEL_PRESETS: { label: string; value: number }[] = [
  { label: "Tight", value: 0.02 },
  { label: "Standard", value: HEAT_KERNEL_DEFAULT },
  { label: "Loose", value: 0.045 },
];

// Synthetic darts for the grouping preview when the player has no real data yet:
// a tight cluster on 20, a looser spread near 19, and one stray.
const SAMPLE_COORDS = [
  { x: 0.005, y: 0.585 },
  { x: -0.012, y: 0.602 },
  { x: 0.02, y: 0.575 },
  { x: -0.03, y: 0.56 },
  { x: 0.04, y: 0.61 },
  { x: -0.17, y: -0.52 },
  { x: -0.23, y: -0.45 },
  { x: -0.12, y: -0.58 },
  { x: 0.42, y: 0.18 },
];

/** Kernel (canvas fraction) → approximate radius in mm on a real board. The
 * heat radius in board units is kernel*2.3 (see Heatmap.tsx) and the board
 * radius to the double-ring outer edge is 170 mm. */
const kernelToMm = (k: number) => Math.round(k * 2.3 * 170);

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__input">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => {
            // Ignore transient empty/invalid input (Number("") === 0) so clearing
            // the field to retype doesn't snap the value to 0 (and 400 on save).
            const n = e.target.valueAsNumber;
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
        {suffix && <span className="field__suffix">{suffix}</span>}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/** A duration stored in ms but shown to the player in seconds. */
function SecondsField({
  label,
  ms,
  onChange,
  hint,
}: {
  label: string;
  ms: number;
  onChange: (ms: number) => void;
  hint?: string;
}) {
  return (
    <NumberField
      label={label}
      value={ms / 1000}
      min={0}
      step={0.1}
      suffix="seconds"
      hint={hint}
      onChange={(n) => onChange(Math.round(n * 1000))}
    />
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__input">
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function CameraFields({
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
        <span className="field__hint">Which camera films your throws.</span>
      </label>

      <label className="field">
        <span className="field__label">Picture format</span>
        <select value={webcam.format} onChange={(e) => onChange({ format: e.target.value as Config["webcam"]["format"] })}>
          {formatOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className="field__hint">How the camera sends its picture. If the feed looks wrong, try another.</span>
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
            <span className="field__hint">Picture sharpness. Higher looks better but works the computer harder.</span>
          </label>
          <label className="field">
            <span className="field__label">Frames per second</span>
            <select value={webcam.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
              {(size?.fps ?? [webcam.fps]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="field__hint">How smooth the video is. 30 is plenty for reviewing your throw.</span>
          </label>
        </>
      ) : (
        <>
          <NumberField label="Width" value={webcam.width} min={16} onChange={(width) => onChange({ width })} />
          <NumberField label="Height" value={webcam.height} min={16} onChange={(height) => onChange({ height })} />
          <NumberField label="Frames per second" value={webcam.fps} min={1} onChange={(fps) => onChange({ fps })} />
        </>
      )}
    </div>
  );
}

export function Settings({ onClose, heat }: { onClose: () => void; heat: HeatmapPrefs }) {
  const { draft, setDraft, dirty, saving, error, save, reset } = useConfigEditor();
  const [section, setSection] = useState<SectionId>("camera");
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [test, setTest] = useState<BoardTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const setSectionCfg = <K extends keyof Config>(key: K, patch: Partial<Config[K]>) =>
    setDraft({ ...draft, [key]: { ...(draft[key] as object), ...patch } });
  const setBoard = (patch: Partial<Config["board"]>) => setSectionCfg("board", patch);
  const setWebcam = (patch: Partial<Config["webcam"]>) => setSectionCfg("webcam", patch);
  const setRecorder = (patch: Partial<Config["recorder"]>) => setSectionCfg("recorder", patch);
  const setVisit = (patch: Partial<Config["visit"]>) => setSectionCfg("visit", patch);
  const setCal = (board: Config["calibration"]["board"]) => setDraft({ ...draft, calibration: { board } });
  const setSharing = (patch: Partial<Config["sharing"]>) => setSectionCfg("sharing", patch);
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

  const renderCamera = () => (
    <>
      <section className="settings__section">
        <h3>Live camera view</h3>
        <p className="settings__note">
          Recording pauses while you're on this page and resumes when you leave. Turn on the board
          overlay and drag the outline over your real board — replays use it to show where each
          dart landed.
        </p>
        <CameraPreview webcam={draft.webcam} cal={draft.calibration.board} onCalChange={setCal} />
      </section>

      <section className="settings__section">
        <h3>Camera & picture</h3>
        <CameraFields webcam={draft.webcam} cameras={cameras} onChange={setWebcam} />
      </section>

      <section className="settings__section">
        <h3>Which way up</h3>
        <div className="settings__row">
          <span className="field__label">Rotate</span>
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
            Mirror ↔
          </button>
          <button className={draft.webcam.flipV ? "active" : ""} onClick={() => setWebcam({ flipV: !draft.webcam.flipV })}>
            Mirror ↕
          </button>
        </div>
        <p className="settings__note">
          Turn the picture until it matches how the camera is mounted. Portrait (90°/270°) captures
          your whole stance and feet.
          {orientationIgnored &&
            " ⚠ These are ignored with the 'copy' encoder — switch to x264 under Advanced."}
        </p>
      </section>
    </>
  );

  const renderBoard = () => (
    <>
      <section className="settings__section">
        <h3>Autodarts connection</h3>
        <div className="settings__grid">
          <TextField
            label="Board address"
            value={draft.board.host}
            onChange={(host) => setBoard({ host })}
            hint="The computer running Autodarts — usually this one (127.0.0.1)."
          />
          <NumberField
            label="Port"
            value={draft.board.port}
            min={1}
            onChange={(port) => setBoard({ port })}
            hint="Autodarts' data port — 3180 unless you changed it there."
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
        <h3>Checking for darts</h3>
        <div className="settings__grid">
          <NumberField
            label="Check for new darts every"
            value={draft.board.pollIntervalMs}
            min={20}
            suffix="ms"
            onChange={(pollIntervalMs) => setBoard({ pollIntervalMs })}
            hint="How often to ask the board what was thrown. 150 ms (about 7× a second) feels instant — only raise it if the board computer is struggling."
          />
        </div>
      </section>
    </>
  );

  const renderReplays = () => (
    <>
      <section className="settings__section">
        <h3>When a turn ends</h3>
        <p className="settings__note">A turn is up to three darts. These decide when the replay is cut and saved.</p>
        <div className="settings__grid">
          <SecondsField
            label="End the turn after"
            ms={draft.visit.inactivityTimeoutMs}
            onChange={(v) => setVisit({ inactivityTimeoutMs: v })}
            hint="If no new dart lands for this long, the turn is over and the replay is saved."
          />
          <SecondsField
            label="After the 3rd dart"
            ms={draft.visit.thirdDartGraceMs}
            onChange={(v) => setVisit({ thirdDartGraceMs: v })}
            hint="A short wait after your third dart before saving, so the score can settle."
          />
          <SecondsField
            label="After collecting your darts"
            ms={draft.visit.collectTimeoutMs}
            onChange={(v) => setVisit({ collectTimeoutMs: v })}
            hint="Once you pull your darts out, wait this long before watching for the next turn."
          />
        </div>
      </section>

      <section className="settings__section">
        <h3>How much video to keep</h3>
        <div className="settings__grid">
          <SecondsField
            label="Before your first dart"
            ms={draft.recorder.preRollMs}
            onChange={(v) => setRecorder({ preRollMs: v })}
            hint="Run-up footage kept before the turn — enough to see your stance and throw."
          />
          <SecondsField
            label="After your last dart"
            ms={draft.recorder.postRollMs}
            onChange={(v) => setRecorder({ postRollMs: v })}
            hint="Footage kept after the final dart lands."
          />
          <NumberField
            label="Replays to keep"
            value={draft.retainCount}
            min={1}
            onChange={(retainCount) => setDraft({ ...draft, retainCount })}
            hint="How many recent replays stay in the list. Older ones are deleted automatically to save space."
          />
        </div>
      </section>
    </>
  );

  const renderHeatmap = () => {
    const usingSample = heat.coords.length < 5;
    const previewCoords = usingSample ? SAMPLE_COORDS : heat.coords;
    return (
      <>
        <p className="settings__live">✓ Changes here take effect straight away — no need to press Save.</p>

        <section className="settings__section">
          <h3>Colours</h3>
          <div className="settings__row">
            <span className="field__label">Style</span>
            <button className={heat.mode === "ramp" ? "active" : ""} onClick={() => heat.setMode("ramp")}>
              🔵→🔴 Heat colours
            </button>
            <button className={heat.mode === "glow" ? "active" : ""} onClick={() => heat.setMode("glow")}>
              🟠 Orange glow
            </button>
          </div>
          <p className="settings__note">
            Heat colours shade quiet areas blue and busy areas red. Orange glow simply brightens
            wherever darts stack up.
          </p>
          {heat.mode === "ramp" && (
            <>
              <div className="settings__row">
                <span className="field__label">When does it turn red?</span>
                <button className={heat.scale === "relative" ? "active" : ""} onClick={() => heat.setScale("relative")}>
                  My tightest group
                </button>
                <button className={heat.scale === "absolute" ? "active" : ""} onClick={() => heat.setScale("absolute")}>
                  Only real pile-ups
                </button>
              </div>
              <p className="settings__note">
                "My tightest group" always paints your densest spot red — handy when you've only
                thrown a few darts. "Only real pile-ups" stays cool until darts genuinely land on
                top of each other.
              </p>
            </>
          )}
        </section>

        <section className="settings__section">
          <h3>Grouping</h3>
          <p className="settings__note">How close together must darts land to count as a group?</p>
          <div className="kernel">
            <div className="kernel__controls">
              <span className="btnrow">
                {KERNEL_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={Math.abs(heat.kernel - p.value) < 0.001 ? "active" : ""}
                    onClick={() => heat.setKernel(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </span>
              <label className="kernel__slider">
                <input
                  type="range"
                  min={HEAT_KERNEL_MIN}
                  max={HEAT_KERNEL_MAX}
                  step={0.001}
                  value={heat.kernel}
                  onChange={(e) => heat.setKernel(Number(e.target.value))}
                  aria-label="Grouping tightness"
                />
                <span className="kernel__ends">
                  <span>Tighter</span>
                  <span>Looser</span>
                </span>
              </label>
              <p className="settings__note">
                Darts within about {kernelToMm(heat.kernel)} mm of each other build a hot spot.
                Tighter = only near-identical hits light up. Looser = darts anywhere in the same
                area count as a group.
              </p>
            </div>
            <figure className="kernel__preview">
              <Heatmap coords={previewCoords} mode={heat.mode} scale={heat.scale} kernel={heat.kernel} size={170} />
              <figcaption>{usingSample ? "Preview (sample darts)" : "Preview (your darts)"}</figcaption>
            </figure>
          </div>
        </section>
      </>
    );
  };

  const renderSharing = () => (
    <>
      <section className="settings__section">
        <h3>What gets drawn on shared videos</h3>
        <p className="settings__note">
          Defaults for the 📤 Share button on a replay. The shared copy is re-made with these
          extras drawn in — your original replay is never changed.
        </p>
        <div className="settings__row">
          {(
            [
              ["burnBoard", "Board outline"],
              ["burnGuides", "Guide lines"],
              ["burnDarts", "Dart markers"],
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
      </section>

      <section className="settings__section">
        <h3>Where videos are uploaded</h3>
        <div className="settings__grid">
          <label className="field">
            <span className="field__label">Upload to</span>
            <select
              value={draft.sharing.defaultHost}
              onChange={(e) => setSharing({ defaultHost: e.target.value as Config["sharing"]["defaultHost"] })}
            >
              <option value="none">Nowhere — just download the file</option>
              <option value="catbox">catbox.moe (no account needed)</option>
              <option value="streamable">Streamable (needs an account)</option>
            </select>
            <span className="field__hint">Pre-selected in the Share dialog — you can still change it each time.</span>
          </label>
          <TextField
            label="Streamable email"
            value={draft.sharing.streamable.email}
            onChange={(email) => setStreamable({ email })}
            placeholder="for Streamable uploads"
            hint="Only needed if you upload to Streamable."
          />
          <TextField
            label="Streamable password"
            type="password"
            value={draft.sharing.streamable.password}
            onChange={(password) => setStreamable({ password })}
            placeholder="leave blank to keep current"
          />
        </div>
        <p className="settings__note">catbox.moe needs no account. Streamable embeds inline on Reddit but needs your login.</p>
      </section>
    </>
  );

  const renderAdvanced = () => (
    <section className="settings__section">
      <p className="settings__warn">
        ⚠ Most people never need these. A wrong value here can stop recording — if in doubt, leave
        them as they are.
      </p>
      {!showAdvanced ? (
        <button onClick={() => setShowAdvanced(true)}>Show advanced settings</button>
      ) : (
        <div className="settings__grid">
          <label className="field">
            <span className="field__label">Video encoder</span>
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
            <span className="field__hint">
              How video is compressed. x264 is the safe default. 'copy' uses less power but can't
              rotate or flip the picture. 'vaapi' needs working GPU encoding.
            </span>
          </label>
          <NumberField
            label="Rolling video memory"
            value={draft.recorder.ringSeconds}
            min={5}
            suffix="seconds"
            onChange={(v) => setRecorder({ ringSeconds: v })}
            hint="How much recent video is held in memory waiting to become replays. Must comfortably cover a whole turn plus the before/after padding."
          />
          <NumberField
            label="Video chunk length"
            value={draft.recorder.segmentSeconds}
            min={1}
            suffix="seconds"
            onChange={(v) => setRecorder({ segmentSeconds: v })}
            hint="That memory is stored as small chunks of this length. 1 second is right for almost everyone."
          />
          <TextField
            label="Chunk folder"
            value={draft.recorder.segmentDir}
            onChange={(segmentDir) => setRecorder({ segmentDir })}
            hint="Where the temporary video chunks are written (a fast in-memory folder)."
          />
          <TextField
            label="Replay folder"
            value={draft.recorder.clipDir}
            onChange={(clipDir) => setRecorder({ clipDir })}
            hint="Where finished replay videos are saved."
          />
        </div>
      )}
    </section>
  );

  const renderStatus = () => (
    <section className="settings__section settings__health">
      <h3>System health</h3>
      {health ? (
        <ul>
          <li>Board connection: {health.board}</li>
          <li>
            Recording:{" "}
            {health.previewing
              ? "paused (camera view open)"
              : health.ringHealthy
                ? "recording normally"
                : "⚠ not producing video — check the Camera settings"}
          </li>
          <li>Video memory in use: {(health.ringBytes / 1e6).toFixed(1)} MB</li>
        </ul>
      ) : (
        <p>—</p>
      )}
    </section>
  );

  const panels: Record<SectionId, () => ReactNode> = {
    camera: renderCamera,
    board: renderBoard,
    replays: renderReplays,
    heatmap: renderHeatmap,
    sharing: renderSharing,
    advanced: renderAdvanced,
    status: renderStatus,
  };
  const meta = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings__panel">
        <header className="settings__head">
          <h2>⚙ Settings</h2>
          <button className="settings__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="settings__main">
          <nav className="settings__nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings__navbtn ${section === s.id ? "settings__navbtn--active" : ""}`}
                aria-current={section === s.id ? "true" : undefined}
                onClick={() => setSection(s.id)}
              >
                <span className="settings__navicon" aria-hidden="true">
                  {s.icon}
                </span>
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings__body">
            <p className="settings__blurb">{meta.blurb}</p>
            {panels[section]()}
          </div>
        </div>

        <footer className="settings__foot">
          <span className="settings__footmsg">
            {error ? <span className="settings__err">{error}</span> : dirty ? "You have unsaved changes" : ""}
          </span>
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
