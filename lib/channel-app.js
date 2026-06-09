const http = require('http');
const { sendCampaign } = require('./channel');

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function postWithRetry(url, receipt, attempt = 1) {
  try {
    if (Math.random() < 0.1 && attempt === 1) {
      throw new Error('simulated callback network miss');
    }
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...receipt, meta: { ...(receipt.meta || {}), callbackAttempt: attempt } })
    });
  } catch (error) {
    if (attempt < 3) {
      setTimeout(() => postWithRetry(url, receipt, attempt + 1), 700 * attempt);
    }
  }
}

function createChannelApp() {
  async function route(req, res, pathname) {
    try {
      if (req.method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'channel-stub' });
      }

      if (req.method === 'POST' && pathname === '/send') {
        const payload = await readBody(req);
        const receipts = sendCampaign({
          campaign: payload.campaign,
          communications: payload.communications || [],
          onReceipt: (receipt) => postWithRetry(payload.callbackUrl, receipt),
          renderMessage: (customer) => customer?.name ? `${customer.name.split(' ')[0]}'s campaign purchase` : 'Campaign purchase'
        });
        return sendJson(res, 202, { accepted: true, plannedReceipts: receipts.length });
      }

      return sendJson(res, 404, { error: 'Channel route not found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    route(req, res, url.pathname);
  });

  return { server };
}

module.exports = { createChannelApp };
