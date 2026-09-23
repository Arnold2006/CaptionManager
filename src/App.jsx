import React, { useState, useEffect, useCallback, useRef } from 'react';
import ThumbnailGrid from './components/ThumbnailGrid.jsx';
import Workspace from './components/Workspace.jsx';
import CaptionTab from './components/CaptionTab.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { useDialog } from './components/dialog.jsx';

const ASPECTS = ['free','1:1','4:5','5:4','4:3','3:4','16:9','9:16','3:2','2:3'];

export default function App() {
  const [folder, setFolder] = useState(null);
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [imageData, setImageData] = useState(null);
  const [settings, setSettings] = useState({}); // path -> {crop, aspect, upscaleEnabled}
  const [globalFormat, setGlobalFormat] = useState('jpg');
  const [globalUpscale, setGlobalUpscale] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [batch, setBatch] = useState({ running:false, progress:null, result:null });
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState('crop'); // 'crop' | 'caption'
  const [captionImages, setCaptionImages] = useState([]);
  const [captionNotice, setCaptionNotice] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef(null);
  const { alert: dlgAlert, confirm: dlgConfirm } = useDialog();
  const isElectron = !!(typeof window !== 'undefined' && window.api);

  const refreshList = useCallback(async (f) => {
    if (!f) return;
    if (!window.api) { console.warn('window.api missing - run inside Electron'); return; }
    try {
      const list = await window.api.listImages(f);
      console.log('listImages', f, list.length);
      setImages(list);
      if (list.length && !list.find(i=>i.path===selected)) {
        setSelected(list[0].path);
      }
      if (list.length===0) setSelected(null);
    } catch (e) {
      console.error('listImages failed', e);
      dlgAlert('Failed to list images: ' + e.message);
    }
  }, [selected]);

  // Fallback helper for browser-mode files
  const handleBrowserFiles = (fileList) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length===0) { dlgAlert('No images found in selection'); return; }
    const mapped = files.map((f, i) => ({
      path: `browser://${f.name}-${f.size}-${i}`,
      name: f.name,
      size: f.size,
      blobUrl: URL.createObjectURL(f),
      file: f
    }));
    // revoke old urls
    images.forEach(img => { if (img.blobUrl) URL.revokeObjectURL(img.blobUrl); });
    setImages(mapped);
    setFolder(`Browser selection (${mapped.length} images)`);
    setSelected(mapped[0].path);
    setSettings({});
    setBatch({ running:false, progress:null, result:null });
  };

  useEffect(() => {
    if (!selected) { setImageData(null); return; }
    const imgObj = images.find(i=>i.path===selected);
    if (imgObj && imgObj.blobUrl) {
      // browser fallback: use blobUrl directly, probe dimensions
      const url = imgObj.blobUrl;
      const probe = new Image();
      probe.onload = () => setImageData({ dataUrl: url, width: probe.naturalWidth, height: probe.naturalHeight, format: imgObj.name.split('.').pop() });
      probe.onerror = () => setImageData({ dataUrl: url, width: 0, height: 0, format: 'unknown' });
      probe.src = url;
      return;
    }
    if (window.api) {
      const rotation = (settings[selected] || {}).rotation || 0;
      window.api.getImageData(selected, rotation).then(setImageData).catch(e=>{ console.error(e); setImageData(null); });
    } else setImageData(null);
  }, [selected, images, (settings[selected] || {}).rotation]);

  useEffect(() => {
    if (!window.api) return;
    const off = window.api.onBatchProgress((p)=> setBatch(b=>({...b, progress:p})));
    return off;
  }, []);

  useEffect(() => {
    if (!window.api?.onUpdateAvailable) return;
    const off = window.api.onUpdateAvailable(async (info) => {
      if (!info?.available) return;
      const open = await dlgConfirm(
        `CaptionManager v${info.version} is available.\nOpen the download page to get it?`,
        { title: 'Update available', okLabel: 'Open download page', cancelLabel: 'Later' }
      );
      if (open) window.api.openPath(info.url);
    });
    return off;
  }, []);

  const pickFolder = async () => {
    if (!window.api) {
      // browser fallback: trigger hidden file input
      if (fileInputRef.current) fileInputRef.current.click();
      return;
    }
    try {
      const f = await window.api.selectFolder();
      console.log('selectFolder result', f);
      if (f) { setFolder(f); setBatch({ running:false, progress:null, result:null }); refreshList(f); }
    } catch (e) {
      console.error('pickFolder error', e);
      dlgAlert('Open Folder failed: ' + e.message);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault(); setDragOver(false);
    // Only accept real OS file/folder drops. Internal drags (e.g. an
    // accidental thumbnail drag) carry text/uri-list but no Files — ignore
    // them so the current folder is never wiped by mistake.
    const types = Array.from(e.dataTransfer?.types || []);
    if (!types.includes('Files')) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length===0) return;

    // Browser fallback (no Electron): use File API directly
    if (!window.api) {
      handleBrowserFiles(files);
      return;
    }

    // Electron: try to get real path via webUtils (file.path deprecated)
    let rawPath = '';
    try {
      rawPath = window.api.getPathForFile(files[0]) || files[0].path || '';
    } catch (err) {
      rawPath = files[0].path || '';
    }
    console.log('drop rawPath', rawPath);
    // If still empty but we have image files, fallback to browser handling
    if (!rawPath) {
      const hasImages = files.some(f=>f.type.startsWith('image/'));
      if (hasImages) { handleBrowserFiles(files); return; }
      dlgAlert('Could not resolve dropped path. Try Open Folder button.');
      return;
    }
    // Use main process to check if path is file or directory
    try {
      const info = await window.api.checkPath(rawPath);
      console.log('checkPath', info);
      let folderPath = rawPath;
      if (info.exists) {
        folderPath = info.isDirectory ? info.path : info.dir;
      } else {
        if (/\.[a-z0-9]{2,5}$/i.test(rawPath)) folderPath = rawPath.replace(/[/\\][^/\\]+$/, '');
      }
      setFolder(folderPath); setBatch({ running:false, progress:null, result:null }); refreshList(folderPath);
    } catch (err) {
      console.error('drop checkPath error', err);
      let folderPath = rawPath;
      if (/\.[a-z0-9]{2,5}$/i.test(rawPath)) folderPath = rawPath.replace(/[/\\][^/\\]+$/, '');
      setFolder(folderPath); refreshList(folderPath);
    }
  };

  const onDelete = async (path) => {
    // browser fallback: just remove from list
    if (!window.api || path.startsWith('browser://')) {
      if (!(await dlgConfirm(`Remove from list?\n${path}`, { title: 'Remove image', okLabel: 'Remove' }))) return;
      const img = images.find(i=>i.path===path);
      if (img && img.blobUrl) URL.revokeObjectURL(img.blobUrl);
      setImages(prev=> prev.filter(i=>i.path!==path));
      setSettings(prev=> { const n={...prev}; delete n[path]; return n; });
      if (selected===path) {
        const remaining = images.filter(i=>i.path!==path);
        setSelected(remaining[0]?.path || null);
      }
      return;
    }
    if (!(await dlgConfirm(`Move to Recycle Bin?\n${path}`, { title: 'Delete image', okLabel: 'Delete', danger: true }))) return;
    let res;
    try {
      res = await window.api.deleteImage(path);
    } catch (err) {
      console.error('deleteImage failed', err);
      dlgAlert('Delete failed: ' + (err.message || err));
      return;
    }
    if (res.success) {
      setImages(prev=> prev.filter(i=>i.path!==path));
      setSettings(prev=> { const n={...prev}; delete n[path]; return n; });
      if (selected===path) setSelected(prev=> {
        const remaining = images.filter(i=>i.path!==path);
        return remaining[0]?.path || null;
      });
    } else dlgAlert('Delete failed: '+res.error);
  };

  const currentSetting = settings[selected] || { crop: null, aspect:'free', upscaleEnabled:false, rotation:0 };

  const updateSetting = (path, patch) => {
    setSettings(prev=> ({ ...prev, [path]: { ...(prev[path]||{crop:null, aspect:'free', upscaleEnabled:false, rotation:0}), ...patch }}));
  };

  // Helpers to keep aspect math correct and avoid shrinking on switches
  // Crop is stored normalized (0..1) relative to natural image size.
  // Pixel aspect = (w_norm * naturalW) / (h_norm * naturalH) = w_norm/h_norm * naturalAspect
  // So to get a desired pixel ratio r = aw/ah we need w_norm/h_norm = r / naturalAspect
  const clamp01 = (v, min, max) => Math.max(min, Math.min(max, v));

  function getNaturalAspect() {
    if (imageData && imageData.width && imageData.height) return imageData.width / imageData.height;
    return 1;
  }

  function centeredCropForAspect(aspect, naturalAspect = getNaturalAspect()) {
    if (aspect === 'free' || !aspect) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const [aw, ah] = aspect.split(':').map(Number);
    const rPixel = aw / ah;
    const rNorm = rPixel / naturalAspect;
    const area = 0.64;
    let w = Math.sqrt(area * rNorm);
    let h = w / rNorm;
    if (w > 0.9) { w = 0.9; h = w / rNorm; }
    if (h > 0.9) { h = 0.9; w = h * rNorm; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  function fitCropToAspect(crop, aspect, naturalAspect = getNaturalAspect()) {
    if (!crop) return centeredCropForAspect(aspect, naturalAspect);
    if (aspect === 'free' || !aspect) return crop;
    const [aw, ah] = aspect.split(':').map(Number);
    const rPixel = aw / ah;
    const rNorm = rPixel / naturalAspect;
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    const area = crop.w * crop.h;
    let w = Math.sqrt(area * rNorm);
    let h = w / rNorm;
    const maxW = Math.min(cx * 2, (1 - cx) * 2, 0.9);
    const maxH = Math.min(cy * 2, (1 - cy) * 2, 0.9);
    const scale = Math.min(1, maxW / w, maxH / h);
    if (scale < 1) { w *= scale; h *= scale; }
    if (w < 0.05 || h < 0.05) {
      w = Math.max(w, 0.05);
      h = Math.max(h, 0.05);
      if (Math.abs(w / h - rNorm) > 0.001) {
        if (w / h > rNorm) w = h * rNorm; else h = w / rNorm;
      }
    }
    return {
      x: clamp01(cx - w / 2, 0, 1 - w),
      y: clamp01(cy - h / 2, 0, 1 - h),
      w, h
    };
  }

  const ensureCrop = () => {
    if (!selected) return;
    if (!currentSetting.crop) {
      const def = centeredCropForAspect(currentSetting.aspect);
      updateSetting(selected, { crop: def });
    }
  };

  const handleAspect = (a) => {
    if (!selected) return;
    if (!currentSetting.crop) {
      const def = centeredCropForAspect(a);
      updateSetting(selected, { aspect: a, crop: def });
      return;
    }
    if (a === 'free') {
      updateSetting(selected, { aspect: a });
      return;
    }
    const nextCrop = fitCropToAspect(currentSetting.crop, a);
    updateSetting(selected, { aspect: a, crop: nextCrop });
  };

  const toggleCrop = () => {
    if (!selected) return;
    if (currentSetting.crop) updateSetting(selected, { crop: null });
    else ensureCrop();
  };

  const handleCropChange = (newCrop) => {
    if (!selected) return;
    updateSetting(selected, { crop: newCrop });
  };

  const rotateBy = (delta) => {
    if (!selected) return;
    const cur = currentSetting.rotation || 0;
    updateSetting(selected, { rotation: (((cur + delta) % 360) + 360) % 360 });
  };

  const go = async () => {
    if (!window.api || (folder && folder.startsWith('Browser selection'))) {
      dlgAlert('Batch GO (sharp/AI) requires Electron. Run: npm run electron:dev\nIn browser mode you can still preview crops, but processing needs the desktop app.');
      return;
    }
    if (!folder || images.length===0) return dlgAlert('No images');
    if (Object.keys(settings).length===0 && !globalUpscale) {
      if (!(await dlgConfirm('No crops set. Process all images with just format conversion and '+ (globalUpscale?'upscale':'no crop') + '?', { title: 'Process without crops', okLabel: 'Process all' }))) return;
    }
    const map = {};
    for (const img of images) {
      const s = settings[img.path] || { crop:null, aspect:'free', upscaleEnabled:false, rotation:0 };
      map[img.path] = s;
    }
    setBatch({ running:true, progress:{current:0,total:images.length}, result:null });
    try {
      const res = await window.api.processBatch({ folder, settings: map, globalFormat, globalUpscale });
      setBatch({ running:false, progress:null, result: res });
      // Auto-handoff: cropped outputs become the caption queue
      try {
        const outImages = await window.api.listImages(res.outDir);
        setCaptionImages(outImages);
        setCaptionNotice(`${outImages.length} cropped image(s) ready in Caption tab`);
      } catch (e) { console.error('caption handoff list failed', e); }
    } catch (e) {
      dlgAlert('Batch failed: '+e.message);
      setBatch({ running:false, progress:null, result:null });
    }
  };

  const countCropped = Object.values(settings).filter(s=>s.crop).length;
  const countUpscaled = globalUpscale ? images.length : Object.values(settings).filter(s=>s.upscaleEnabled).length;

  return (
    <div onDragOver={e=>{e.preventDefault(); setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={handleDrop} style={{height:'100%', display:'flex', flexDirection:'column'}}>
      {/* hidden input for browser fallback */}
      <input ref={fileInputRef} type="file" multiple accept="image/*" webkitdirectory="" directory="" style={{display:'none'}} onChange={e=>{ if(e.target.files) handleBrowserFiles(e.target.files); e.target.value=''; }} />
      <div className="topbar">
        {activeTab === 'crop' && (
          <button className="btn btn-primary" onClick={pickFolder}>📁 Open Folder</button>
        )}
        <div style={{display:'flex', gap:6}} role="tablist" aria-label="Tool tabs">
          <button className={`aspect-btn ${activeTab==='crop'?'active':''}`} role="tab" aria-selected={activeTab==='crop'} onClick={()=>setActiveTab('crop')}>✂️ Crop</button>
          <button className={`aspect-btn ${activeTab==='caption'?'active':''}`} role="tab" aria-selected={activeTab==='caption'} onClick={()=>setActiveTab('caption')}>💬 Caption{captionImages.length>0?` (${captionImages.length})`:''}</button>
        </div>
        {activeTab === 'crop' && (
          <>
            <div className="folder-path" title={folder||'No folder selected'}>{folder || 'No folder selected — drag & drop a folder here'} {!isElectron && <span style={{color:'var(--accent)', fontWeight:600}}> (Browser mode — use folder picker)</span>}</div>
            <div className="toolbar-group">
              <span className="toolbar-label">Format (forced)</span>
              <select className="select" value={globalFormat} onChange={e=>setGlobalFormat(e.target.value)}>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="tif">TIF</option>
                <option value="webp">WEBP</option>
              </select>
            </div>
            <label className="checkbox" title="Global 2× upscale (sharp lanczos3)">
              <input type="checkbox" checked={globalUpscale} onChange={e=>setGlobalUpscale(e.target.checked)} /> 2× Upscale (all)
            </label>
            {images.length>0 && <span style={{fontSize:12, color:'var(--muted)'}}>{images.length} images · {countCropped} cropped · {countUpscaled} upscaled</span>}
          </>
        )}
        <button className="btn btn-ghost" onClick={()=>setSettingsOpen(true)} title="Settings — AI models folder and downloads">⚙</button>
      </div>

      {captionNotice && activeTab==='crop' && batch.result && (
        <div style={{padding:'8px 16px', background:'rgba(56,214,160,0.12)', borderBottom:'1px solid var(--border)', fontSize:13, display:'flex', gap:10, alignItems:'center'}}>
          <span>{captionNotice}</span>
          <button className="btn btn-primary" style={{fontSize:12, padding:'4px 10px'}} onClick={()=>{ setActiveTab('caption'); setCaptionNotice(null); }}>Open Caption tab →</button>
          <button className="btn btn-ghost" style={{fontSize:12, padding:'4px 8px'}} onClick={()=>setCaptionNotice(null)}>Dismiss</button>
        </div>
      )}

      {activeTab==='caption' ? (
        <div className="main" style={{display:'flex', flexDirection:'column'}}>
          <CaptionTab images={captionImages} onOpenSettings={()=>setSettingsOpen(true)} onSetImages={(list)=>{ setCaptionImages(list); setCaptionNotice(null); }} />
        </div>
      ) : (
      <>
      <div className="main">
        <div className="left">
          <div className="left-header">
            <span>THUMBNAILS — click to focus · hover × to recycle</span>
            {folder && <button className="btn btn-ghost" style={{fontSize:11, padding:'4px 8px'}} onClick={()=>refreshList(folder)}>↻ Refresh</button>}
          </div>
          <ThumbnailGrid images={images} selected={selected} onSelect={setSelected} onDelete={onDelete} settings={settings} />
        </div>

        <div className="right">
          <div className="toolbar">
            <div className="toolbar-group">
              <span className="toolbar-label">Crop</span>
              <button className={`btn ${currentSetting.crop ? 'btn-primary':''}`} onClick={toggleCrop} disabled={!selected}>{currentSetting.crop ? '✓ Crop ON' : 'Enable Crop'}</button>
              {currentSetting.crop && <button className="btn btn-ghost" onClick={()=>updateSetting(selected,{crop:null})}>Clear</button>}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Aspect</span>
              {ASPECTS.map(a=> (
                <button key={a} className={`aspect-btn ${currentSetting.aspect===a?'active':''}`} onClick={()=>handleAspect(a)} disabled={!selected || !currentSetting.crop}>{a}</button>
              ))}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Rotate</span>
              <button className="btn" onClick={()=>rotateBy(-90)} disabled={!selected} title="Rotate 90° counter-clockwise">⟲</button>
              <button className="btn" onClick={()=>rotateBy(90)} disabled={!selected} title="Rotate 90° clockwise">⟳</button>
              {(currentSetting.rotation || 0) !== 0 && (
                <>
                  <span style={{fontSize:12, color:'var(--accent2)', fontWeight:700}}>{currentSetting.rotation}°</span>
                  <button className="btn btn-ghost" onClick={()=>updateSetting(selected,{rotation:0})}>Reset</button>
                </>
              )}
            </div>
            <div className="toolbar-group">
              <span className="toolbar-label">Per-image upscale</span>
              <label className="checkbox"><input type="checkbox" disabled={!selected || globalUpscale} checked={globalUpscale ? true : !!currentSetting.upscaleEnabled} onChange={e=>updateSetting(selected,{upscaleEnabled:e.target.checked})} /> 2× this image</label>
              {globalUpscale && <span style={{fontSize:11, color:'var(--muted)'}}>global ON</span>}
            </div>
            <div className="toolbar-group zoom-controls">
              <span className="toolbar-label">Zoom</span>
              <button className="btn" onClick={()=>setZoom(z=>Math.max(0.25, +(z-0.1).toFixed(2)))}>−</button>
              <input className="slider" type="range" min="0.25" max="3" step="0.05" value={zoom} onChange={e=>setZoom(parseFloat(e.target.value))} />
              <button className="btn" onClick={()=>setZoom(z=>Math.min(3, +(z+0.1).toFixed(2)))}>+</button>
              <button className="btn btn-ghost" onClick={()=>setZoom(1)}>Fit</button>
            </div>
          </div>

          <Workspace selected={selected} imageData={imageData} settings={currentSetting} onCropChange={handleCropChange} aspect={currentSetting.aspect} zoom={zoom} setZoom={setZoom} />

          {dragOver && <div style={{position:'absolute', inset:0, background:'rgba(79,140,255,0.12)', border:'2px dashed var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, pointerEvents:'none'}}>Drop folder to load</div>}
        </div>
      </div>

      <div className="goBar" style={{height:86, background:'var(--panel)', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 16px', gap:14}}>
        <button className="go-btn" onClick={go} disabled={batch.running || images.length===0}>
          {batch.running ? `PROCESSING ${batch.progress?.current||0}/${batch.progress?.total||images.length}…` : '▶  GO  —  PROCESS ALL'}
        </button>
        <div className="progress" style={{minWidth:280}}>
          {batch.running && batch.progress && (
            <>
              <div>{batch.progress.current} / {batch.progress.total} — {batch.progress.processed} ok {batch.progress.errors?`· ${batch.progress.errors} err`:''}</div>
              <div className="progress-bar"><div className="progress-fill" style={{width: `${(batch.progress.current/batch.progress.total)*100}%`}} /></div>
            </>
          )}
          {!batch.running && batch.result && (
            <>
              <div style={{color:'var(--accent2)', fontWeight:700}}>Done — {batch.result.processed}/{batch.result.total} → {batch.result.outDir}</div>
              <button className="btn" style={{marginTop:6}} onClick={()=>window.api.openPath(batch.result.outDir)}>Open output folder</button>
              {batch.result.errors.length>0 && <div style={{color:'var(--danger)', fontSize:11}}>{batch.result.errors.length} errors (see console)</div>}
            </>
          )}
          {!batch.running && !batch.result && <span style={{color:'var(--muted)', fontSize:12}}>Settings are remembered per image until GO. Output → <code>&lt;source&gt;/CaptionManager_output_&lt;timestamp&gt;/</code></span>}
        </div>
      </div>
      </>
      )}
      <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} />
    </div>
  );
}
