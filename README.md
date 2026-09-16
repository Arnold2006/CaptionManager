# CaptionManager

Node.js + Electron app: thumbnail grid (left) for review, large workspace (right) with draggable/resizable crop box. Per-image crop/aspect/upscale settings are remembered until big **GO** batches processing. Output saved to subfolder under source.

## Features
- **Left grid**: loads folder of images (jpg/jpeg/png/tif/tiff/webp/bmp/avif) into 3-col thumbnail grid. Click to focus. Hover `×` to **move to Recycle Bin** (`shell.trashItem`).
- **Right workspace**: large view with zoom slider. Draggable/resizable **crop box** (8 handles) with aspect locks: `free, 1:1, 4:5, 5:4, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3`. Normalized coords per image.
- **Settings memory**: each image keeps `{crop, aspect, upscaleEnabled}` in `Map`. Switching focus restores box.
- **Upscale**: global `2×` toggle (all) + per-image `2×` toggle. AI path tries `@upscaler/node`/`upscaler` with ESRGAN if installed, else falls back to **sharp lanczos3 2×** (high-quality, local, no network).
- **Forced format**: global `jpg/png/tif/webp` applied to all on export.
- **GO**: batches `crop → upscale → convert` via `sharp` into `<source>/CaptionManager_output_<ISOtimestamp>/`. Progress bar + open-output button.

## Tech
- **Electron 33** (main/preload IPC)
- **sharp 0.33** (libvips) for thumbs, crop, resize, convert, tiff
- **Vite + React 18** frontend

## Scripts
```bash
npm install          # installs sharp + electron
npm run dev          # vite only (browser preview, no Electron APIs)
npm run electron:dev # vite + electron (recommended dev)
npm run electron     # electron with built dist (needs npm run build first)
npm run build        # vite build → dist/
npm run dist         # build + electron-builder → installer (win nsis)
```

## Usage
1. `npm install`
2. `npm run electron:dev` (or `npm run build` then `npm run electron`)
3. Click **Open Folder** or drag-drop folder onto window
4. Click thumb to focus, **Enable Crop**, drag/resize box, pick aspect, toggle per-image 2× if needed
5. Set global **Format** and global **2× Upscale** if desired
6. Press **GO** — check `CaptionManager_output_...` under source

## AI Upscale Note
Pure-JS AI upscale is optional. Install for true ESRGAN:
```bash
npm install upscaler @upscaler/node onnxruntime-node
# place ESRGAN model in ./models/ (download esrgan-slim 2x)
```
Without it, GO uses sharp's lanczos 2× (still local, fast, no Python).

## Packaging
```bash
npm run dist
# output in dist/ and release installer
```

## Project Layout
```
electron/main.js, preload.js  # IPC: select-folder, list-images, thumbnails, trash, batch
src/App.jsx                   # layout + settings map + GO
src/components/ThumbnailGrid  # virtualized grid + delete
src/components/Workspace + CropBox # large view + draggable box
vite.config.js, index.html
```
