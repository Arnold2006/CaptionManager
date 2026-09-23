import React, { useEffect, useRef, useState } from 'react';
import { mapLimit } from '../lib/mapLimit.js';

const THUMB_CONCURRENCY = 5;

export default function ThumbnailGrid({ images, selected, onSelect, onDelete, settings }) {
  const [thumbs, setThumbs] = useState({});
  const thumbsRef = useRef({});
  useEffect(() => { thumbsRef.current = thumbs; }, [thumbs]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Sync entries (browser blobs) resolve immediately; Electron thumbs load concurrently.
      const sync = {};
      const pending = [];
      for (const img of images) {
        if (thumbsRef.current[img.path]) continue;
        if (img.blobUrl) { sync[img.path] = img.blobUrl; continue; }
        if (window.api) pending.push(img);
      }
      if (Object.keys(sync).length) {
        setThumbs((prev) => ({ ...prev, ...sync }));
      }
      if (pending.length === 0) return;
      const loaded = await mapLimit(pending, THUMB_CONCURRENCY, async (img) => {
        try {
          const data = await window.api.getThumbnail(img.path, 280);
          return [img.path, data];
        } catch (e) {
          console.error(e);
          return null;
        }
      }, () => cancelled);
      if (cancelled) return;
      const next = {};
      for (const entry of loaded) {
        if (entry && entry[1]) next[entry[0]] = entry[1];
      }
      if (Object.keys(next).length) setThumbs((prev) => ({ ...prev, ...next }));
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
        const rot = s?.rotation || 0;
        const isSelected = selected === img.path;
        return (
          <div key={img.path} className={`thumb ${isSelected ? 'selected':''}`} onClick={()=>onSelect(img.path)} title={img.name}>
            {thumbs[img.path] ? <img src={thumbs[img.path]} alt={img.name} loading="lazy" draggable={false} /> : <div style={{flex:1, background:'#1e222b'}} />}
            <div className="thumb-badges">
              {hasCrop && <span className="badge badge-green">crop</span>}
              {up && <span className="badge badge-blue">2×</span>}
              {rot !== 0 && <span className="badge badge-blue">⟳ {rot}°</span>}
            </div>
            <button className="thumb-delete" onClick={(e)=>{e.stopPropagation(); onDelete(img.path);}} title="Move to recycle bin">×</button>
            <div className="thumb-footer">{img.name}</div>
          </div>
        );
      })}
    </div>
  );
}
