const { loadEnv } = require('./lib/load-env');
const { createCrmApp } = require('./lib/crm-app');

loadEnv();

const PORT = process.env.PORT || 3000;
const app = createCrmApp();

app.server.listen(PORT, () => {
  console.log(`Xeno CRM running at http://localhost:${PORT}`);
});
