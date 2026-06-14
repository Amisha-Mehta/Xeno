const fs = require('fs');
const path = require('path');

let loaded = false;

function loadEnv() {
  if (loaded) return;

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    loaded = true;
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }

  loaded = true;
}

module.exports = { loadEnv };
