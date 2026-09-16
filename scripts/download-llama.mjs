// Downloads the latest pre-built llama.cpp binaries from GitHub for the current platform.
//
// Windows : CUDA 12.4 x64 zip + cudart DLLs, extracted with PowerShell → llama-server.exe
// Linux   : CUDA x64 zip (or CPU fallback), extracted with unzip       → llama-server
//
// Extracts everything to bin/ — electron/captionServer.js looks for the binary there.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const binDir = path.join(appDir, 'bin');

const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const SERVER_BIN = IS_WINDOWS ? 'llama-server.exe' : 'llama-server';

if (fs.existsSync(path.join(binDir, SERVER_BIN))) {
  console.log(`${SERVER_BIN} already present, skipping download.`);
  process.exit(0);
}

if (!IS_WINDOWS && !IS_LINUX) {
  console.error(`Unsupported platform: ${process.platform}. Only Windows and Linux are supported.`);
  process.exit(1);
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return resolve(getText(res.headers.location));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return resolve(downloadFile(res.headers.location, dest, redirectCount + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (total) process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`);
      });
      res.on('end', () => { file.close(() => { console.log(''); resolve(); }); });
      res.on('error', (e) => { file.close(); fs.unlink(dest, () => {}); reject(e); });
      file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    }).on('error', reject);
  });
}

function isSupportedArchive(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  const isZip = lower.endsWith('.zip');
  const isTarGz = lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
  if (IS_WINDOWS) {
    if (!isZip) throw new Error(`Unsupported archive format on Windows: ${path.basename(archivePath)}`);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
  } else if (isZip) {
    execSync(`unzip -q -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' });
  } else if (isTarGz) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported archive format: ${path.basename(archivePath)}`);
  }
  fs.unlinkSync(archivePath);
}

function findBin(dir, name) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { const r = findBin(full, name); if (r) return r; }
    if (f.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

function hoistToBinRoot(binDirPath) {
  const found = findBin(binDirPath, SERVER_BIN);
  if (!found) throw new Error(`${SERVER_BIN} not found after extraction!`);
  const subDir = path.dirname(found);
  if (subDir !== binDirPath) {
    console.log('  Hoisting files from subdirectory to bin/');
    for (const f of fs.readdirSync(subDir)) {
      const src = path.join(subDir, f);
      const dst = path.join(binDirPath, f);
      if (!fs.existsSync(dst)) fs.renameSync(src, dst);
      else fs.unlinkSync(src);
    }
    fs.rmSync(subDir, { recursive: true, force: true });
  }
  if (!IS_WINDOWS) fs.chmodSync(path.join(binDirPath, SERVER_BIN), 0o755);
}

console.log('Fetching latest llama.cpp release info...');
const releases = JSON.parse(await getText('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10'));
const release = releases.find((r) => (r.assets || []).length > 0) || releases[0];
console.log(`Using release: ${release.tag_name} (${release.assets.length} assets)`);

if (IS_WINDOWS) {
  const cudaAsset = release.assets.find((a) =>
    isSupportedArchive(a.name) && a.name.includes('win') && a.name.includes('cuda-12.4') && a.name.includes('x64') && !a.name.startsWith('cudart-'));
  if (!cudaAsset) {
    console.error('Available assets:\n' + release.assets.map((a) => a.name).join('\n'));
    throw new Error('Could not find a CUDA 12.4 Windows x64 zip. Check the asset list above.');
  }
  const cudartAsset = release.assets.find((a) =>
    a.name.startsWith('cudart-') && a.name.includes('cuda-12.4') && a.name.includes('win') && a.name.endsWith('.zip'));
  const cudaZip = path.join(appDir, 'llama-cuda.zip');
  console.log(`\nDownloading CUDA binary: ${cudaAsset.name}`);
  await downloadFile(cudaAsset.browser_download_url, cudaZip);
  const cudaSizeMB = fs.statSync(cudaZip).size / 1024 / 1024;
  console.log(`  Size on disk: ${cudaSizeMB.toFixed(1)} MB`);
  if (cudaSizeMB < 10) throw new Error('CUDA zip too small — download failed');
  console.log('  Extracting...');
  extractArchive(cudaZip, binDir);
  hoistToBinRoot(binDir);
  if (cudartAsset) {
    const cudartZip = path.join(appDir, 'llama-cudart.zip');
    console.log(`\nDownloading CUDA runtime DLLs: ${cudartAsset.name}`);
    await downloadFile(cudartAsset.browser_download_url, cudartZip);
    console.log('  Extracting...');
    extractArchive(cudartZip, binDir);
  } else {
    console.warn('cudart zip not found in release — if llama-server fails to start, install CUDA 12.4 toolkit.');
  }
  console.log(`\nDone — llama-server.exe is ready in ${binDir}`);
} else {
  const isLinuxX64Asset = (a) =>
    isSupportedArchive(a.name) &&
    (a.name.includes('ubuntu') || a.name.includes('linux')) &&
    (a.name.includes('x64') || a.name.includes('x86_64') || a.name.includes('amd64')) &&
    !a.name.includes('arm') && !a.name.startsWith('cudart-');
  const linuxAsset =
    release.assets.find((a) => isLinuxX64Asset(a) && a.name.includes('cuda-12.4') && !a.name.includes('vulkan')) ||
    release.assets.find((a) => isLinuxX64Asset(a) && a.name.includes('cuda') && !a.name.includes('vulkan')) ||
    release.assets.find((a) => isLinuxX64Asset(a) && a.name.includes('ubuntu')) ||
    release.assets.find((a) => isLinuxX64Asset(a) && a.name.includes('linux'));
  if (!linuxAsset) {
    console.error('Available assets:\n' + release.assets.map((a) => a.name).join('\n'));
    throw new Error('Could not find a Linux x64 archive (.zip/.tar.gz). Check the asset list above.');
  }
  const ext = linuxAsset.name.toLowerCase().endsWith('.tar.gz') ? '.tar.gz' : linuxAsset.name.toLowerCase().endsWith('.tgz') ? '.tgz' : '.zip';
  const linuxArchive = path.join(appDir, `llama-linux${ext}`);
  console.log(`\nDownloading Linux binary: ${linuxAsset.name}`);
  await downloadFile(linuxAsset.browser_download_url, linuxArchive);
  console.log('  Extracting...');
  extractArchive(linuxArchive, binDir);
  hoistToBinRoot(binDir);
  console.log(`\nDone — llama-server is ready in ${binDir}`);
}
