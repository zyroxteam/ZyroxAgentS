#!/usr/bin/env node
/**
 * ZYROX — AI toolkit for Termux/Android
 *
 * One command for everything:
 *   toxic                  -> interactive menu (local AI, coding agents)
 *   toxic install          -> download + install the ZYROX runtime
 *   toxic update           -> update the ZYROX runtime
 *   toxic uninstall        -> remove the ZYROX runtime
 *   toxic status           -> installation status
 *   toxic gemini [prompt]  -> chat with Google Gemini
 *                             (6 bundled API keys, auto-switch on expiry)
 *   toxic <cmd> [args...]  -> forwarded to the local AI runtime
 *                             (serve, run, pull, list, launch, ps, stop, ...)
 *
 * Gemini auto key rotation:
 *   - keys are tried in order; on 429 (quota/expired) or 401/403 (invalid)
 *     the next key is switched in automatically
 *   - rate-limited keys cool down for 60s, then rejoin the pool
 *   - GEMINI_API_KEY env var (comma-separated keys allowed) takes priority
 *     over the bundled keys
 *
 * MIT licensed — see LICENSE.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ZYROX_VERSION = require('./package.json').version;

// Upstream pre-built runtime this ZYROX release ships.
const RUNTIME_REPO = 'DioNanos/ollama-termux';
const DEFAULT_RUNTIME_VERSION = '0.32.2-termux.1';

const TERMUX_PREFIX = '/data/data/com.termux/files/usr';
const OLLAMA_BIN = path.join(TERMUX_PREFIX, 'bin', 'ollama');
const OLLAMA_LIB = path.join(TERMUX_PREFIX, 'lib', 'ollama');
const OLLAMA_REAL_BIN = path.join(OLLAMA_LIB, 'ollama');

// Local model manifests (filesystem check — server ki zaroorat nahi).
function localModelCount() {
  const home = process.env.HOME || path.join(TERMUX_PREFIX, '..', 'home');
  const manifests = path.join(home, '.ollama', 'models', 'manifests');
  let count = 0;
  const walk = (dir) => {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.isFile()) count++;
      }
    } catch { /* ignore */ }
  };
  walk(manifests);
  return count;
}

// Gemini (cloud) defaults — override with GEMINI_MODEL.
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const GEMINI_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

// Bundled Gemini API keys — auto-rotated on expiry / rate limit.
// Priority: GEMINI_API_KEY env (comma-separated allowed) > bundled keys.
// Keys stored base64-encoded (runtime pe decode hoti hain).
const BUNDLED_GEMINI_KEYS = [
  'QVEuQWI4Uk42S1BhbHY1SmxCOTdvdy05VXBCQlpWWnFTTEZWTktiSWxNUG9IWWRzekE2MUE=',
  'QVEuQWI4Uk42SXl4ZFBia0hrYVAwRmExR1lDalpNVnlvUWpTRFRoclhJUnVjcmt3bGU1aEE=',
  'QVEuQWI4Uk42TERRdy1GMGI5a19WeE9jU2dIT1JBMjZCYTNrdExBS0JkbUFDdU4xa1RZYWc=',
  'QVEuQWI4Uk42SkV3MVd2MENEUHpUVF9kX1lrbWN2TlE2OUE0UUdpWGg2MENyb2lVdHR3WlE=',
  'QVEuQWI4Uk42SngzaWhTSm9kY2xwZXJ3R3BLdDl4Ni11VERRRmRxbHk4RjZOZ3BfQlp3akE=',
  'QVEuQWI4Uk42SUdzR2plSlllaW5DSnpFcEtNdnNZbHRRVEJwRnFhQUI5NWJsVEFFSXhZWHc=',
].map((b64) => Buffer.from(b64, 'base64').toString('utf8'));

const KEY_COOLDOWN_MS = 60_000; // rate-limited key rejoin timeout

// Key rotation state (per session).
const keyPool = {
  cooldownUntil: new Map(), // key -> timestamp
  invalid: new Set(), // keys rejected with 401/403
  sticky: null, // last (key, model) pair that worked
};

function geminiApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) {
    for (const k of process.env.GEMINI_API_KEY.split(',')) {
      const t = k.trim();
      if (t) keys.push(t);
    }
  }
  return keys.concat(BUNDLED_GEMINI_KEYS);
}

function keyAvailable(key) {
  if (keyPool.invalid.has(key)) return false;
  const until = keyPool.cooldownUntil.get(key);
  return !until || until <= Date.now();
}

function markKeyRateLimited(key) {
  keyPool.cooldownUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
}

function markKeyInvalid(key) {
  keyPool.invalid.add(key);
}

function maskKey(key) {
  if (key.length <= 12) return key.slice(0, 4) + '…';
  return key.slice(0, 8) + '…' + key.slice(-4);
}

function availableGeminiKeys() {
  const all = geminiApiKeys().filter(keyAvailable);
  // Sticky key first for instant reuse.
  if (keyPool.sticky) {
    const i = all.indexOf(keyPool.sticky.key);
    if (i > 0) all.unshift(all.splice(i, 1)[0]);
  }
  return all;
}

const HELP_TEXT = `TOXIC v${ZYROX_VERSION} — ZYROX AGENT core — AI toolkit for Termux

Usage:
  toxic                     FREE Gemini chat (6 keys) — seedha kaam karta hai
  toxic install             Install / repair the ZYROX runtime
  toxic update              Update the ZYROX runtime
  toxic uninstall           Remove the ZYROX runtime
  toxic status              Show installation status
  toxic gemini [prompt]     Chat with Google Gemini (6 keys built-in)
  toxic chat                Same as gemini (interactive)
  toxic menu                Original interactive menu (agents ke liye)
  toxic help                Show this help

Local AI (passed straight to the runtime):
  toxic serve               Start the local AI server (background: toxic serve &)
  toxic pull <model>        Download a model   (e.g. toxic pull qwen3.5:4b)
  toxic run <model>         Chat with a model (e.g. toxic run qwen3.5:4b)
  toxic list                List installed models
  toxic launch <agent>      Launch a coding agent (qwen, codex, pi, ...)
  toxic ps / stop           Running models / stop them

Gemini cloud chat (auto key rotation):
  toxic gemini "explain quantum computing"
  toxic gemini                          # interactive chat
  export GEMINI_MODEL="gemini-3.6-flash"  # (optional) model override
  export GEMINI_API_KEY="your-key"     # (optional) apni key — priority milti hai
                                        # 6 bundled keys auto-switch hoti hain:
                                        # expired/quota-full → agli key khud

Docs: README.md  |  License: MIT`;

function log(msg) {
  console.log(`[toxic] ${msg}`);
}

function isTermux() {
  return fs.existsSync(TERMUX_PREFIX);
}

function runtimeVersion() {
  return process.env.ZYROX_RUNTIME_VERSION || DEFAULT_RUNTIME_VERSION;
}

function isInstalled() {
  return fs.existsSync(OLLAMA_REAL_BIN) && fs.existsSync(OLLAMA_BIN);
}

// ---------------------------------------------------------------------------
// region: secure download + verified install (from upstream installer)
// ---------------------------------------------------------------------------

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects) => {
      if (redirects > 5) return reject(new Error('too many redirects'));
      let parsed;
      try {
        parsed = new URL(u);
      } catch (e) {
        return reject(new Error(`invalid download URL: ${e.message}`));
      }
      if (parsed.protocol !== 'https:') {
        return reject(new Error(`refusing non-HTTPS download URL: ${parsed.href}`));
      }

      const req = https.get(parsed, { headers: { 'User-Agent': 'toxic-installer' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, parsed).href;
          res.resume();
          follow(next, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        res.setTimeout(60_000, () => res.destroy(new Error(`download stalled for ${u}`)));
        resolve(res);
      });
      req.setTimeout(30_000, () => req.destroy(new Error('connection timed out')));
      req.on('error', reject);
    };
    follow(url, 0);
  });
}

async function downloadAndVerify(url, dest, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('a valid SHA256 checksum is required');
  }

  const tmpDest = dest + '.tmp';
  try {
    const res = await fetchUrl(url);
    const fileStream = fs.createWriteStream(tmpDest, { flags: 'wx', mode: 0o600 });
    const hash = crypto.createHash('sha256');
    res.on('data', (chunk) => hash.update(chunk));
    res.pipe(fileStream);

    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      res.on('aborted', () => reject(new Error(`download aborted for ${url}`)));
      res.on('error', reject);
    });

    const actualSha = hash.digest('hex');
    if (actualSha !== expectedSha256) {
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha}`);
    }

    fs.renameSync(tmpDest, dest);
    return actualSha;
  } catch (e) {
    fs.rmSync(tmpDest, { force: true });
    throw e;
  }
}

function parseChecksum(text, expectedFilename) {
  const match = /^([0-9a-fA-F]{64})\s+\*?([^\r\n]+)\s*$/.exec(text);
  if (!match) {
    throw new Error('invalid SHA256 checksum file');
  }
  if (match[2] !== expectedFilename) {
    throw new Error(`checksum names ${match[2]}, expected ${expectedFilename}`);
  }
  return match[1].toLowerCase();
}

function normalizedArchiveEntry(raw) {
  const entry = raw.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!entry || entry === '.') return '';
  if (entry.includes('\0') || path.posix.isAbsolute(entry)) {
    throw new Error(`unsafe archive path: ${raw}`);
  }
  const normalized = path.posix.normalize(entry);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`archive path escapes extraction root: ${raw}`);
  }
  return normalized;
}

function validateArchiveListing(listing) {
  const entries = new Set();
  for (const raw of listing.split(/\r?\n/)) {
    if (!raw) continue;
    const entry = normalizedArchiveEntry(raw);
    if (!entry) continue;
    const allowed = entry === 'install.js' || entry === 'bin' || entry.startsWith('bin/') ||
      entry === 'lib' || entry === 'lib/ollama' || entry.startsWith('lib/ollama/');
    if (!allowed) {
      throw new Error(`unexpected archive path: ${raw}`);
    }
    if (entries.has(entry)) {
      throw new Error(`duplicate archive path: ${raw}`);
    }
    entries.add(entry);
  }

  for (const required of ['bin/ollama', 'lib/ollama/llama-server', 'lib/ollama/libggml-base.so']) {
    if (!entries.has(required)) {
      throw new Error(`release archive is missing ${required}`);
    }
  }
  if (![...entries].some((entry) => /^lib\/ollama\/libggml-cpu.*\.so$/.test(entry))) {
    throw new Error('release archive is missing a ggml CPU backend');
  }
}

function validateArchiveTypes(verboseListing) {
  for (const line of verboseListing.split(/\r?\n/)) {
    if (!line) continue;
    if (line[0] !== '-' && line[0] !== 'd') {
      throw new Error(`link or special archive entry rejected: ${line}`);
    }
    const mode = line.slice(0, 10);
    if (/[sStT]/.test(mode)) {
      throw new Error(`privileged archive mode rejected: ${line}`);
    }
  }
}

function validateExtractedTree(root) {
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      const stat = fs.lstatSync(target);
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink > 1)
      ) {
        throw new Error(`unsafe extracted entry: ${path.relative(root, target)}`);
      }
      if ((stat.mode & 0o7000) !== 0) {
        throw new Error(`privileged extracted mode: ${path.relative(root, target)}`);
      }
      if (stat.isDirectory()) visit(target);
    }
  };
  visit(root);

  for (const required of ['bin/ollama', 'lib/ollama/llama-server', 'lib/ollama/libggml-base.so']) {
    const target = path.join(root, required);
    if (!fs.statSync(target).isFile()) {
      throw new Error(`release payload is missing ${required}`);
    }
  }
  for (const executable of ['bin/ollama', 'lib/ollama/llama-server']) {
    if ((fs.statSync(path.join(root, executable)).mode & 0o111) === 0) {
      throw new Error(`release payload is not executable: ${executable}`);
    }
  }
  const cpuBackends = fs.readdirSync(path.join(root, 'lib', 'ollama'))
    .filter((name) => /^libggml-cpu.*\.so$/.test(name));
  if (cpuBackends.length === 0) {
    throw new Error('release payload is missing a ggml CPU backend');
  }
}

function backupIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    const backup = filePath + '.orig';
    log(`Backing up ${path.basename(filePath)} to ${path.basename(backup)}`);
    fs.copyFileSync(filePath, backup);
  }
}

function writeOllamaWrapper(target = OLLAMA_BIN) {
  const script = `#!/data/data/com.termux/files/usr/bin/sh
PREFIX="\${PREFIX:-/data/data/com.termux/files/usr}"
OLLAMA_REAL_BIN="$PREFIX/lib/ollama/ollama"
export LD_LIBRARY_PATH="/system/lib64:$PREFIX/lib/ollama:$PREFIX/lib/ollama/vulkan:$PREFIX/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$OLLAMA_REAL_BIN" "$@"
`;
  fs.writeFileSync(target, script, { flags: 'wx', mode: 0o755 });
  fs.chmodSync(target, 0o755);
}

function copyTree(srcDir, dstDir, relDir = '') {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    const rel = path.join(relDir, entry.name);

    if (entry.isDirectory()) {
      copyTree(src, dst, rel);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`refusing non-regular release entry: ${rel}`);
    }

    backupIfExists(dst);
    fs.copyFileSync(src, dst);
    // Preserve the source mode: lib/ollama ships the llama-server
    // executable alongside the .so libraries.
    fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
    log('Installed: ' + path.join('lib/ollama', rel));
  }
}

function activateStagedInstall(stagedLib, stagedWrapper, liveLib, liveWrapper) {
  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const backupLib = `${liveLib}.backup-${suffix}`;
  let liveMoved = false;
  let stagedActivated = false;

  try {
    if (fs.existsSync(liveLib)) {
      fs.renameSync(liveLib, backupLib);
      liveMoved = true;
    }
    fs.renameSync(stagedLib, liveLib);
    stagedActivated = true;

    // Commit point: the wrapper is replaced only after the complete runtime
    // directory is active. No fallible installation step follows this rename.
    fs.renameSync(stagedWrapper, liveWrapper);
  } catch (e) {
    const rollbackErrors = [];
    try {
      if (stagedActivated && fs.existsSync(liveLib)) {
        fs.rmSync(liveLib, { recursive: true, force: true });
      }
    } catch (rollbackError) {
      rollbackErrors.push(`remove staged runtime: ${rollbackError.message}`);
    }
    try {
      if (liveMoved && fs.existsSync(backupLib)) {
        fs.renameSync(backupLib, liveLib);
      }
    } catch (rollbackError) {
      rollbackErrors.push(`restore previous runtime: ${rollbackError.message}`);
    }
    fs.rmSync(stagedWrapper, { force: true });

    if (rollbackErrors.length > 0) {
      throw new Error(`${e.message}; rollback failed: ${rollbackErrors.join('; ')}`);
    }
    throw e;
  }

  if (liveMoved) {
    try {
      fs.rmSync(backupLib, { recursive: true, force: true });
    } catch (e) {
      log(`Warning: unable to remove previous runtime backup ${backupLib}: ${e.message}`);
    }
  }
}

function installPayloadAtomically(extractedBin, extractedLib) {
  const libParent = path.dirname(OLLAMA_LIB);
  fs.mkdirSync(libParent, { recursive: true });
  fs.mkdirSync(path.dirname(OLLAMA_BIN), { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(libParent, '.ollama-install-'));
  const stagedLib = path.join(stageRoot, 'ollama');
  const stagedWrapper = path.join(stageRoot, 'ollama-wrapper');

  try {
    copyTree(extractedLib, stagedLib);

    // Keep the same one-generation backup behavior as previous releases.
    if (fs.existsSync(OLLAMA_REAL_BIN)) {
      const previousRealBin = path.join(stagedLib, 'ollama.orig');
      fs.copyFileSync(OLLAMA_REAL_BIN, previousRealBin);
      fs.chmodSync(previousRealBin, fs.statSync(OLLAMA_REAL_BIN).mode & 0o777);
    }

    fs.copyFileSync(extractedBin, path.join(stagedLib, 'ollama'));
    fs.chmodSync(path.join(stagedLib, 'ollama'), 0o755);
    writeOllamaWrapper(stagedWrapper);

    // Build and validate the entire replacement before touching live paths.
    if (!fs.statSync(path.join(stagedLib, 'llama-server')).isFile()) {
      throw new Error('staged runtime is missing llama-server');
    }
    backupIfExists(OLLAMA_BIN);
    activateStagedInstall(stagedLib, stagedWrapper, OLLAMA_LIB, OLLAMA_BIN);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// endregion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// region: install / update / uninstall / status
// ---------------------------------------------------------------------------

async function installRuntime() {
  if (!isTermux()) {
    console.log('[toxic] TOXIC runs on Termux (Android) only.');
    console.log('');
    console.log('Install Termux from F-Droid, then:');
    console.log('  pkg install nodejs-lts git -y');
    console.log('  npm install -g github:zyroxteam/ZyroxAgentS');
    console.log('  toxic install');
    return;
  }

  const version = runtimeVersion();

  log(`Installing TOXIC runtime v${version}...`);
  log('');

  const tarballName = `ollama-termux-${version}-android-arm64.tar.gz`;
  const tmpBase = process.env.TMPDIR || os.tmpdir() || path.join(TERMUX_PREFIX, 'tmp');
  fs.mkdirSync(tmpBase, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'toxic-install-'));

  const tarballPath = path.join(tmpDir, tarballName);

  // Download from GitHub releases
  const tarballUrl = `https://github.com/${RUNTIME_REPO}/releases/download/v${version}/${tarballName}`;
  const sha256Url = tarballUrl + '.sha256';

  log(`Downloading ${tarballName}...`);
  try {
    const shaRes = await fetchUrl(sha256Url);
    const shaText = await new Promise((resolve, reject) => {
      let data = '';
      shaRes.on('data', (chunk) => data += chunk);
      shaRes.on('end', () => resolve(data));
      shaRes.on('error', reject);
    });
    const expectedSha = parseChecksum(shaText, tarballName);
    log(`Expected SHA256: ${expectedSha.substring(0, 16)}...`);
    await downloadAndVerify(tarballUrl, tarballPath, expectedSha);
    log('Checksum verified');

    const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' });
    validateArchiveListing(listing);
    const verboseListing = execFileSync('tar', ['-tvzf', tarballPath], { encoding: 'utf8' });
    validateArchiveTypes(verboseListing);

    log('Extracting...');
    execFileSync('tar', ['-xzf', tarballPath, '-C', tmpDir], { stdio: 'pipe' });
    validateExtractedTree(tmpDir);

    // Validate the complete payload before modifying an existing installation.
    const extractedBin = path.join(tmpDir, 'bin', 'ollama');
    const extractedLib = path.join(tmpDir, 'lib', 'ollama');

    // Stage the binary, server and all backends together, then activate the
    // complete runtime with a same-filesystem directory rename and rollback.
    installPayloadAtomically(extractedBin, extractedLib);
    log('Installed: ' + OLLAMA_REAL_BIN);
    log('Installed wrapper: ' + OLLAMA_BIN);

    log('');
    log('TOXIC installed successfully!');
  } catch (e) {
    log(`Installation aborted: ${e.message}`);
    log('The matching GitHub Release and mandatory checksum must both exist.');
    throw e;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  log('');
  log('Quick start:');
  log('  toxic                  # interactive menu');
  log('  toxic serve &          # start the local AI server');
  log('  toxic pull qwen3.5:4b  # download a model (4GB+ RAM phones)');
  log('  toxic run qwen3.5:4b   # chat with it — fully offline');
  log('  toxic launch qwen      # coding agent (2000 free req/day)');
  log('  toxic gemini "hi"      # Gemini cloud (keys built-in)');
}

function uninstallRuntime() {
  if (!isTermux()) {
    console.log('[toxic] Not running on Termux — nothing to uninstall.');
    return;
  }
  let removed = false;
  for (const target of [OLLAMA_BIN, OLLAMA_BIN + '.orig', OLLAMA_LIB]) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      log('Removed: ' + target);
      removed = true;
    }
  }
  // Clean any leftover staging dirs.
  const libParent = path.dirname(OLLAMA_LIB);
  if (fs.existsSync(libParent)) {
    for (const entry of fs.readdirSync(libParent)) {
      if (entry.startsWith('.ollama-install-')) {
        fs.rmSync(path.join(libParent, entry), { recursive: true, force: true });
        log('Removed staging: ' + entry);
        removed = true;
      }
    }
  }
  log(removed ? 'TOXIC runtime removed. (Models stay in ~/.ollama — delete it to free space.)'
              : 'Runtime not found — already uninstalled.');
}

function statusRuntime() {
  const keys = geminiApiKeys();
  const envKeys = keys.length - BUNDLED_GEMINI_KEYS.length;
  const cooling = keys.filter((k) => !keyAvailable(k)).length;
  console.log(`TOXIC v${ZYROX_VERSION} — ZYROX AGENT core`);
  console.log(`Runtime version : ${runtimeVersion()}`);
  console.log(`Termux detected : ${isTermux() ? 'yes' : 'no'}`);
  console.log(`Runtime binary  : ${isInstalled() ? 'installed (' + OLLAMA_REAL_BIN + ')' : 'not installed (run: toxic install)'}`);
  console.log(`Local models    : ${localModelCount()} (cloud models avoid karo — subscription chahiye)`);
  console.log(`Gemini keys     : ${keys.length} total (${envKeys} env + ${BUNDLED_GEMINI_KEYS.length} bundled)` +
    (cooling > 0 ? ` — ${cooling} cooling down` : ' — all ready'));
  console.log(`Auto key switch : ON (429/401/403 → next key, 60s cooldown)`);
  console.log(`Gemini model    : ${process.env.GEMINI_MODEL || 'auto (' + GEMINI_FALLBACK_MODELS.join(' → ') + ')'}`);
  console.log(`Menu            : toxic menu (cloud default hai — sambhal ke)`);
}

// ---------------------------------------------------------------------------
// endregion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// region: Gemini cloud chat (zero dependencies)
// ---------------------------------------------------------------------------

function geminiModels() {
  return process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : GEMINI_FALLBACK_MODELS.slice();
}

function geminiRequest(model, apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: GEMINI_HOST,
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 120_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(120_000, () => req.destroy(new Error('Gemini request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractGeminiError(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error ? parsed.error.message : body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

async function geminiChatOnce(contents) {
  const models = keyPool.sticky
    ? [keyPool.sticky.model, ...geminiModels().filter((m) => m !== keyPool.sticky.model)]
    : geminiModels();
  const keys = availableGeminiKeys();

  if (keys.length === 0) {
    throw new Error('sab API keys thaki hui hain (rate limit) — 1 min ruk ke try karo, ya apni key do: export GEMINI_API_KEY="..."');
  }

  let lastError = 'no key/model attempted';
  for (const key of keys) {
    for (const model of models) {
      const res = await geminiRequest(model, key, { contents });
      if (res.status === 200) {
        let parsed;
        try {
          parsed = JSON.parse(res.body);
        } catch {
          lastError = 'invalid JSON response from Gemini';
          continue;
        }
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        const text = parts.map((p) => p.text || '').join('').trim();
        if (!text) {
          lastError = 'empty response (model may have blocked the prompt)';
          continue;
        }
        keyPool.sticky = { key, model };
        return { text, model, key };
      }
      if (res.status === 401 || res.status === 403) {
        lastError = `${maskKey(key)}: key invalid/expired — switching`;
        markKeyInvalid(key);
        break; // next key
      }
      if (res.status === 429) {
        lastError = `${maskKey(key)}: quota/rate limit — switching`;
        markKeyRateLimited(key);
        break; // next key
      }
      if (res.status === 404 || res.status === 400) {
        lastError = `${model}: ${extractGeminiError(res.body)}`;
        continue; // next model
      }
      throw new Error(`Gemini HTTP ${res.status}: ${extractGeminiError(res.body)}`);
    }
  }
  throw new Error(lastError);
}

async function geminiMain(promptArgs) {
  const keys = geminiApiKeys();
  const envKeys = keys.length - BUNDLED_GEMINI_KEYS.length;

  // One-shot mode: toxic gemini "question"
  if (promptArgs.length > 0) {
    const prompt = promptArgs.join(' ');
    try {
      const { text, model, key } = await geminiChatOnce([
        { role: 'user', parts: [{ text: prompt }] },
      ]);
      console.log(text);
      console.error(`\n[toxic] ${model} · key ${maskKey(key)}`);
    } catch (e) {
      console.error(`[toxic] ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // Interactive chat mode
  console.log('TOXIC — ZYROX AGENT core · Gemini chat');
  console.log(`Keys: ${keys.length} (${envKeys} env + ${BUNDLED_GEMINI_KEYS.length} bundled) · auto-switch ON`);
  console.log(`Model: ${geminiModels().join(' → ')}`);
  console.log('Type your message. "exit" or Ctrl+C to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const contents = [];
  let activeModel = null;

  const ask = () => new Promise((resolve) => rl.question('you> ', resolve));

  try {
    for (;;) {
      const line = await ask();
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'exit' || trimmed === 'quit') break;

      contents.push({ role: 'user', parts: [{ text: trimmed }] });
      process.stdout.write('gemini> ');
      try {
        const { text, model } = await geminiChatOnce(contents);
        activeModel = model;
        contents.push({ role: 'model', parts: [{ text }] });
        console.log(text + '\n');
      } catch (e) {
        contents.pop(); // do not keep turns that failed
        console.error(`\n[toxic] ${e.message}\n`);
      }
    }
  } finally {
    if (activeModel) console.error(`[toxic] session model: ${activeModel}`);
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// endregion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// region: launcher (forward everything else to the local runtime)
// ---------------------------------------------------------------------------

const ZYROX_COMMANDS = new Set([
  'install', 'update', 'uninstall', 'status', 'gemini', 'help', '--help', '-h',
]);

function forwardToRuntime(args) {
  if (!isInstalled()) {
    log('Runtime not installed. Run: toxic install');
    process.exitCode = 1;
    return;
  }
  try {
    execFileSync(OLLAMA_BIN, args, { stdio: 'inherit' });
  } catch (e) {
    process.exitCode = typeof e.status === 'number' ? e.status : 1;
  }
}

async function main(argv) {
  if (argv.length === 0) {
    // toxic (no args): smart start — jo kaam karta hai wahi khulega.
    if (!isTermux()) {
      console.log('[toxic] TOXIC runs on Termux (Android). Run: toxic install');
      return;
    }
    if (!isInstalled()) {
      await installRuntime();
      return;
    }
    // Menu ka default cloud model retired/paid hai (410/403) — isliye
    // bare toxic HAMESHA working Gemini chat se shuru hota hai.
    const models = localModelCount();
    console.log('');
    log(`TOXIC v${ZYROX_VERSION} · local models: ${models}`);
    log('agents/menu: toxic menu · local chat: toxic run <model>');
    log('Gemini chat shuru — free, 6 keys bundled ("exit" se bahar)\n');
    await geminiMain([]);
    return;
  }

  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'install':
      await installRuntime();
      return;
    case 'update':
      log('Updating TOXIC runtime...');
      await installRuntime();
      return;
    case 'uninstall':
      uninstallRuntime();
      return;
    case 'menu':
      // Original interactive menu (local models + agents).
      log('note: menu ka default cloud model paid/retired hai (403/410).');
      log('wahan local model chuno, ya agents ke liye use karo. Bahar: Ctrl+C');
      forwardToRuntime([]);
      return;
    case 'chat':
    case 'gemini':
      await geminiMain(rest);
      return;
    case 'status':
      statusRuntime();
      return;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP_TEXT);
      return;
    case '-v':
    case '--version':
      console.log(`toxic v${ZYROX_VERSION} (ZYROX AGENT core)`);
      return;
    default:
      forwardToRuntime(argv);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('[toxic] failed:', e.message);
    process.exit(1);
  });
}

module.exports = {
  activateStagedInstall,
  normalizedArchiveEntry,
  parseChecksum,
  validateArchiveListing,
  validateArchiveTypes,
  validateExtractedTree,
  geminiModels,
  geminiApiKeys,
  maskKey,
};
