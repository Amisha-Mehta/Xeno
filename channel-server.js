const { loadEnv } = require('./lib/load-env');
const { createChannelApp } = require('./lib/channel-app');

loadEnv();

const CHANNEL_PORT = process.env.CHANNEL_PORT || 3001;
const app = createChannelApp();

app.server.listen(CHANNEL_PORT, () => {
  console.log(`Xeno Channel Stub running at http://localhost:${CHANNEL_PORT}`);
});
