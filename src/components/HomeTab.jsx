import React from 'react';
import appIcon from '../../icon.png';

// Static opening screen: what the app does + the two entry points.
// No folder state and no counts — Crop and Caption own their folder pickers.
export default function HomeTab({ onNavigate }) {
  return (
    <div className="home">
      <div className="home-card">
        <img className="home-icon" src={appIcon} alt="" />
        <h1 className="home-title">CaptionManager</h1>
        <p className="home-tagline">Crop your image set, then caption it with a local AI.</p>
        <div className="home-doors">
          <button className="home-door" onClick={() => onNavigate('crop')}>
            <span className="home-door-icon">✂️</span>
            <span className="home-door-name">Crop</span>
            <span className="home-door-desc">Cut, rotate, upscale and batch-export your images.</span>
            <span className="home-door-go">Open →</span>
          </button>
          <button className="home-door" onClick={() => onNavigate('caption')}>
            <span className="home-door-icon">💬</span>
            <span className="home-door-name">Caption</span>
            <span className="home-door-desc">Describe every image — structured or plain text.</span>
            <span className="home-door-go">Open →</span>
          </button>
        </div>
        <p className="home-hint">Both work on the folder you pick inside.</p>
      </div>
    </div>
  );
}
