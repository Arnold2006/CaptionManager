// Centralized tunable constants (CommonJS).
// Replaces magic numbers previously scattered across main.js / captionServer.js.
module.exports = {
  // Vision input sizing
  previewMax: 1200,
  previewQuality: 85,
  thumbDefaultSize: 280,
  captionMax: 1280,

  // llama-server
  llamaHost: '127.0.0.1',
  llamaPreferredPort: 8901,
  llamaPortScanMax: 20,
  llamaCtxSize: 8192,
  llamaGpuLayers: 99,
  llamaReadyTimeoutMs: 180000,
  llamaReadyPollMs: 1500,

  // Caption generation
  captionMaxAttempts: 3,
  captionFirstTemp: 0.6,
  captionRetryTemp: 0.3,
  captionTopP: 0.9,
  captionMaxTokens: 4096,
  verifyMaxTokens: 512,
  verifyTemp: 0.2,
  plainMaxTokens: 512,

  // Palette sampling
  sampleBoxTarget: 32,
  sampleGlobalTarget: 48,
  sampleElementMax: 5,
  sampleGlobalMax: 8,
  sampleMinSize: 4,
  sampleColorDistance: 32,
  sampleQuantShift: 3,

  // Timeouts / intervals
  updateTimeoutMs: 10000,
  updateStartupDelayMs: 4000,
  autosaveDebounceMs: 1500,
  selectScrollDelayMs: 60,
  viteReadyTimeoutMs: 15000,
  viteReadyPollMs: 300,
  viteHttpTimeoutMs: 600,

  // Updates
  updateRepo: 'Arnold2006/CaptionManager',
};
