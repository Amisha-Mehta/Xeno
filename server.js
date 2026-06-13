// Load .env file if present
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key) process.env[key] = val;
  }
  console.log('[env] Loaded .env file');
}

const { createCrmApp } = require('./lib/crm-app');
const { createChannelApp } = require('./lib/channel-app');

const PORT = process.env.PORT || 3000;
const CHANNEL_PORT = process.env.CHANNEL_PORT || 3001;

const channel = createChannelApp();
const crm = createCrmApp({
  crmUrl: process.env.CRM_URL || `http://localhost:${PORT}`,
  channelUrl: process.env.CHANNEL_URL || `http://localhost:${CHANNEL_PORT}`
});

channel.server.listen(CHANNEL_PORT, () => {
  console.log(`Xeno Channel Stub running at http://localhost:${CHANNEL_PORT}`);
});

crm.server.listen(PORT, () => {
  console.log(`Xeno Mini CRM running at http://localhost:${PORT}`);
});
