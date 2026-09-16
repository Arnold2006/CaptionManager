module.exports = {
  run: [
    {
      method: "fs.rm",
      params: { path: "dist" }
    },
    {
      method: "fs.rm",
      params: { path: "models/Huihui-Qwen3-VL-8B-Instruct-abliterated-Q4_K_M.gguf" }
    },
    {
      method: "fs.rm",
      params: { path: "models/mmproj-F16.gguf" }
    },
    {
      method: "notify",
      params: {
        html: "Reset complete. Click <b>Install</b> to rebuild and re-download, then <b>Start</b>."
      }
    }
  ]
}
