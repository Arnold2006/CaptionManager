import React, { useEffect, useState } from 'react';

export default function ThumbnailGrid({ images, selected, onSelect, onDelete, settings }) {
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      for (const img of images) {
        if (thumbs[img.path]) { next[img.path] = thumbs[img.path]; continue; }
        // browser fallback: use blobUrl directly
        if (img.blobUrl) { next[img.path] = img.blobUrl; continue; }
        if (!window.api) continue;
        try {
          const data = await window.api.getThumbnail(img.path, 280);
          if (!cancelled) next[img.path] = data;
        } catch (e) {
          console.error(e);
        }
      }
      if (!cancelled) setThumbs(prev => ({ ...prev, ...next }));
    }
    load();
    return () => { cancelled = true; };
  }, [images]);

  // cleanup removed images
  useEffect(() => {
    const paths = new Set(images.map(i=>i.path));
    setThumbs(prev => {
      const n = {};
      for (const k of Object.keys(prev)) if (paths.has(k)) n[k]=prev[k];
      return Object.keys(n).length !== Object.keys(prev).length ? n : prev;
    });
  }, [images]);

  if (images.length===0) {
    return <div style={{padding:24, color:'var(--muted)', fontSize:13}}>No images in folder. Select a folder with JPG/PNG/TIF/WEBP.</div>
  }

  return (
    <div className="grid">
      {images.map(img => {
        const s = settings[img.path];
        const hasCrop = s?.crop != null;
        const up = s?.upscaleEnabled;
        const isSelected = selected === img.path;
        return (
          <div key={img.path} className={`thumb ${isSelected ? 'selected':''}`} onClick={()=>onSelect(img.path)} title={img.name}>
            {thumbs[img.path] ? <img src={thumbs[img.path]} alt={img.name} loading="lazy" /> : <div style={{flex:1, background:'#1e222b'}} />}
            <div className="thumb-badges">
              {hasCrop && <span className="badge badge-green">crop</span>}
              {up && <span className="badge badge-blue">2×</span>}
            </div>
            <button className="thumb-delete" onClick={(e)=>{e.stopPropagation(); onDelete(img.path);}} title="Move to recycle bin">×</button>
            <div className="thumb-footer">{img.name}</div>
          </div>
        );
      })}
    </div>
  );
}
