import React, { useCallback, useEffect, useRef, useState } from 'react';
import BboxCanvas from './BboxCanvas.jsx';
import AutoTextarea from './AutoTextarea.jsx';
import { useDialog } from './dialog.jsx';

// Caption tab: 3-column Ideogram editor (queue | image + bbox overlay | text editor),
// matching the Ideo4-Dataset-Manager layout. Plain text and Minimax H3 modes
// use a simpler text editor in the right column.

const VIEW_MODES = [
  { id: 'ideogram', label: 'Ideogram 4' },
  { id: 'plain', label: 'Plain text' },
];

const HEX_RE = /^#[0-9A-F]{6}$/;
const STEER_KEY = 'captionmanager_steering';
const loadSteering = () => {
  try { return (localStorage.getItem(STEER_KEY) || '').trim(); } catch (e) { return ''; }
};
const persistSteering = (val) => {
  try { localStorage.setItem(STEER_KEY, val); } catch (e) {}
};
const normHex = (c) => {
  const v = String(c || '').trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(v)) return '#' + [...v.slice(1)].map((x) => x + x).join('');
  return HEX_RE.test(v) ? v : null;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function emptyIdeogram() {
  return {
    high_level_description: '',
    style_description: { aesthetics: '', lighting: '', medium: 'photograph', photo: '' },
    compositional_deconstruction: { background: '', elements: [] },
  };
}

export default function CaptionTab({ images, onOpenSettings }) {
  const { alert: dlgAlert } = useDialog();
  const [batchScope, setBatchScope] = useState('all');
  const [viewMode, setViewMode] = useState('ideogram');
  const [instructions, setInstructions] = useState(() => loadSteering());
  const [steerOpen, setSteerOpen] = useState(false);
  const [server, setServer] = useState(null);
  const [serverMsg, setServerMsg] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState({}); // path -> {ideogram?, plain?, h3?, error?}
  const [edits, setEdits] = useState({}); // path -> {ideogramData?, plainText?, h3Text?, dirty?}
  const [selectedPath, setSelectedPath] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [displayUrl, setDisplayUrl] = useState(null);
  const [selElIdx, setSelElIdx] = useState(null);
  const [drawMode, setDrawMode] = useState(null);
  const [openSections, setOpenSections] = useState({ overview: true, style: true, comp: true, elements: true });
  const [openEls, setOpenEls] = useState({});
  const [savedTick, setSavedTick] = useState(null);
  const cancelRef = useRef(false);
  const editsRef = useRef({});
  const resultsRef = useRef({});
  const prevPathRef = useRef(null);
  const saveTimerRef = useRef(null);
  const isElectron = !!(typeof window !== 'undefined' && window.api?.captionGenerate);

  const selected = images.find((i) => i.path === selectedPath) || images[0] || null;
  useEffect(() => {
    if (!selectedPath || !images.some((i) => i.path === selectedPath)) {
      setSelectedPath(images[0]?.path || null);
    }
  }, [images, selectedPath]);
  useEffect(() => { setSelElIdx(null); setDrawMode(null); }, [selectedPath]);

  const refreshStatus = async () => {
    if (!window.api?.captionStatus) return;
    try { setServer(await window.api.captionStatus()); } catch (e) { console.error(e); }
  };
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    if (!window.api?.onCaptionProgress) return;
    const off = window.api.onCaptionProgress((p) => {
      if (p?.type === 'server-ready') { setServerMsg(''); refreshStatus(); }
    });
    return off;
  }, []);

  // sidebar thumbnails
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      for (const img of images) {
        if (thumbs[img.path] || !window.api?.getThumbnail) continue;
        try {
          const data = await window.api.getThumbnail(img.path, 280);
          if (!cancelled && data) next[img.path] = data;
        } catch (e) { console.error(e); }
      }
      if (!cancelled && Object.keys(next).length) setThumbs((prev) => ({ ...prev, ...next }));
    }
    load();
    return () => { cancelled = true; };
  }, [images]);

  // display image for selection (downscaled vision-size render)
  useEffect(() => {
    let cancelled = false;
    setDisplayUrl(null);
    if (!selected || !window.api?.captionImageData) return;
    window.api.captionImageData(selected.path, null)
      .then((d) => { if (!cancelled) setDisplayUrl(d.dataUrl); })
      .catch((e) => console.error(e));
    return () => { cancelled = true; };
  }, [selected && selected.path]);

  const openSteer = () => setSteerOpen(true);
  const closeSteer = () => {
    persistSteering(instructions.trim());
    setInstructions(instructions.trim());
    setSteerOpen(false);
  };
  const clearSteer = () => {
    setInstructions('');
    persistSteering('');
  };
  const onSteerInput = (v) => {
    setInstructions(v);
    persistSteering(v.trim());
  };

  useEffect(() => { editsRef.current = edits; }, [edits]);
  useEffect(() => { resultsRef.current = results; }, [results]);

  // ---------- autosave ----------
  // Saves the working copy for an image (ideogram JSON + plain text when present).
  const doAutosave = useCallback(async (imgPath) => {
    if (!window.api?.saveCaption) return;
    const e = editsRef.current[imgPath] || {};
    const r = resultsRef.current[imgPath] || {};
    const jobs = [];
    const ideogramData = e.ideogramData || r.ideogram?.data;
    if (ideogramData) jobs.push(['ideogram', ideogramData]);
    const plainText = e.plainText ?? r.plain?.text;
    if (plainText != null) jobs.push(['plain', plainText]);
    if (jobs.length === 0) return;
    try {
      for (const [mode, content] of jobs) {
        await window.api.saveCaption({ imagePath: imgPath, mode, content });
      }
      setEdits((prev) => (prev[imgPath]?.dirty ? { ...prev, [imgPath]: { ...prev[imgPath], dirty: false } } : prev));
      setSavedTick(Date.now());
    } catch (err) { console.error('autosave failed', imgPath, err); }
  }, []);

  const scheduleAutosave = useCallback((imgPath) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { doAutosave(imgPath); }, 1500);
  }, [doAutosave]);

  // Flush the previous image when focus moves to another image.
  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev && prev !== selectedPath && editsRef.current[prev]?.dirty) doAutosave(prev);
    prevPathRef.current = selectedPath;
  }, [selectedPath, doAutosave]);

  // Flush everything dirty on unmount.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    for (const p of Object.keys(editsRef.current)) {
      if (editsRef.current[p]?.dirty) doAutosave(p);
    }
  }, [doAutosave]);

  // ---------- generation ----------
  const scopeModes = () => (batchScope === 'all' ? ['ideogram', 'plain'] : [batchScope]);
  // If the models (or server binary) are missing, open Settings automatically
  // so the user can point to a folder or download them.
  const ensureReady = async () => {
    try {
      const st = await window.api.captionStatus();
      setServer(st);
      if (!st.modelPresent || !st.binPresent) {
        if (onOpenSettings) onOpenSettings();
        return false;
      }
      return true;
    } catch (e) {
      console.error(e);
      return true; // let ensureServer surface the real error
    }
  };
  const ensureServer = async () => {
    setServerMsg('Starting model server (first start loads ~5GB model, may take a minute)…');
    try {
      await window.api.captionEnsureServer();
      await refreshStatus();
    } finally { setServerMsg(''); }
  };

  const storeResult = (imgPath, mode, res) => {
    setResults((prev) => ({ ...prev, [imgPath]: { ...(prev[imgPath] || {}), [mode]: res, [`${mode}_running`]: false } }));
    if (res && res.ok) {
      setEdits((prev) => {
        const cur = prev[imgPath] || {};
        if (mode === 'ideogram' && res.data && !cur.ideogramData) {
          return { ...prev, [imgPath]: { ...cur, ideogramData: clone(res.data) } };
        }
        if ((mode === 'plain') && res.text && cur.plainText == null) {
          return { ...prev, [imgPath]: { ...cur, plainText: res.text } };
        }
        return prev;
      });
    }
  };

  const generateOne = async (imgPath, mode) => {
    setResults((prev) => ({ ...prev, [imgPath]: { ...(prev[imgPath] || {}), [mode]: null, error: null, [`${mode}_running`]: true } }));
    try {
      let res = await window.api.captionGenerate({ imagePath: imgPath, crop: null, mode, instructions });
      if (!res.ok) throw new Error(res.error || 'caption failed');
      // Replace the model's guessed palettes with colors sampled from the
      // actual image pixels (per bbox region + whole image).
      if (mode === 'ideogram' && res.data && window.api.samplePalettes) {
        try {
          const boxes = res.data.compositional_deconstruction.elements.map((el) => el.bbox || null);
          const sampled = await window.api.samplePalettes({ imagePath: imgPath, boxes });
          if (sampled) {
            const d = clone(res.data);
            d.compositional_deconstruction.elements.forEach((el, i) => {
              if (sampled.palettes[i] && sampled.palettes[i].length) el.color_palette = sampled.palettes[i];
            });
            if (sampled.global && sampled.global.length) d.style_description.color_palette = sampled.global;
            res = { ...res, data: d, prompt_compact: JSON.stringify(d) };
          }
        } catch (err) { console.error('palette sampling failed', imgPath, err); }
      }
      storeResult(imgPath, mode, res);
      // Autosave freshly generated captions immediately.
      try {
        const content = mode === 'ideogram' ? res.data : res.text;
        if (content) {
          await window.api.saveCaption({ imagePath: imgPath, mode, content });
          setSavedTick(Date.now());
        }
      } catch (err) { console.error('autosave after generate failed', imgPath, err); }
      return res;
    } catch (e) {
      setResults((prev) => ({ ...prev, [imgPath]: { ...(prev[imgPath] || {}), [`${mode}_running`]: false, error: `${mode}: ${e.message}` } }));
      return null;
    }
  };

  const generateAll = async () => {
    if (!isElectron) { dlgAlert('Captioning requires Electron (llama.cpp). Run: npm run electron:dev'); return; }
    if (images.length === 0) { dlgAlert('No images in caption queue. Run Crop → GO first.'); return; }
    if (!(await ensureReady())) return;
    cancelRef.current = false;
    setRunning(true);
    try { await ensureServer(); }
    catch (e) {
      if (/missing|not found/i.test(e.message)) { if (onOpenSettings) onOpenSettings(); }
      else dlgAlert('Model server failed: ' + e.message);
      setRunning(false);
      return;
    }
    const modes = scopeModes();
    const total = images.length * modes.length;
    let done = 0;
    setProgress({ done: 0, total });
    for (const img of images) {
      for (const mode of modes) {
        if (cancelRef.current) break;
        setProgress({ done, total, current: `${img.name} [${mode}]` });
        await generateOne(img.path, mode);
        done++;
        setProgress({ done, total });
      }
      if (cancelRef.current) break;
    }
    setProgress(cancelRef.current ? { done, total, cancelled: true } : { done, total, finished: true });
    setRunning(false);
  };

  // ---------- editable copies ----------
  const edit = selected ? edits[selected.path] || {} : {};
  const ideogramData = edit.ideogramData || null;

  const patchIdeogram = (fn) => {
    if (!selected) return;
    setEdits((prev) => {
      const cur = prev[selected.path] || {};
      const base = cur.ideogramData || clone(results[selected.path]?.ideogram?.data) || emptyIdeogram();
      const next = clone(base);
      fn(next);
      return { ...prev, [selected.path]: { ...cur, ideogramData: next, dirty: true } };
    });
    scheduleAutosave(selected.path);
  };
  const patchText = (key, value) => {
    if (!selected) return;
    setEdits((prev) => ({ ...prev, [selected.path]: { ...(prev[selected.path] || {}), [key]: value, dirty: true } }));
    scheduleAutosave(selected.path);
  };

  const elements = ideogramData?.compositional_deconstruction?.elements || [];

  const selectElement = (i) => {
    setSelElIdx(i);
    if (i !== null) setOpenEls((prev) => ({ ...prev, [i]: true }));
  };
  const onBboxChange = (idx, bbox) => {
    patchIdeogram((d) => { d.compositional_deconstruction.elements[idx].bbox = bbox; });
  };
  const onDrawComplete = (type, bbox) => {
    patchIdeogram((d) => {
      d.compositional_deconstruction.elements.push({ type, bbox, desc: '' });
    });
    setDrawMode(null);
    setSelElIdx(elements.length);
    setOpenEls((prev) => ({ ...prev, [elements.length]: true }));
  };
  const removeElement = (idx) => {
    patchIdeogram((d) => { d.compositional_deconstruction.elements.splice(idx, 1); });
    setSelElIdx(null);
  };
  const addElement = (type) => {
    patchIdeogram((d) => {
      d.compositional_deconstruction.elements.push({ type, desc: '', bbox: [0, 0, 0, 0] });
    });
    setOpenEls((prev) => ({ ...prev, [elements.length]: true }));
  };

  const sampleElementPalette = async (idx) => {
    if (!selected || !window.api?.samplePalettes || !ideogramData) return;
    const el = ideogramData.compositional_deconstruction.elements[idx];
    if (!el || !Array.isArray(el.bbox)) return;
    try {
      const { palettes } = await window.api.samplePalettes({ imagePath: selected.path, boxes: [el.bbox] });
      if (palettes[0] && palettes[0].length) {
        patchIdeogram((d) => { d.compositional_deconstruction.elements[idx].color_palette = palettes[0]; });
      } else dlgAlert('Could not sample colors for this box (box too small?).');
    } catch (err) { dlgAlert('Color sampling failed: ' + err.message); }
  };

  const sampleGlobalPalette = async () => {
    if (!selected || !window.api?.samplePalettes || !ideogramData) return;
    try {
      const { global } = await window.api.samplePalettes({ imagePath: selected.path, boxes: [] });
      if (global && global.length) {
        patchIdeogram((d) => { d.style_description.color_palette = global; });
      } else dlgAlert('Could not sample colors from this image.');
    } catch (err) { dlgAlert('Color sampling failed: ' + err.message); }
  };

  // ---------- save ----------
  const saveSelected = async () => {
    if (!selected) return;
    const r = results[selected.path] || {};
    const e = edits[selected.path] || {};
    try {
      if (viewMode === 'ideogram') {
        const data = e.ideogramData || r.ideogram?.data;
        if (!data) return dlgAlert('Nothing to save — generate a caption first.');
        const s = await window.api.saveCaption({ imagePath: selected.path, mode: 'ideogram', content: data });
        setEdits((prev) => ({ ...prev, [selected.path]: { ...(prev[selected.path] || {}), dirty: false } }));
        dlgAlert('Saved ' + s.path);
      } else {
        const text = e.plainText ?? r.plain?.text;
        if (!text) return dlgAlert('Nothing to save — generate a caption first.');
        const s = await window.api.saveCaption({ imagePath: selected.path, mode: viewMode, content: text });
        setEdits((prev) => ({ ...prev, [selected.path]: { ...(prev[selected.path] || {}), dirty: false } }));
        dlgAlert('Saved ' + s.path);
      }
    } catch (err) { dlgAlert('Save failed: ' + err.message); }
  };

  const saveAll = async () => {
    let saved = 0;
    for (const img of images) {
      const r = results[img.path] || {};
      const e = edits[img.path] || {};
      for (const mode of scopeModes()) {
        try {
          if (mode === 'ideogram') {
            const data = e.ideogramData || r.ideogram?.data;
            if (!data) continue;
            await window.api.saveCaption({ imagePath: img.path, mode, content: data });
          } else {
            const text = e.plainText ?? r.plain?.text;
            if (!text) continue;
            await window.api.saveCaption({ imagePath: img.path, mode, content: text });
          }
          saved++;
        } catch (err) { console.error(err); }
      }
    }
    setEdits((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = { ...next[k], dirty: false };
      return next;
    });
    dlgAlert(saved > 0 ? `Saved ${saved} caption file(s) next to images.` : 'Nothing to save yet — generate captions first.');
  };

  // ---------- nav / keyboard ----------
  const go = (dir) => {
    if (!images.length) return;
    const idx = images.findIndex((i) => i.path === selected?.path);
    const n = Math.min(images.length - 1, Math.max(0, idx + dir));
    setSelectedPath(images[n].path);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (steerOpen) {
        if (e.key === 'Escape') closeSteer();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeSteer(); }
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape' && drawMode) setDrawMode(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selElIdx !== null && viewMode === 'ideogram') {
        e.preventDefault();
        removeElement(selElIdx);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const toggleSection = (id) => setOpenSections((p) => ({ ...p, [id]: !p[id] }));
  const selIdx = selected ? images.findIndex((i) => i.path === selected.path) : -1;
  const res = selected ? results[selected.path] || {} : {};
  const runningAny = selected ? ['ideogram', 'plain'].some((m) => res[`${m}_running`]) : false;

  // ---------- render helpers ----------
  const chipRow = (colors, onRemove) => (
    <div className="cap-pal-row">
      {(colors || []).map((c, i) => (
        <span className="cap-chip" key={i} title={c}>
          <span className="cap-chip-sw" style={{ backgroundColor: c }} title={c} />
          {c}
          <button className="cap-chip-del" onClick={() => onRemove(i)} title="Remove">×</button>
        </span>
      ))}
      {(!colors || colors.length === 0) && <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
    </div>
  );

  const addColorRow = (pickerId, onAdd) => (
    <div className="cap-add-color">
      <input type="color" id={pickerId} defaultValue="#888888" />
      <button className="btn" style={{ fontSize: 12, padding: '5px 9px' }} onClick={() => {
        const v = normHex(document.getElementById(pickerId)?.value);
        if (v) onAdd(v);
      }}>+ Add color</button>
    </div>
  );

  const renderIdeogramEditor = () => {
    if (!ideogramData) {
      return (
        <div className="empty">
          <h3>No Ideogram caption yet</h3>
          <p>Press “AI caption” above to generate one for this image, then refine boxes and text here.</p>
        </div>
      );
    }
    const sd = ideogramData.style_description || {};
    const cd = ideogramData.compositional_deconstruction || {};
    const isPhoto = !!sd.photo && !sd.art_style ? true : sd.art_style ? false : true;
    return (
      <div>
        <div className="cap-section">
          <div className="cap-sec-hdr" onClick={() => toggleSection('overview')}>
            <span className="cap-sec-label">Overview</span>
            <span className={`cap-caret ${openSections.overview ? 'open' : ''}`}>▾</span>
          </div>
          {openSections.overview && (
            <div className="cap-sec-body">
              <div className="cap-field">
                <label>High-level description</label>
                <AutoTextarea rows="3" value={ideogramData.high_level_description || ''}
                  onChange={(e) => patchIdeogram((d) => { d.high_level_description = e.target.value; })}
                  placeholder="A one or two-sentence summary of the full image…" />
              </div>
            </div>
          )}
        </div>

        <div className="cap-section">
          <div className="cap-sec-hdr" onClick={() => toggleSection('style')}>
            <span className="cap-sec-label">Style</span>
            <span className={`cap-caret ${openSections.style ? 'open' : ''}`}>▾</span>
          </div>
          {openSections.style && (
            <div className="cap-sec-body">
              <div className="cap-field">
                <label>Aesthetics</label>
                <AutoTextarea rows="2" value={sd.aesthetics || ''}
                  onChange={(e) => patchIdeogram((d) => { d.style_description.aesthetics = e.target.value; })} />
              </div>
              <div className="cap-field">
                <label>Lighting</label>
                <AutoTextarea rows="2" value={sd.lighting || ''}
                  onChange={(e) => patchIdeogram((d) => { d.style_description.lighting = e.target.value; })} />
              </div>
              <div className="cap-field">
                <label>Medium</label>
                <input type="text" value={sd.medium || ''}
                  onChange={(e) => patchIdeogram((d) => { d.style_description.medium = e.target.value; })} />
              </div>
              <div className="cap-field">
                <label>Photo / art style</label>
                <div className="cap-pa-toggle">
                  <button className={`cap-pa-btn ${isPhoto ? 'active' : ''}`} onClick={() => patchIdeogram((d) => {
                    const s = d.style_description;
                    const v = s.art_style || s.photo || '';
                    delete s.art_style; s.photo = v;
                  })}>📷 Photo</button>
                  <button className={`cap-pa-btn ${!isPhoto ? 'active' : ''}`} onClick={() => patchIdeogram((d) => {
                    const s = d.style_description;
                    const v = s.photo || s.art_style || '';
                    delete s.photo; s.art_style = v;
                  })}>🖌 Art style</button>
                </div>
                <input type="text" value={isPhoto ? sd.photo || '' : sd.art_style || ''}
                  onChange={(e) => patchIdeogram((d) => {
                    if (isPhoto) d.style_description.photo = e.target.value;
                    else d.style_description.art_style = e.target.value;
                  })} />
              </div>
              <div className="cap-field">
                <label>Global color palette</label>
                {chipRow(sd.color_palette, (i) => patchIdeogram((d) => { d.style_description.color_palette.splice(i, 1); }))}
                {addColorRow('cap-global-picker', (v) => patchIdeogram((d) => {
                  const s = d.style_description;
                  if (!s.color_palette) s.color_palette = [];
                  if (!s.color_palette.includes(v)) s.color_palette.push(v);
                }))}
                <div className="cap-add-row">
                  <button className="cap-add-btn" onClick={sampleGlobalPalette}>🎨 Sample from image</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="cap-section">
          <div className="cap-sec-hdr" onClick={() => toggleSection('comp')}>
            <span className="cap-sec-label">Composition</span>
            <span className={`cap-caret ${openSections.comp ? 'open' : ''}`}>▾</span>
          </div>
          {openSections.comp && (
            <div className="cap-sec-body">
              <div className="cap-field">
                <label>Background</label>
                <AutoTextarea rows="2" value={cd.background || ''}
                  onChange={(e) => patchIdeogram((d) => { d.compositional_deconstruction.background = e.target.value; })} />
              </div>
            </div>
          )}
        </div>

        <div className="cap-section">
          <div className="cap-sec-hdr" onClick={() => toggleSection('elements')}>
            <span className="cap-sec-label">Elements</span>
            <span className="cap-el-count">{elements.length}</span>
            <span className={`cap-caret ${openSections.elements ? 'open' : ''}`}>▾</span>
          </div>
          {openSections.elements && (
            <div className="cap-sec-body">
              {elements.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '4px 0 10px' }}>No elements yet</div>}
              {elements.map((el, i) => {
                const b = Array.isArray(el.bbox) ? el.bbox : [0, 0, 0, 0];
                const open = !!openEls[i];
                const preview = el.desc ? el.desc.slice(0, 40) + (el.desc.length > 40 ? '…' : '')
                  : (el.type === 'text' && el.text ? `"${el.text}"` : el.type === 'obj' ? 'Object' : 'Text element');
                return (
                  <div className={`cap-el-card ${selElIdx === i ? 'hi' : ''}`} key={i} id={`cap-el-${i}`}>
                    <div className="cap-el-hdr" onClick={() => {
                      selectElement(i);
                      setOpenEls((p) => ({ ...p, [i]: !open }));
                      if (open && selElIdx === i) setSelElIdx(null);
                    }}>
                      <span className={`cap-badge ${el.type === 'obj' ? 'b-obj' : 'b-txt'}`}>{el.type === 'obj' ? 'Object' : 'Text'}</span>
                      <span className="cap-el-title">{i + 1}. {preview}</span>
                      <button className="cap-el-del" title="Delete element"
                        onClick={(e) => { e.stopPropagation(); removeElement(i); }}>🗑</button>
                      <span className={`cap-caret ${open ? 'open' : ''}`}>▾</span>
                    </div>
                    {open && (
                      <div className="cap-el-body">
                        <div className="cap-field">
                          <label>Description</label>
                          <AutoTextarea rows="3" value={el.desc || ''}
                            onChange={(e) => patchIdeogram((d) => { d.compositional_deconstruction.elements[i].desc = e.target.value; })} />
                        </div>
                        {el.type === 'text' && (
                          <div className="cap-field">
                            <label>Exact text string</label>
                            <input type="text" value={el.text || ''}
                              onChange={(e) => patchIdeogram((d) => { d.compositional_deconstruction.elements[i].text = e.target.value; })} />
                          </div>
                        )}
                        <div className="cap-field">
                          <label>Bounding box — [ymin, xmin, ymax, xmax] 0–1000</label>
                          <div className="cap-bbox-grid">
                            {['ymin', 'xmin', 'ymax', 'xmax'].map((k, j) => (
                              <div className="cap-bbox-cell" key={k}>
                                <label>{k}</label>
                                <input type="text" value={b[j] ?? 0}
                                  onChange={(e) => {
                                    const v = Math.max(0, Math.min(1000, parseInt(e.target.value) || 0));
                                    patchIdeogram((d) => { d.compositional_deconstruction.elements[i].bbox[j] = v; });
                                  }} />
                              </div>
                            ))}
                          </div>
                          <div className="cap-hint">Tip: drag the box on the image to move it, drag a corner to resize. Ctrl+click cycles through stacked boxes.</div>
                        </div>
                        <div className="cap-field">
                          <label>Element color palette</label>
                          {chipRow(el.color_palette, (ci) => patchIdeogram((d) => { d.compositional_deconstruction.elements[i].color_palette.splice(ci, 1); }))}
                          {addColorRow(`cap-elp-${i}`, (v) => patchIdeogram((d) => {
                            const target = d.compositional_deconstruction.elements[i];
                            if (!target.color_palette) target.color_palette = [];
                            if (!target.color_palette.includes(v)) target.color_palette.push(v);
                          }))}
                          <div className="cap-add-row">
                            <button className="cap-add-btn" onClick={() => sampleElementPalette(i)}>🎨 Sample from image box</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="cap-add-row">
                <button className="cap-add-btn" onClick={() => addElement('obj')}>＋ Add object</button>
                <button className="cap-add-btn" onClick={() => addElement('text')}>＋ Add text</button>
              </div>
              <div className="cap-add-row">
                <button className={`cap-add-btn ${drawMode === 'obj' ? 'active' : ''}`} onClick={() => setDrawMode((m) => (m === 'obj' ? null : 'obj'))}>▢ Draw object</button>
                <button className={`cap-add-btn ${drawMode === 'text' ? 'active' : ''}`} onClick={() => setDrawMode((m) => (m === 'text' ? null : 'text'))}>▢ Draw text</button>
              </div>
              {drawMode && <div className="cap-draw-hint">Drawing {drawMode === 'obj' ? 'OBJECT' : 'TEXT'} box — drag on the image. Click the button again or press Esc to cancel.</div>}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTextEditor = () => {
    const value = edit.plainText ?? res.plain?.text ?? '';
    if (!value && !res.plain_running) {
      return (
        <div className="empty">
          <h3>No plain-text caption yet</h3>
          <p>Press “AI caption” above to generate one, then edit it here.</p>
        </div>
      );
    }
    return (
      <div className="cap-section">
        <div className="cap-sec-hdr"><span className="cap-sec-label">Plain-text caption</span></div>
        <div className="cap-sec-body">
          <div className="cap-field">
            <AutoTextarea rows={10} style={{ fontFamily: 'inherit' }}
              value={res.plain_running ? 'Captioning…' : value}
              readOnly={!!res.plain_running}
              onChange={(e) => patchText('plainText', e.target.value)} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#0d0f13' }}>
      {/* top toolbar */}
      <div className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Batch</span>
          {[{ id: 'all', label: 'Both' }, ...VIEW_MODES].map((m) => (
            <button key={m.id} className={`aspect-btn ${batchScope === m.id ? 'active' : ''}`} onClick={() => setBatchScope(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="toolbar-group">
          <button className={`btn ${instructions.trim() ? 'btn-primary' : ''}`} onClick={openSteer} title={instructions.trim() ? 'Steering active: ' + instructions.trim() : 'Set steering instructions for captioning'}>
            🎛 Steer captioning{instructions.trim() ? ' • on' : ''}
          </button>
        </div>
        <div className="toolbar-group">
          <button className="btn btn-primary" onClick={generateAll} disabled={running || images.length === 0}>
            {running ? `Captioning ${progress?.done || 0}/${progress?.total || 0}…` : '✨ Caption all'}
          </button>
          {running && <button className="btn btn-ghost" onClick={() => { cancelRef.current = true; }}>Stop</button>}
          <button className="btn" onClick={saveAll} disabled={running}>Save all</button>
          <button className="btn btn-ghost" onClick={refreshStatus}>↻ Server</button>
        </div>
      </div>

      <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {server && (
          <span>
            Server: {server.running ? <b style={{ color: 'var(--accent2)' }}>running :{server.port}</b> : 'stopped'}
            {' · '}model {server.modelPresent ? '✓' : <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onOpenSettings}>missing — open Settings</button>}
            {' · '}llama.cpp {server.binPresent ? '✓' : <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onOpenSettings}>missing — open Settings</button>}
          </span>
        )}
        {serverMsg && <span style={{ color: 'var(--accent)' }}>{serverMsg}</span>}
        {instructions.trim() && (
          <span style={{ color: 'var(--accent)' }} title={instructions.trim()}>
            🎛 steering: “{(instructions.trim().length > 80 ? instructions.trim().slice(0, 80) + '…' : instructions.trim())}”
          </span>
        )}
        {progress && <span>{progress.cancelled ? 'Cancelled' : progress.finished ? 'Done' : progress.current || ''}</span>}
        {!isElectron && <span style={{ color: 'var(--danger)' }}>Browser mode — captioning needs Electron.</span>}
      </div>

      {images.length === 0 ? (
        <div className="empty"><h3>No cropped images yet</h3><p>Go to the Crop tab, set crops and press GO — the processed images appear here automatically.</p></div>
      ) : (
        <div className="cap-workspace">
          {/* left: queue sidebar */}
          <div className="cap-sidebar">
            <div className="cap-side-hdr">Queue · {images.length}</div>
            <div className="cap-side-grid">
              {images.map((img) => {
                const r = results[img.path] || {};
                const done = r.ideogram?.ok || r.plain?.ok || r.h3?.ok;
                return (
                  <div key={img.path} className={`cap-si ${selected?.path === img.path ? 'active' : ''}`} onClick={() => setSelectedPath(img.path)} title={img.name}>
                    {thumbs[img.path] ? <img src={thumbs[img.path]} alt={img.name} loading="lazy" /> : <div style={{ width: '100%', height: '100%', background: '#1e222b' }} />}
                    {!done && !r.error && <span className="cap-si-new">new</span>}
                    <span className={`cap-si-dot ${r.error ? 'failed' : done ? 'done' : ''}`} />
                    <div className="cap-si-cap">{img.name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* center: image + bbox overlay */}
          <div className="cap-center">
            {selected && (
              <div className="cap-imgbar">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => go(-1)} disabled={selIdx <= 0}>‹ Prev</button>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selIdx + 1} / {images.length}</span>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => go(1)} disabled={selIdx >= images.length - 1}>Next ›</button>
                <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                  {VIEW_MODES.map((m) => (
                    <button key={m.id} className={`aspect-btn ${viewMode === m.id ? 'active' : ''}`} onClick={() => setViewMode(m.id)}>{m.label}</button>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 12px', marginLeft: 'auto' }}
                  disabled={running || runningAny} onClick={async () => { if (await ensureReady()) generateOne(selected.path, viewMode); }}>
                  {res[`${viewMode}_running`] ? 'Captioning…' : res[viewMode] ? '↻ AI caption' : '✨ AI caption'}
                </button>
                <button className="btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={saveSelected} disabled={running}>
                  💾 Save{edit.dirty ? ' •' : ''}
                </button>
                {savedTick && !edit.dirty && (
                  <span style={{ fontSize: 11, color: 'var(--accent2)' }} title={new Date(savedTick).toLocaleTimeString()}>
                    ✓ saved {new Date(savedTick).toLocaleTimeString()}
                  </span>
                )}
                {res[viewMode]?.steering_used && (
                  <span style={{ fontSize: 11, color: 'var(--accent)' }} title="This caption was generated with steering instructions active">
                    🎛 steered
                  </span>
                )}
              </div>
            )}
            <div className="cap-imgwrap">
              {displayUrl ? (
                viewMode === 'ideogram' ? (
                  <BboxCanvas
                    src={displayUrl}
                    elements={elements}
                    selectedIdx={selElIdx}
                    drawMode={drawMode}
                    onSelect={selectElement}
                    onBboxChange={onBboxChange}
                    onDrawComplete={onDrawComplete}
                  />
                ) : (
                  <img src={displayUrl} alt={selected?.name} draggable={false}
                    style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', borderRadius: 6 }} />
                )
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading image…</div>
              )}
            </div>
            {res.error && <div style={{ padding: '6px 12px', color: 'var(--danger)', fontSize: 12 }}>{res.error}</div>}
            <div className="cap-imgname" title={selected?.path}>{selected?.name}</div>
          </div>

          {/* right: text editor */}
          <div className="cap-editor">
            {viewMode === 'ideogram' ? renderIdeogramEditor() : renderTextEditor()}
          </div>
        </div>
      )}

      {steerOpen && (
        <div className="cap-steer-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSteer(); }}>
          <div className="cap-steer-modal">
            <div className="cap-steer-hdr">
              <span>🎛 Steer captioning</span>
              <button className="btn btn-ghost" style={{ padding: '3px 8px' }} onClick={closeSteer}>✕</button>
            </div>
            <div className="cap-steer-body">
              <p>Give the AI a direction for every caption it generates. This text is appended to the system prompt, so use it for things like:</p>
              <ul>
                <li>Activation words: <em>"Prefix high_level_description with the word 'Sarah'"</em></li>
                <li>Style direction: <em>"Describe everything in a cinematic, moody tone"</em></li>
                <li>Consistency: <em>"Always mention the person is a young woman with short dark hair"</em></li>
              </ul>
              <label>Steering instructions</label>
              <AutoTextarea rows="5" value={instructions} onChange={(e) => onSteerInput(e.target.value)}
                placeholder='e.g. Add the word "Sarah" as a prefix to high_level_description' />
              <div className="cap-hint">Leave empty for no steering. Applies to both single and batch captions. Saving happens automatically.</div>
            </div>
            <div className="cap-steer-ftr">
              <span className="cap-steer-status">{instructions.trim() ? 'Active: ' + (instructions.trim().length > 60 ? instructions.trim().slice(0, 60) + '…' : instructions.trim()) : 'No steering (empty)'}</span>
              <button className="btn btn-ghost" onClick={clearSteer}>🗑 Clear</button>
              <button className="btn btn-primary" onClick={closeSteer}>✓ Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
