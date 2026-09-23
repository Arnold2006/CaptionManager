const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  listImages: (folder) => ipcRenderer.invoke('list-images', folder),
  getThumbnail: (p, size) => ipcRenderer.invoke('get-thumbnail', p, size),
  getImageData: (p, rotation) => ipcRenderer.invoke('get-image-data', p, rotation),
  deleteImage: (p) => ipcRenderer.invoke('delete-image', p),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  processBatch: (payload) => ipcRenderer.invoke('process-batch', payload),
  checkPath: (p) => ipcRenderer.invoke('check-path', p),
  getPathForFile: (file) => {
    try {
      if (webUtils && webUtils.getPathForFile) return webUtils.getPathForFile(file);
    } catch {}
    return file.path || '';
  },
  onBatchProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('batch-progress', handler);
    return () => ipcRenderer.removeListener('batch-progress', handler);
  },
  captionStatus: () => ipcRenderer.invoke('caption-status'),
  captionEnsureServer: () => ipcRenderer.invoke('caption-ensure-server'),
  captionStopServer: () => ipcRenderer.invoke('caption-stop-server'),
  captionImageData: (p, crop) => ipcRenderer.invoke('caption-image-data', p, crop),
  captionGenerate: (payload) => ipcRenderer.invoke('caption-generate', payload),
  saveCaption: (payload) => ipcRenderer.invoke('save-caption', payload),
  samplePalettes: (payload) => ipcRenderer.invoke('sample-palettes', payload),
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings-set', patch),
  modelsBrowse: () => ipcRenderer.invoke('models-browse'),
  modelsStatus: () => ipcRenderer.invoke('models-status'),
  modelsDownload: () => ipcRenderer.invoke('models-download'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onUpdateAvailable: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onModelsProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('models-progress', handler);
    return () => ipcRenderer.removeListener('models-progress', handler);
  },
  onCaptionProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('caption-progress', handler);
    return () => ipcRenderer.removeListener('caption-progress', handler);
  }
});
