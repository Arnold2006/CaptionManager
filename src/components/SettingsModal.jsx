import React, { useEffect, useState } from 'react';

// Settings modal: AI models folder picker + first-launch downloader.
// The ~6GB GGUFs are NOT bundled with the portable exe; they live in the
// chosen folder (or the app-data folder by default) and are fetched here.
const gb = (n) => ((n || 0) / 1024 ** 3).toFixed(2) + ' GB';

export default function SettingsModal({ open, onClose }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({}); // file -> {received,total,done,skipped}
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async () => {
    if (!window.api?.modelsStatus) return;
    try { setStatus(await window.api.modelsStatus()); } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!open) return;
    setFinished(false);
    setError(null);
    setProgress({});
    refresh();
  }, [open ]);

  useEffect(() => {
    if (!window.api?.onModelsProgress) return;
    const off = window.api.onModelsProgress((p) => {
      if (p.finished) {
        setBusy(false);
        setFinished(true);
        refresh();
        return;
      }
      setProgress((prev) => ({ ...prev, [p.file]: p }));
    });
    return off;
  }, []);

  if (!open) return null;

  const browse = async () => {
    try {
      const r = await window.api.modelsBrowse();
      if (r.path) {
        await window.api.settingsSet({ modelsDir: r.path });
        refresh();
      }
    } catch (e) { alert('Could not set folder: ' + e.message); }
  };

  const useDefault = async () => {
    try {
      await window.api.settingsSet({ modelsDir: '' });
      refresh();
    } catch (e) { alert('Could not reset folder: ' + e.message); }
  };

  const download = async () => {
    setBusy(true);
    setFinished(false);
    setError(null);
    setProgress({});
    try {
      const r = await window.api.modelsDownload();
      if (!r.ok) {
        setError(r.error || 'Download failed');
        setBusy(false);
      }
      // Success path resolves via the finished progress event.
      refresh();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const sourceLabel = status ? (status.source === 'custom' ? 'your chosen folder' : status.source === 'bundled' ? 'bundled with app (dev)' : 'app data folder (default)') : '';

  return (
    <div className="cap-steer-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) onClose(); }}>
      <div className="cap-steer-modal" style={{ width: 600 }}>
        <div className="cap-steer-hdr">
          <span>⚙ Settings — AI models</span>
          <button className="btn btn-ghost" style={{ padding: '3px 8px' }} onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="cap-steer-body">
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>Models folder <span style={{ fontWeight: 400, textTransform: 'none' }}>({sourceLabel})</span></label>
            <div className="folder-path" style={{ marginBottom: 8 }} title={status?.dir}>{status?.dir || '…'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={browse} disabled={busy}>📁 Point to a folder with the models…</button>
              <button className="btn btn-ghost" onClick={useDefault} disabled={busy}>Use default</button>
            </div>
            <div className="cap-hint">The folder must contain the Qwen3-VL GGUF and its matching mmproj. Changing the folder stops the model server; it restarts on the next caption.</div>
          </div>

          <div>
            {(status?.files || []).map((f) => {
              const ok = f.present && f.size === f.expected;
              const p = progress[f.name];
              const pct = p && p.total > 0 ? Math.min(100, (p.received / p.total) * 100) : 0;
              return (
                <div key={f.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
                    <span style={{ color: ok ? 'var(--accent2)' : 'var(--danger)', fontWeight: 700 }}>{ok ? '✓' : '✕'}</span>
                    <span style={{ flex: 1, wordBreak: 'break-all', color: 'var(--text)' }}>{f.name}</span>
                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {p && !p.done ? `${gb(p.received)} / ${gb(p.total)}` : `${gb(f.size)} / ${gb(f.expected)}`}
                    </span>
                  </div>
                  {p && !p.done && (
                    <div className="progress-bar" style={{ marginTop: 4 }}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  )}
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              llama.cpp server: {status?.binPresent ? <b style={{ color: 'var(--accent2)' }}>bundled ✓</b> : <b style={{ color: 'var(--danger)' }}>missing</b>}
            </div>
          </div>

          {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
          {finished && <div style={{ color: 'var(--accent2)', fontSize: 12 }}>✓ Models ready — you can close this and start captioning.</div>}
        </div>
        <div className="cap-steer-ftr">
          <span className="cap-steer-status">{busy ? 'Downloading… (~6 GB, keep the app open)' : status?.complete ? 'Models ready' : 'Models missing'}</span>
          <button className="btn btn-primary" onClick={download} disabled={busy || !status}>
            {busy ? 'Downloading…' : status?.complete ? '↻ Re-download' : '⬇ Download models (~6 GB)'}
          </button>
        </div>
      </div>
    </div>
  );
}
