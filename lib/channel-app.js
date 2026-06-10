const http = require('http');
const { sendCampaign } = require('./channel');
const whatsapp = require('./whatsapp');
const { uid } = require('./store');

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
        return sendJson(res, 200, {
          ok: true,
          service: 'channel-stub',
          whatsappConfigured: whatsapp.isConfigured(),
          whatsappProvider: whatsapp.PROVIDER
        });
      }

      if (req.method === 'POST' && pathname === '/send') {
        const payload = await readBody(req);
        const campaign = payload.campaign;
        const communications = payload.communications || [];
        const callbackUrl = payload.callbackUrl;

        // If WhatsApp is configured AND campaign channel is whatsapp, send real messages
        if (whatsapp.isConfigured() && campaign.channel === 'whatsapp') {
          console.log(`[channel] Sending ${communications.length} real WhatsApp messages via ${whatsapp.PROVIDER}`);

          const results = [];
          for (const comm of communications) {
            const phone = comm.customer?.phone;
            const message = comm.message || '';
            if (!phone) {
              results.push({ communicationId: comm.id, success: false, error: 'No phone number' });
              continue;
            }

            const result = await whatsapp.sendMessage(phone, message);
            results.push({ communicationId: comm.id, ...result });

            // If real send succeeded, still schedule simulated lifecycle events
            // (opened, read, clicked) since WhatsApp webhooks may not arrive in demo
            if (result.success) {
              const baseDelay = 1000 + results.length * 200;

              // Send a delivered receipt immediately
              const deliveredReceipt = {
                id: uid('evt'),
                campaignId: campaign.id,
                communicationId: comm.id,
                customerId: comm.customer.id,
                channel: campaign.channel,
                type: 'delivered',
                timestamp: new Date().toISOString(),
                meta: { provider: result.provider, messageId: result.messageId, real: true }
              };
              setTimeout(() => postWithRetry(callbackUrl, deliveredReceipt), baseDelay);
            } else {
              // Send a failed receipt
              const failedReceipt = {
                id: uid('evt'),
                campaignId: campaign.id,
                communicationId: comm.id,
                customerId: comm.customer.id,
                channel: campaign.channel,
                type: 'failed',
                timestamp: new Date().toISOString(),
                meta: { provider: result.provider, error: result.error, real: true }
              };
              setTimeout(() => postWithRetry(callbackUrl, failedReceipt), 500);
            }
          }

          return sendJson(res, 202, {
            accepted: true,
            mode: 'real_whatsapp',
            provider: whatsapp.PROVIDER,
            results
          });
        }

        // Fallback: use simulated channel for non-whatsapp or unconfigured
        const receipts = sendCampaign({
          campaign,
          communications,
          onReceipt: (receipt) => postWithRetry(callbackUrl, receipt),
          renderMessage: (customer) => customer?.name ? `${customer.name.split(' ')[0]}'s campaign purchase` : 'Campaign purchase'
        });
        return sendJson(res, 202, { accepted: true, mode: 'simulated', plannedReceipts: receipts.length });
      }

      // WhatsApp webhook endpoint for Meta Cloud API
      if (req.method === 'GET' && pathname === '/webhooks/whatsapp') {
        // Meta webhook verification challenge
        const url = new URL(req.url, `http://${req.headers.host}`);
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'xeno_verify';

        if (mode === 'subscribe' && token === verifyToken) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(challenge);
          return;
        }
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (req.method === 'POST' && pathname === '/webhooks/whatsapp') {
        const body = await readBody(req);
        let parsedReceipts = [];

        if (whatsapp.PROVIDER === 'twilio') {
          parsedReceipts = whatsapp.parseTwilioWebhook(body);
        } else {
          parsedReceipts = whatsapp.parseMetaWebhook(body);
        }

        // Forward parsed receipts to CRM callback URL
        const crmCallbackUrl = process.env.CRM_URL
          ? `${process.env.CRM_URL}/api/receipts`
          : 'http://localhost:3000/api/receipts';

        for (const parsed of parsedReceipts) {
          // We need to map external receipts to CRM communication IDs
          // For real webhooks, we forward the receipt type to the CRM
          const receipt = {
            id: uid('evt'),
            type: parsed.type,
            timestamp: parsed.timestamp,
            meta: {
              externalId: parsed.externalId,
              provider: whatsapp.PROVIDER,
              real: true,
              errors: parsed.errors
            }
          };
          postWithRetry(crmCallbackUrl, receipt);
        }

        return sendJson(res, 200, { ok: true, processed: parsedReceipts.length });
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
