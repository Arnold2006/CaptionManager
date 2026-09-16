module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: ["git pull"]
      }
    },
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
    }
  ]
}
