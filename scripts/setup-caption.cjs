// First-run setup: downloads llama.cpp binaries + VLM caption model.
// Runs as part of `npm install` (postinstall). Never fails the install:
// network errors only print a warning — the Caption tab will show exactly
// what is still missing and the user can re-run `npm run setup-caption`.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(script) {
  const full = path.join(__dirname, script);
  console.log(`[setup-caption] running ${script} ...`);
  const r = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (r.error) {
    console.warn(`[setup-caption] ${script} could not start: ${r.error.message}`);
    return false;
  }
  if (r.status !== 0) {
    console.warn(`[setup-caption] ${script} exited with code ${r.status} — will retry on next install or via 'npm run setup-caption'.`);
    return false;
  }
  return true;
}

const okLlama = run('download-llama.mjs');
const okVlm = run('download-vlm-model.mjs');

if (okLlama && okVlm) console.log('[setup-caption] caption backend ready.');
else console.warn('[setup-caption] incomplete — re-run `npm run setup-caption` with network access.');
// Never break `npm install`.
process.exit(0);
