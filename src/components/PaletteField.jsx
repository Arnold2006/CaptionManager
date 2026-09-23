import React, { useState } from 'react';
import { normHex } from '../lib/caption.js';

// Color palette editor: chips + native picker + optional "sample" action.
// Local picker state replaces the old document.getElementById lookup.
export default function PaletteField({ colors, onRemove, onAdd, onSample, sampleLabel }) {
  const [pick, setPick] = useState('#888888');
  return (
    <>
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
      <div className="cap-add-color">
        <input type="color" value={pick} onChange={(e) => setPick(e.target.value)} />
        <button className="btn" style={{ fontSize: 12, padding: '5px 9px' }} onClick={() => {
          const v = normHex(pick);
          if (v) onAdd(v);
        }}>+ Add color</button>
      </div>
      {onSample && (
        <div className="cap-add-row">
          <button className="cap-add-btn" onClick={onSample}>{sampleLabel || '🎨 Sample from image'}</button>
        </div>
      )}
    </>
  );
}
