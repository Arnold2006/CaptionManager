import React from 'react';
import ThumbnailGrid from './ThumbnailGrid.jsx';
import Workspace from './Workspace.jsx';

export const ASPECTS = ['free', '1:1', '4:5', '5:4', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];

// Presentational crop workspace: thumbnail grid + toolbar + workspace + GO bar.
// All state and batch logic live in App; this component only renders.
export default function CropTab({
  images, selected, folder, settings, currentSetting, imageData,
  globalFormat, globalUpscale, zoom, batch, dragOver, counts,
  onSelect, onDelete, onRefreshList,
  onToggleCrop, onClearCrop, onAspect, onRotate, onResetRotation,
  onToggleUpscale, onZoomDelta, onZoomSet, onZoomFit, onCropChange,
  onGlobalFormat, onGlobalUpscale, onGo,
}) {
  return (
    <>
      <div className="main">
        <div className="left">
          <div className="left-header">
            <span>THUMBNAILS — click to focus · hover × to recycle</span>
            {folder && <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => onRefreshList(folder)}>↻ Refresh</button>}
          </div>
          <ThumbnailGrid images={images} selected={selected} onSelect={onSelect} onDelete={onDelete} settings={settings} />
        </div>

        <div className="right">
          <div className="toolbar">
            <div className="toolbar-group">
              <span className="toolbar-label">Crop</span>
              <button className={`btn ${currentSetting.crop ? 'btn-primary' : ''}`} onClick={onToggleCrop} disabled={!selected}>{currentSetting.crop ? '✓ Crop ON' : 'Enable Crop'}</button>
              {currentSetting.crop && <button className="btn btn-ghost" onClick={onClearCrop}>Clear</button>}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Aspect</span>
              {ASPECTS.map((a) => (
                <button key={a} className={`aspect-btn ${currentSetting.aspect === a ? 'active' : ''}`} onClick={() => onAspect(a)} disabled={!selected || !currentSetting.crop}>{a}</button>
              ))}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Rotate</span>
              <button className="btn" onClick={() => onRotate(-90)} disabled={!selected} title="Rotate 90° counter-clockwise">⟲</button>
              <button className="btn" onClick={() => onRotate(90)} disabled={!selected} title="Rotate 90° clockwise">⟳</button>
              {(currentSetting.rotation || 0) !== 0 && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--accent2)', fontWeight: 700 }}>{currentSetting.rotation}°</span>
                  <button className="btn btn-ghost" onClick={onResetRotation}>Reset</button>
                </>
              )}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Per-image upscale</span>
              <label className="checkbox"><input type="checkbox" disabled={!selected || globalUpscale} checked={globalUpscale ? true : !!currentSetting.upscaleEnabled} onChange={(e) => onToggleUpscale(e.target.checked)} /> 2× this image</label>
              {globalUpscale && <span style={{ fontSize: 11, color: 'var(--muted)' }}>global ON</span>}
            </div>
            <div className="toolbar-group zoom-controls">
              <span className="toolbar-label">Zoom</span>
              <button className="btn" onClick={() => onZoomDelta(-0.1)}>−</button>
              <input className="slider" type="range" min="0.25" max="3" step="0.05" value={zoom} onChange={(e) => onZoomSet(parseFloat(e.target.value))} />
              <button className="btn" onClick={() => onZoomDelta(0.1)}>+</button>
              <button className="btn btn-ghost" onClick={onZoomFit}>Fit</button>
            </div>
          </div>

          <Workspace selected={selected} imageData={imageData} settings={currentSetting} onCropChange={onCropChange} aspect={currentSetting.aspect} zoom={zoom} setZoom={onZoomSet} />

          {dragOver && <div style={{ position: 'absolute', inset: 0, background: 'rgba(79,140,255,0.12)', border: '2px dashed var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, pointerEvents: 'none' }}>Drop folder to load</div>}
        </div>
      </div>

      <div className="goBar" style={{ height: 86, background: 'var(--panel)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 14 }}>
        <button className="go-btn" onClick={onGo} disabled={batch.running || images.length === 0}>
          {batch.running ? `PROCESSING ${batch.progress?.current || 0}/${batch.progress?.total || images.length}…` : '▶  GO  —  PROCESS ALL'}
        </button>
        <div className="progress" style={{ minWidth: 280 }}>
          {batch.running && batch.progress && (
            <>
              <div>{batch.progress.current} / {batch.progress.total} — {batch.progress.processed} ok {batch.progress.errors ? `· ${batch.progress.errors} err` : ''}</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${(batch.progress.current / batch.progress.total) * 100}%` }} /></div>
            </>
          )}
          {!batch.running && batch.result && (
            <>
              <div style={{ color: 'var(--accent2)', fontWeight: 700 }}>Done — {batch.result.processed}/{batch.result.total} → {batch.result.outDir}</div>
              <button className="btn" style={{ marginTop: 6 }} onClick={() => window.api.openPath(batch.result.outDir)}>Open output folder</button>
              {batch.result.errors.length > 0 && <div style={{ color: 'var(--danger)', fontSize: 11 }}>{batch.result.errors.length} errors (see console)</div>}
            </>
          )}
          {!batch.running && !batch.result && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Settings are remembered per image until GO. Output → <code>&lt;source&gt;/CaptionManager_output_&lt;timestamp&gt;/</code></span>}
        </div>
      </div>
    </>
  );
}
