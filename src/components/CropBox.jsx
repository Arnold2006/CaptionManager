import React, { useRef, useState, useEffect } from 'react';

export default function CropBox({ containerRect, crop, onChange, aspect, zoom, naturalAspect = 1 }) {
  // crop is normalized {x,y,w,h} 0..1 relative to natural image, but we render relative to displayed image
  // containerRect: DOMRect of displayed image {width,height}
  // Pixel aspect = w_norm/h_norm * naturalAspect, so normalized ratio needed = rPixel / naturalAspect
  const [drag, setDrag] = useState(null); // {type, startX,startY, startCrop}

  if (!containerRect || !crop) return null;

  const boxLeft = crop.x * containerRect.width;
  const boxTop = crop.y * containerRect.height;
  const boxW = crop.w * containerRect.width;
  const boxH = crop.h * containerRect.height;

  function clampCrop(c) {
    let {x,y,w,h} = c;
    w = Math.max(0.05, Math.min(1, w));
    h = Math.max(0.05, Math.min(1, h));
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    return {x,y,w,h};
  }

  const handlePointerDown = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    setDrag({ type, startX: e.clientX, startY: e.clientY, startCrop: {...crop} });
  };

  useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const dxPix = e.clientX - drag.startX;
      const dyPix = e.clientY - drag.startY;
      const dx = dxPix / containerRect.width;
      const dy = dyPix / containerRect.height;
      let next = { ...drag.startCrop };
      const rPixel = aspect !== 'free' ? (()=>{const [aw,ah]=aspect.split(':').map(Number); return aw/ah;})() : null;
      const aspectRatio = rPixel ? rPixel / naturalAspect : null;

      if (drag.type === 'move') {
        next.x = drag.startCrop.x + dx;
        next.y = drag.startCrop.y + dy;
      } else {
        // resize
        let {x,y,w,h} = drag.startCrop;
        if (drag.type.includes('e')) w = drag.startCrop.w + dx;
        if (drag.type.includes('w')) { w = drag.startCrop.w - dx; x = drag.startCrop.x + dx; }
        if (drag.type.includes('s')) h = drag.startCrop.h + dy;
        if (drag.type.includes('n')) { h = drag.startCrop.h - dy; y = drag.startCrop.y + dy; }

        // aspect lock
        if (aspectRatio) {
          if (drag.type === 'e' || drag.type === 'w') {
            h = w / aspectRatio;
            if (drag.type.includes('n')) y = drag.startCrop.y + (drag.startCrop.h - h);
          } else if (drag.type === 'n' || drag.type === 's') {
            w = h * aspectRatio;
            if (drag.type.includes('w')) x = drag.startCrop.x + (drag.startCrop.w - w);
          } else {
            // corner
            // prioritize w
            h = w / aspectRatio;
            if (drag.type.includes('n')) y = drag.startCrop.y + (drag.startCrop.h - h);
            if (w < 0.05 || h < 0.05) {
              // fallback to h driven
              w = h * aspectRatio;
              if (drag.type.includes('w')) x = drag.startCrop.x + (drag.startCrop.w - w);
            }
          }
        }
        next = {x,y,w,h};
      }
      next = clampCrop(next);
      onChange(next);
    }
    function onUp() { setDrag(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return ()=> { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, containerRect, aspect, naturalAspect, onChange]);

  return (
    <div
      className="crop-box"
      style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
      onMouseDown={(e)=>handlePointerDown(e,'move')}
    >
      <div className="crop-handle h-nw" onMouseDown={e=>handlePointerDown(e,'nw')} />
      <div className="crop-handle h-ne" onMouseDown={e=>handlePointerDown(e,'ne')} />
      <div className="crop-handle h-sw" onMouseDown={e=>handlePointerDown(e,'sw')} />
      <div className="crop-handle h-se" onMouseDown={e=>handlePointerDown(e,'se')} />
      <div className="crop-handle h-n" onMouseDown={e=>handlePointerDown(e,'n')} />
      <div className="crop-handle h-s" onMouseDown={e=>handlePointerDown(e,'s')} />
      <div className="crop-handle h-w" onMouseDown={e=>handlePointerDown(e,'w')} />
      <div className="crop-handle h-e" onMouseDown={e=>handlePointerDown(e,'e')} />
    </div>
  );
}
