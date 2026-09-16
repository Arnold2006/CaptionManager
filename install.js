module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      method: "shell.run",
      params: {
        message: ["npm i --no-audit --no-fund"]
      }
    },
    {
      method: "shell.run",
      params: {
        message: ["npm run build"]
      }
    },
    {
      method: "notify",
      params: {
        html: "Install complete. The caption models (~6 GB) download automatically during install. Click <b>Start</b> to launch CaptionManager."
      }
    }
  ]
}
