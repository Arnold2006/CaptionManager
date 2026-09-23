import React from 'react';
import AutoTextarea from './AutoTextarea.jsx';
import PaletteField from './PaletteField.jsx';
import { elementPreview } from '../lib/caption.js';

// One Ideogram element card (object or text): desc, exact text, bbox inputs,
// palette. All mutations go through patchEl scoped to this element.
export default function ElementCard({ el, index, selected, open, onToggle, onDelete, patchEl, onSample }) {
  const b = Array.isArray(el.bbox) ? el.bbox : [0, 0, 0, 0];
  return (
    <div className={`cap-el-card ${selected ? 'hi' : ''}`} id={`cap-el-${index}`}>
      <div className="cap-el-hdr" onClick={onToggle}>
        <span className={`cap-badge ${el.type === 'obj' ? 'b-obj' : 'b-txt'}`}>{el.type === 'obj' ? 'Object' : 'Text'}</span>
        <span className="cap-el-title">{index + 1}. {elementPreview(el)}</span>
        <button className="cap-el-del" title="Delete element"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>🗑</button>
        <span className={`cap-caret ${open ? 'open' : ''}`}>▾</span>
      </div>
      {open && (
        <div className="cap-el-body">
          <div className="cap-field">
            <label>Description</label>
            <AutoTextarea rows="3" value={el.desc || ''}
              onChange={(e) => patchEl((target) => { target.desc = e.target.value; })} />
          </div>
          {el.type === 'text' && (
            <div className="cap-field">
              <label>Exact text string</label>
              <input type="text" value={el.text || ''}
                onChange={(e) => patchEl((target) => { target.text = e.target.value; })} />
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
                      patchEl((target) => {
                        if (!Array.isArray(target.bbox)) target.bbox = [0, 0, 0, 0];
                        target.bbox[j] = v;
                      });
                    }} />
                </div>
              ))}
            </div>
            <div className="cap-hint">Tip: drag the box on the image to move it, drag a corner to resize. Ctrl+click cycles through stacked boxes.</div>
          </div>
          <div className="cap-field">
            <label>Element color palette</label>
            <PaletteField
              colors={el.color_palette}
              onRemove={(ci) => patchEl((target) => { target.color_palette.splice(ci, 1); })}
              onAdd={(v) => patchEl((target) => {
                if (!target.color_palette) target.color_palette = [];
                if (!target.color_palette.includes(v)) target.color_palette.push(v);
              })}
              onSample={onSample}
              sampleLabel="🎨 Sample from image box"
            />
          </div>
        </div>
      )}
    </div>
  );
}
