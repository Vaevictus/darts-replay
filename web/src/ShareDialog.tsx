import { useEffect, useState } from "react";
import type { Visit, OverlayConfig, ShareOptions, ShareHost, ShareResult } from "@shared/types.js";
import { getConfig, shareClips } from "./api.js";

const BURN_TOGGLES: [keyof ShareOptions, string][] = [
  ["burnBoard", "Board overlay"],
  ["burnGuides", "Guide wires"],
  ["burnDarts", "Dart markers"],
  ["burnCaption", "Caption"],
];

/**
 * Export the selected clips with overlays burned in, optionally stitching and
 * uploading. Toggles seed from the saved Sharing defaults; all work is server-side.
 */
export function ShareDialog({
  visits,
  guides,
  onClose,
}: {
  visits: Visit[];
  guides: OverlayConfig;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<ShareOptions>({
    burnBoard: true,
    burnGuides: true,
    burnDarts: false,
    burnCaption: true,
    host: "none",
    multi: "separate",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed toggles + host from the saved Sharing defaults.
  useEffect(() => {
    getConfig()
      .then((c) =>
        setOpts((o) => ({
          ...o,
          burnBoard: c.sharing.burnBoard,
          burnGuides: c.sharing.burnGuides,
          burnDarts: c.sharing.burnDarts,
          burnCaption: c.sharing.burnCaption,
          host: c.sharing.defaultHost,
        })),
      )
      .catch(() => {});
  }, []);

  const set = (patch: Partial<ShareOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const onExport = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await shareClips(visits.map((v) => v.id), guides, opts));
    } catch (e) {
      setError(e instanceof Error ? e.message : "share failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Share clips">
      <div className="settings__panel">
        <header className="settings__head">
          <h2>Share {visits.length} clip{visits.length > 1 ? "s" : ""}</h2>
          <button className="settings__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="settings__body">
          <section className="settings__section">
            <h3>Burn in</h3>
            <div className="settings__row">
              {BURN_TOGGLES.map(([k, label]) => (
                <button
                  key={k}
                  className={opts[k] ? "active" : ""}
                  onClick={() => set({ [k]: !opts[k] } as Partial<ShareOptions>)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {visits.length > 1 && (
            <section className="settings__section">
              <h3>Output</h3>
              <div className="settings__row">
                <button className={opts.multi === "stitch" ? "active" : ""} onClick={() => set({ multi: "stitch" })}>
                  Stitch into one
                </button>
                <button className={opts.multi === "separate" ? "active" : ""} onClick={() => set({ multi: "separate" })}>
                  Separate files
                </button>
              </div>
            </section>
          )}

          <section className="settings__section">
            <h3>Upload</h3>
            <label className="field">
              <span className="field__label">Host</span>
              <select value={opts.host} onChange={(e) => set({ host: e.target.value as ShareHost })}>
                <option value="none">None — download only</option>
                <option value="catbox">catbox.moe (no account)</option>
                <option value="streamable">Streamable (account)</option>
              </select>
            </label>
            {opts.host === "streamable" && (
              <p className="settings__note">Set your Streamable email/password in ⚙ Settings → Sharing.</p>
            )}
          </section>

          {result && (
            <section className="settings__section">
              <h3>Result</h3>
              {result.files.map((f) => (
                <div key={f} className="share__result">
                  <a href={f} download>
                    ⬇ {f.split("/").pop()}
                  </a>
                  <button onClick={() => navigator.clipboard?.writeText(location.origin + f)}>Copy link</button>
                </div>
              ))}
              {result.links.map((l, i) => (
                <div key={i} className="share__result">
                  {l.error ? (
                    <span className="test bad">
                      {l.host}: {l.error}
                    </span>
                  ) : (
                    <>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.url}
                      </a>
                      <button onClick={() => navigator.clipboard?.writeText(l.url)}>Copy</button>
                    </>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <footer className="settings__foot">
          {error && <span className="settings__err">{error}</span>}
          <button className="primary" onClick={() => void onExport()} disabled={busy}>
            {busy ? "Encoding…" : "Export & share"}
          </button>
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
