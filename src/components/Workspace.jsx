import React, { useEffect, useRef, useState } from 'react';
import CropBox from './CropBox.jsx';

export default function Workspace({ selected, imageData, settings, onCropChange, aspect, zoom, setZoom }) {
  const imgRef = useRef(null);
  const [rect, setRect] = useState(null);

  function updateRect() {
    if (imgRef.current) {
      const r = imgRef.current.getBoundingClientRect();
      // need relative to container; but CropBox positioned absolute inside inner wrapper, so use width/height only
      setRect({ width: imgRef.current.offsetWidth, height: imgRef.current.offsetHeight });
    }
  }

  useEffect(() => { updateRect(); }, [imageData, zoom]);
  useEffect(() => {
    window.addEventListener('resize', updateRect);
    return ()=> window.removeEventListener('resize', updateRect);
  }, []);

  if (!selected) {
    return <div className="empty"><h3>No image selected</h3><p>Pick an image from the grid to edit</p></div>
  }
  if (!imageData) {
    return <div className="empty"><p>Loading…</p></div>
  }

  const crop = settings?.crop || null;
  const naturalAspect = imageData && imageData.width && imageData.height ? imageData.width / imageData.height : 1;

  return (
    <div className="workspace">
      <div className="workspace-inner" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}>
        <img
          ref={imgRef}
          src={imageData.dataUrl}
          alt="workspace"
          onLoad={updateRect}
          draggable={false}
        />
        {crop && rect && (
          <CropBox containerRect={rect} crop={crop} onChange={onCropChange} aspect={aspect} zoom={zoom} naturalAspect={naturalAspect} />
        )}
      </div>
      {zoom !== 1 && (
        <div style={{position:'absolute', bottom:16, right:16, background:'rgba(0,0,0,0.6)', padding:'6px 10px', borderRadius:20, fontSize:12, border:'1px solid rgba(255,255,255,0.15)'}}>
          Zoom {(zoom*100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}
