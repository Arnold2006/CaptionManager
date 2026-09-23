module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        env: {
          CAPTIONMANAGER_USE_DIST: "1"
        },
        message: ["npx electron ."]
      }
    }
  ]
}
