module.exports = {
  run: [
    {
      method: "fs.rm",
      params: { path: "dist" }
    },
    {
      method: "fs.rm",
      params: { path: "models/Qwen3VL-8B-Instruct-Q4_K_M.gguf" }
    },
    {
      method: "fs.rm",
      params: { path: "models/mmproj-Qwen3VL-8B-Instruct-F16.gguf" }
    },
    {
      method: "notify",
      params: {
        html: "Reset complete. Click <b>Install</b> to rebuild and re-download, then <b>Start</b>."
      }
    }
  ]
}
