# CaptionManager

Electron + React desktop app for preparing image datasets: crop workspace with batch export, plus local AI captioning (Ideogram 4 structured captions and plain text) powered by llama.cpp running Qwen3-VL.

## Tabs

### ✂️ Crop
- **Left grid**: load a folder of images (jpg/jpeg/png/tif/tiff/webp/bmp/avif) into a thumbnail grid. Click to focus, hover `×` to move to Recycle Bin.
- **Workspace**: large view with zoom slider and draggable/resizable crop box (8 handles) with aspect locks (`free, 1:1, 4:5, 5:4, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3`).
- **Settings memory**: each image keeps `{crop, aspect, upscaleEnabled}` until GO.
- **Upscale**: global `2×` toggle (all) + per-image `2×` toggle (AI ESRGAN when available, else sharp lanczos3).
- **Forced format**: global `jpg/png/tif/webp` applied on export.
- **GO**: batches `crop → upscale → convert` via sharp into `<source>/CaptionManager_output_<ISOtimestamp>/`, with progress bar + open-output button. Finished outputs are handed to the Caption tab automatically.

### 💬 Caption
- **Queue sidebar**: cropped outputs appear here after every GO, with status dots (done / failed / new).
- **Ideogram 4 editor** (3 columns: queue | image + bbox overlay | text editor):
  - Bbox canvas overlay — click to select, drag to move, corner-drag to resize, **Ctrl+click to cycle stacked boxes**, draw-new-box modes for objects and text.
  - Structured editor — Overview, Style (aesthetics, lighting, medium, photo/art toggle, palettes), Composition, Elements (desc, exact text, bbox inputs, per-element palettes).
  - **Palettes are sampled from real pixels** per bbox region after every generation (plus manual 🎨 re-sample buttons), so skin tones and clothing colors are truthful.
- **Plain-text mode**: single-paragraph captions with a simple text editor.
- **Steering modal** (🎛): instructions appended to the system prompt for every caption (e.g. prefix `high_level_description`); prefix requests are also enforced deterministically.
- **Autosave**: captions save on generate, on edit (debounced), and when switching images (`.json` / `.txt` sidecars next to the image).
- **Batch**: Caption all / Save all across the queue.

## AI backend (llama.cpp, local)

- Model: `Huihui-Qwen3-VL-8B-Instruct-abliterated-Q4_K_M.gguf` + `mmproj-F16.gguf` (spawned `llama-server`, persistent daemon, GPU layers on).
- **GGUFs are NOT bundled** with the portable exe — download at first launch.
- **Settings modal** (⚙): point to a folder containing the models, or download them in-app with progress (~6 GB). Resolution order: chosen folder → bundled `models/` (dev) → app-data folder. Starting a caption with missing models opens Settings automatically.

## Scripts

```bash
npm install          # deps + native rebuild + llama bin + VLM models (postinstall)
npm run electron:dev # vite + electron (recommended dev)
npm run electron     # electron with built dist (needs npm run build first)
npm run build        # vite build → dist/
npm run dist         # build + electron-builder → portable exe (win x64, models excluded)
npm run setup-caption    # (re)download llama-server bin + VLM models
npm run download-vlm     # VLM models only (progress bar, skip-if-complete)
npm run download-llama   # llama.cpp binaries only
```

## Pinokio

Ships as a Pinokio 8 app (`pinokio.js`, `install.js`, `start.js`, `update.js`, `reset.js`, `icon.png`): install from `https://github.com/Arnold2006/CaptionManager.git`, Install (npm + models + build), Start launches the Electron window.

## Project layout

```
electron/         # main, preload, splash — IPC, batch pipeline, caption engine,
                  # palette sampling, settings store, model downloader
src/App.jsx       # Crop/Caption tabs + handoff + settings modal host
src/components/   # ThumbnailGrid, Workspace, CropBox, BboxCanvas,
                  # CaptionTab (3-col editor), SettingsModal, AutoTextarea, dialog
scripts/          # model/llama-server download helpers
models/           # local models (gitignored: *.gguf) + esrgan placeholder
bin/              # llama-server binaries (gitignored, bundled in portable)
```
