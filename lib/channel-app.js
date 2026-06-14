const http = require('http');
const fs = require('fs');
const path = require('path');
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

const messageLogs = [];

function logSentMessage(entry) {
  const existing = messageLogs.find(l => l.communicationId === entry.communicationId);
  if (existing) {
    existing.status = entry.status;
    existing.timestamp = entry.timestamp;
    return;
  }
  messageLogs.unshift(entry);
  if (messageLogs.length > 50) {
    messageLogs.pop();
  }
}

function updateLogStatus(communicationId, status) {
  const log = messageLogs.find(l => l.communicationId === communicationId);
  if (log) {
    log.status = status;
    log.timestamp = new Date().toISOString();
    log.events.push({ type: status, timestamp: log.timestamp, source: 'simulation' });
  }
}

function createChannelApp(options = {}) {
  const forceSimulation = options.forceSimulation === true;

  async function route(req, res, pathname) {
    try {
      // Serve the beautiful Developer Console dashboard
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const filePath = path.join(__dirname, 'channel-console.html');
        fs.readFile(filePath, 'utf8', (err, html) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading channel stub console');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'channel-stub',
          whatsappConfigured: whatsapp.isConfigured(),
          whatsappProvider: whatsapp.PROVIDER
        });
      }

      // API endpoint to retrieve log entries
      if (req.method === 'GET' && pathname === '/api/logs') {
        return sendJson(res, 200, { logs: messageLogs });
      }

      // API endpoint to manually trigger receipt callbacks
      if (req.method === 'POST' && pathname === '/api/simulate-callback') {
        const payload = await readBody(req);
        const { communicationId, type } = payload;

        const log = messageLogs.find(l => l.communicationId === communicationId);
        if (!log) {
          return sendJson(res, 404, { error: 'Communication log not found' });
        }

        const receipt = {
          id: uid('evt'),
          campaignId: log.campaignId,
          communicationId: log.communicationId,
          customerId: log.customerId,
          channel: log.channel,
          type: type,
          timestamp: new Date().toISOString(),
          meta: { manualOverride: true }
        };

        if (type === 'attributed_order') {
          receipt.meta.amount = Math.round((1800 + Math.random() * 7400) / 100) * 100;
          receipt.meta.product = log.customerName ? `${log.customerName.split(' ')[0]}'s campaign purchase` : 'Campaign purchase';
        }

        updateLogStatus(communicationId, type);
        await postWithRetry(log.callbackUrl, receipt);

        return sendJson(res, 200, { success: true, receipt });
      }

      if (req.method === 'POST' && pathname === '/send') {
        const payload = await readBody(req);
        const campaign = payload.campaign;
        const communications = payload.communications || [];
        const callbackUrl = payload.callbackUrl;
        const payloadForceSimulation = payload.forceSimulation === true;

        // If WhatsApp is configured AND campaign channel is whatsapp, send real messages
        if (!payloadForceSimulation && !forceSimulation && whatsapp.isConfigured() && campaign.channel === 'whatsapp') {
          console.log(`[channel] Sending ${communications.length} real WhatsApp messages via ${whatsapp.PROVIDER}`);

          const results = [];
          for (const comm of communications) {
            const phone = comm.customer?.phone;
            const message = comm.message || '';
            if (!phone) {
              results.push({ communicationId: comm.id, success: false, error: 'No phone number' });
              logSentMessage({
                communicationId: comm.id,
                campaignId: campaign.id,
                campaignName: campaign.name,
                customerId: comm.customer?.id,
                customerName: comm.customer?.name,
                channel: campaign.channel,
                message,
                status: 'failed',
                timestamp: new Date().toISOString(),
                callbackUrl,
                recipientPhone: '',
                events: [{ type: 'failed', timestamp: new Date().toISOString(), source: 'system' }]
              });
              continue;
            }

            const result = await whatsapp.sendMessage(phone, message, {
              customer: comm.customer,
              campaign
            });
            console.log(`[channel] Send result for ${phone}:`, result);
            results.push({ communicationId: comm.id, ...result });

            logSentMessage({
              communicationId: comm.id,
              campaignId: campaign.id,
              campaignName: campaign.name,
              customerId: comm.customer.id,
              customerName: comm.customer.name,
              channel: campaign.channel,
              message,
              status: result.success ? 'sent' : 'failed',
              timestamp: new Date().toISOString(),
              callbackUrl,
              externalId: result.messageId || '',
              recipientPhone: phone,
              templateName: result.templateName || '',
              events: [{ type: result.success ? 'sent' : 'failed', timestamp: new Date().toISOString(), source: 'system' }]
            });

            if (result.success) {
              // For real WhatsApp sends, "sent" only means Meta accepted the API request.
              // We wait for an actual webhook callback before marking the message delivered.
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
              setTimeout(() => {
                updateLogStatus(comm.id, 'failed');
                postWithRetry(callbackUrl, failedReceipt);
              }, 500);
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
          onReceipt: (receipt) => {
            updateLogStatus(receipt.communicationId, receipt.type);
            postWithRetry(callbackUrl, receipt);
          },
          renderMessage: (customer) => customer?.name ? `${customer.name.split(' ')[0]}'s campaign purchase` : 'Campaign purchase'
        });
        
        console.log(`[channel] Simulation mode: Sending ${communications.length} simulated messages (forceSimulation=${payloadForceSimulation})`);

        // Log all scheduled simulated communication attempts
        for (const comm of communications) {
          logSentMessage({
            communicationId: comm.id,
            campaignId: campaign.id,
            campaignName: campaign.name,
            customerId: comm.customer?.id,
            customerName: comm.customer?.name,
            channel: campaign.channel,
            message: comm.message || '',
            status: 'sent',
            timestamp: new Date().toISOString(),
            callbackUrl,
            recipientPhone: comm.customer?.phone || '',
            events: [{ type: 'sent', timestamp: new Date().toISOString(), source: 'simulation' }]
          });
        }

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
          // Look up matching sent message log by externalId or recipientPhone
          const normalizedPhone = whatsapp.normalizePhone(parsed.recipientPhone);
          const existingLog = messageLogs.find(l => 
            (parsed.externalId && l.externalId === parsed.externalId) || 
            (parsed.recipientPhone && whatsapp.normalizePhone(l.recipientPhone) === normalizedPhone)
          );

          if (existingLog) {
            existingLog.status = parsed.type;
            existingLog.timestamp = new Date().toISOString();
            existingLog.events.push({ type: parsed.type, timestamp: existingLog.timestamp, source: 'webhook' });
          } else {
            // Log as a generic webhook receipt
            logSentMessage({
              communicationId: parsed.externalId || uid('webhook'),
              campaignId: 'webhook',
              campaignName: 'WhatsApp Webhook',
              customerId: 'unknown',
              customerName: parsed.recipientPhone || 'Unknown Phone',
              channel: 'whatsapp',
              message: `Webhook Status Update: ${parsed.type}`,
              status: parsed.type,
              timestamp: new Date().toISOString(),
              callbackUrl: crmCallbackUrl,
              externalId: parsed.externalId || '',
              recipientPhone: parsed.recipientPhone || '',
              events: [{ type: parsed.type, timestamp: new Date().toISOString(), source: 'webhook' }]
            });
          }

          const receipt = {
            id: uid('evt'),
            type: parsed.type,
            timestamp: parsed.timestamp || new Date().toISOString(),
            meta: {
              externalId: parsed.externalId,
              provider: whatsapp.PROVIDER,
              real: true,
              errors: parsed.errors
            }
          };

          // If we matched a log, provide CRM credentials to link it
          if (existingLog) {
            receipt.communicationId = existingLog.communicationId;
            receipt.campaignId = existingLog.campaignId;
            receipt.customerId = existingLog.customerId;
            receipt.channel = existingLog.channel;
          }

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
