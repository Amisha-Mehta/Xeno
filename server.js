const { loadEnv } = require('./lib/load-env');

loadEnv();
console.log('[env] Loaded .env file');

const { createCrmApp } = require('./lib/crm-app');
const { createChannelApp } = require('./lib/channel-app');

const PORT = process.env.PORT || 3000;
const CHANNEL_PORT = process.env.CHANNEL_PORT || 3001;

const channel = createChannelApp();
const crm = createCrmApp({
  crmUrl: process.env.CRM_URL || `http://localhost:${PORT}`,
  channelApp: channel
});

channel.server.listen(CHANNEL_PORT, () => {
  console.log(`Xeno Channel Stub running at http://localhost:${CHANNEL_PORT}`);
});

crm.server.listen(PORT, () => {
  console.log(`Xeno Mini CRM running at http://localhost:${PORT}`);
});
