import React, { useEffect, useRef, useState, useCallback } from 'react';

// Canvas bbox overlay for Ideogram captions.
// bbox format: [ymin, xmin, ymax, xmax] in 0-1000 normalized coords.
// Supports: click-to-select, drag-to-move, corner-drag resize, draw-new-box mode.
const OBJ_COLOR = '#2bd9a0';
const OBJ_HI = '#0e8f66';
const TEXT_COLOR = '#6aa8ff';
const TEXT_HI = '#2f6fd0';

export default function BboxCanvas({ src, elements, selectedIdx, drawMode, onSelect, onBboxChange, onDrawComplete }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState(null); // displayed img {w,h}
  const dragRef = useRef(null); // {kind:'move'|'resize'|'draw', ...}
  const [preview, setPreview] = useState(null); // draw preview bbox
  const previewRef = useRef(null); // mirror: endDrag must not side-effect inside a state updater
  const cbRef = useRef({ onSelect, onBboxChange, onDrawComplete });
  cbRef.current = { onSelect, onBboxChange, onDrawComplete };

  // Fit the image inside the available preview area, then record its
  // displayed size so the canvas overlay matches it exactly.
  const fitAndSync = useCallback(() => {
    const img = imgRef.current;
    const holder = wrapRef.current ? wrapRef.current.parentElement : null;
    if (img && holder && img.complete && img.naturalWidth) {
      const availW = Math.max(50, holder.clientWidth - 40);
      const availH = Math.max(50, holder.clientHeight - 40);
      const s = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1);
      if (Number.isFinite(s) && s > 0) {
        const w = Math.max(1, Math.floor(img.naturalWidth * s));
        const h = Math.max(1, Math.floor(img.naturalHeight * s));
        if (img.style.width !== w + 'px') {
          img.style.width = w + 'px';
          img.style.height = h + 'px';
        }
      }
    }
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth) {
      setSize((prev) => {
        const w = el.offsetWidth, h = el.offsetHeight;
        if (prev && prev.w === w && prev.h === h) return prev;
        return { w, h };
      });
    }
  }, []);

  useEffect(() => {
    // New image: drop any explicit size from the previous one, then fit.
    const img = imgRef.current;
    if (img) { img.style.width = ''; img.style.height = ''; }
    setSize(null);
    fitAndSync();
  }, [src, fitAndSync]);

  useEffect(() => {
    fitAndSync();
    window.addEventListener('resize', fitAndSync);
    let ro = null;
    if (wrapRef.current && wrapRef.current.parentElement && window.ResizeObserver) {
      ro = new ResizeObserver(fitAndSync);
      ro.observe(wrapRef.current.parentElement);
    }
    return () => { window.removeEventListener('resize', fitAndSync); if (ro) ro.disconnect(); };
  }, [fitAndSync, src]);

  const toScreen = (b, w, h) => ({
    x: (b[1] / 1000) * w, y: (b[0] / 1000) * h,
    w: ((b[3] - b[1]) / 1000) * w, h: ((b[2] - b[0]) / 1000) * h,
  });
  const toBboxPt = (px, py, w, h) => ({ bx: (px / w) * 1000, by: (py / h) * 1000 });

  // ---- paint ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    (elements || []).forEach((el, i) => {
      const b = el.bbox;
      if (!Array.isArray(b) || b.every((v) => v === 0)) return;
      const { x, y, w, h } = toScreen(b, size.w, size.h);
      const isHi = i === selectedIdx;
      const isText = el.type === 'text';
      ctx.strokeStyle = isText ? (isHi ? TEXT_HI : TEXT_COLOR) : (isHi ? OBJ_HI : OBJ_COLOR);
      ctx.lineWidth = isHi ? 2.5 : 1.5;
      ctx.strokeRect(x, y, w, h);
      if (isHi) {
        ctx.fillStyle = isText ? 'rgba(106,168,255,0.10)' : 'rgba(43,217,160,0.10)';
        ctx.fillRect(x, y, w, h);
      }
      // label tag
      const label = `${i + 1}. ` + (isText
        ? (el.text ? `"${el.text.slice(0, 12)}"` : (el.desc || '').slice(0, 12) || 'text')
        : (el.desc || '').slice(0, 12) || 'obj');
      ctx.font = 'bold 11px sans-serif';
      const tw = Math.min(Math.max(ctx.measureText(label).width + 8, 44), size.w - x);
      const ly = y - 16 < 0 ? y : y - 16;
      ctx.fillStyle = isText ? TEXT_HI : OBJ_HI;
      ctx.fillRect(x, ly, tw, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 4, ly + 12);
      if (isHi) {
        const hs = 8;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = isText ? TEXT_HI : OBJ_HI;
        ctx.lineWidth = 1.5;
        for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
          ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
          ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
        }
      }
    });
    if (preview && size) {
      const { x, y, w, h } = toScreen(preview, size.w, size.h);
      ctx.save();
      ctx.strokeStyle = drawMode === 'text' ? TEXT_COLOR : OBJ_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  });

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // All box indices under a point, topmost first.
  const hitStack = (p) => {
    const out = [];
    if (!size) return out;
    for (let i = elements.length - 1; i >= 0; i--) {
      const b = elements[i].bbox;
      if (!Array.isArray(b) || b.every((v) => v === 0)) continue;
      if (inRect(p, toScreen(b, size.w, size.h))) out.push(i);
    }
    return out;
  };

  const hitTest = (p) => {
    if (!size) return {};
    // corner handles of selected box
    const sel = elements[selectedIdx];
    if (sel && Array.isArray(sel.bbox)) {
      const { x, y, w, h } = toScreen(sel.bbox, size.w, size.h);
      const corners = { nw: [x, y], ne: [x + w, y], sw: [x, y + h], se: [x + w, y + h] };
      for (const [key, [cx, cy]] of Object.entries(corners)) {
        if (Math.abs(p.x - cx) <= 8 && Math.abs(p.y - cy) <= 8) return { handle: key };
      }
    }
    const stack = hitStack(p);
    if (stack.length) return { index: stack[0] };
    return {};
  };

  const onMouseDown = (e) => {
    if (!size || !elements) return;
    const p = pos(e);
    if (drawMode) {
      const { bx, by } = toBboxPt(p.x, p.y, size.w, size.h);
      dragRef.current = { kind: 'draw', startBx: bx, startBy: by };
      previewRef.current = null;
      setPreview(null);
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd+click cycles focus through stacked boxes under the cursor.
    if (e.ctrlKey || e.metaKey) {
      const stack = hitStack(p);
      if (stack.length === 0) { cbRef.current.onSelect(null); return; }
      const at = stack.indexOf(selectedIdx);
      const next = stack[(at + 1) % stack.length];
      cbRef.current.onSelect(next);
      const { bx, by } = toBboxPt(p.x, p.y, size.w, size.h);
      dragRef.current = { kind: 'move', idx: next, startBx: bx, startBy: by, orig: [...elements[next].bbox] };
      e.preventDefault();
      return;
    }
    const hit = hitTest(p);
    if (hit.handle) {
      dragRef.current = { kind: 'resize', handle: hit.handle, idx: selectedIdx, orig: [...elements[selectedIdx].bbox] };
      e.preventDefault();
      return;
    }
    if (hit.index !== undefined) {
      cbRef.current.onSelect(hit.index);
      const { bx, by } = toBboxPt(p.x, p.y, size.w, size.h);
      dragRef.current = { kind: 'move', idx: hit.index, startBx: bx, startBy: by, orig: [...elements[hit.index].bbox] };
      e.preventDefault();
      return;
    }
    cbRef.current.onSelect(null);
  };

  const onMouseMove = (e) => {
    if (!size) return;
    const d = dragRef.current;
    const p = pos(e);
    const clamp = (v) => Math.max(0, Math.min(1000, v));
    if (!d) {
      // hover cursor
      let cursor = drawMode ? 'crosshair' : 'default';
      if (!drawMode) {
        const hit = hitTest(p);
        if (hit.handle) cursor = (hit.handle === 'nw' || hit.handle === 'se') ? 'nwse-resize' : 'nesw-resize';
        else if (hit.index !== undefined) cursor = 'move';
      }
      canvasRef.current.style.cursor = cursor;
      return;
    }
    const { bx, by } = toBboxPt(p.x, p.y, size.w, size.h);
    if (d.kind === 'draw') {
      const x0 = clamp(d.startBx), y0 = clamp(d.startBy);
      const x1 = clamp(bx), y1 = clamp(by);
      const box = [Math.round(Math.min(y0, y1)), Math.round(Math.min(x0, x1)), Math.round(Math.max(y0, y1)), Math.round(Math.max(x0, x1))];
      previewRef.current = box;
      setPreview(box);
      return;
    }
    if (d.kind === 'move') {
      const [ymin, xmin, ymax, xmax] = d.orig;
      const dx = bx - d.startBx, dy = by - d.startBy;
      const hgt = ymax - ymin, wid = xmax - xmin;
      let nymin = ymin + dy, nymax = ymax + dy, nxmin = xmin + dx, nxmax = xmax + dx;
      if (nymin < 0) { nymin = 0; nymax = hgt; }
      if (nymax > 1000) { nymax = 1000; nymin = 1000 - hgt; }
      if (nxmin < 0) { nxmin = 0; nxmax = wid; }
      if (nxmax > 1000) { nxmax = 1000; nxmin = 1000 - wid; }
      cbRef.current.onBboxChange(d.idx, [Math.round(nymin), Math.round(nxmin), Math.round(nymax), Math.round(nxmax)]);
    } else if (d.kind === 'resize') {
      const [ymin, xmin, ymax, xmax] = d.orig;
      const cbx = clamp(bx), cby = clamp(by);
      let nymin = ymin, nxmin = xmin, nymax = ymax, nxmax = xmax;
      if (d.handle === 'nw') { nymin = Math.min(cby, ymax - 5); nxmin = Math.min(cbx, xmax - 5); }
      if (d.handle === 'ne') { nymin = Math.min(cby, ymax - 5); nxmax = Math.max(cbx, xmin + 5); }
      if (d.handle === 'sw') { nymax = Math.max(cby, ymin + 5); nxmin = Math.min(cbx, xmax - 5); }
      if (d.handle === 'se') { nymax = Math.max(cby, ymin + 5); nxmax = Math.max(cbx, xmin + 5); }
      cbRef.current.onBboxChange(d.idx, [Math.round(nymin), Math.round(nxmin), Math.round(nymax), Math.round(nxmax)]);
    }
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.kind === 'draw') {
      const prev = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      if (prev && prev[3] - prev[1] >= 10 && prev[2] - prev[0] >= 10) {
        cbRef.current.onDrawComplete(drawMode, prev);
      }
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxWidth: '100%', maxHeight: '100%' }}>
      <img
        ref={imgRef}
        src={src}
        alt="caption target"
        draggable={false}
        onLoad={fitAndSync}
        style={{ display: 'block', borderRadius: 6, userSelect: 'none' }}
      />
      {size && (
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        />
      )}
    </div>
  );
}
