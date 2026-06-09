const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  uid,
  createSeedState,
  getAudienceMembers,
  getSegmentById,
  getCampaignById,
  computeDashboard,
  computeCampaignMetrics,
  createCampaignFromAudience,
  getOrderMetrics,
  CHANNELS
} = require('./lib/store');
const { draftCampaignFromPrompt } = require('./lib/ai');
const { sendCampaign } = require('./lib/channel');

const PORT = process.env.PORT || 3000;
const CHANNEL_PORT = process.env.CHANNEL_PORT || 3001;
const CRM_URL = process.env.CRM_URL || `http://localhost:${PORT}`;
const CHANNEL_URL = process.env.CHANNEL_URL || `http://localhost:${CHANNEL_PORT}`;
const state = createSeedState();

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

function publicFilePath(urlPath) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.join(__dirname, 'public', safePath);
  if (!resolved.startsWith(path.join(__dirname, 'public'))) {
    return null;
  }
  return resolved;
}

function serveStatic(req, res) {
  const filePath = publicFilePath(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

function renderMessage(template, customer) {
  const metrics = getOrderMetrics(state, customer.id);
  return template
    .replaceAll('{{first_name}}', customer.name.split(' ')[0])
    .replaceAll('{{city}}', customer.city)
    .replaceAll('{{last_product}}', metrics.lastOrder?.product || 'your last pick')
    .replaceAll('{{loyalty_tier}}', customer.attributes.loyaltyTier);
}

function applyReceipt(receipt) {
  if (!receipt.id || state.seenReceiptIds.has(receipt.id)) {
    return { duplicate: true };
  }
  state.seenReceiptIds.add(receipt.id);
  state.receipts.push(receipt);

  const communication = state.communications.find((item) => item.id === receipt.communicationId);
  const campaign = getCampaignById(state, receipt.campaignId);
  if (!communication || !campaign) {
    return { accepted: false, reason: 'Unknown communication or campaign' };
  }

  const rank = { queued: 0, sent: 1, failed: 2, delivered: 3, opened: 4, read: 5, clicked: 6 };
  if (receipt.type === 'attributed_order') {
    state.orders.push({
      id: uid('ord'),
      customerId: receipt.customerId,
      amount: receipt.meta?.amount || 2400,
      channel: campaign.channel,
      status: 'paid',
      product: receipt.meta?.product || 'Campaign purchase',
      category: 'campaign',
      createdAt: receipt.timestamp || new Date().toISOString(),
      sourceCampaignId: campaign.id
    });
  } else if (rank[receipt.type] >= rank[communication.status]) {
    communication.status = receipt.type;
    communication.deliveryState = receipt.type;
  }

  communication.events.push({
    type: receipt.type,
    timestamp: receipt.timestamp || new Date().toISOString(),
    meta: receipt.meta || {}
  });
  communication.updatedAt = new Date().toISOString();

  campaign.metrics = computeCampaignMetrics(state, campaign);
  const done = campaign.metrics.delivered + campaign.metrics.failed >= campaign.metrics.sent;
  if (campaign.status === 'sending' && done) {
    campaign.status = 'completed';
    campaign.completedAt = new Date().toISOString();
  }
  return { accepted: true };
}

function getSegments() {
  return state.segments.map((segment) => ({
    ...segment,
    estimatedCount: getAudienceMembers(state, segment).length
  }));
}

function getCustomers() {
  return state.customers.map((customer) => ({
    ...customer,
    metrics: getOrderMetrics(state, customer.id)
  }));
}

async function routeApi(req, res, pathname) {
  try {
    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, {
        dashboard: computeDashboard(state),
        customers: getCustomers(),
        segments: getSegments(),
        campaigns: state.campaigns
          .slice()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((campaign) => ({ ...campaign, metrics: computeCampaignMetrics(state, campaign) })),
        communications: state.communications.slice(-80).reverse(),
        receipts: state.receipts.slice(-100).reverse(),
        channels: CHANNELS
      });
    }

    if (req.method === 'POST' && pathname === '/api/customers') {
      const payload = await readBody(req);
      const customer = {
        id: uid('cus'),
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        city: payload.city || 'Unknown',
        preferredChannel: payload.preferredChannel || 'whatsapp',
        optedIn: payload.optedIn !== false,
        lifecycle: payload.lifecycle || 'new',
        segmentTags: payload.segmentTags || ['Imported'],
        createdAt: new Date().toISOString(),
        attributes: payload.attributes || { loyaltyTier: 'bronze', region: 'unknown', gender: 'unknown' }
      };
      state.customers.push(customer);
      return sendJson(res, 201, { customer });
    }

    if (req.method === 'POST' && pathname === '/api/orders') {
      const payload = await readBody(req);
      const order = {
        id: uid('ord'),
        customerId: payload.customerId,
        amount: Number(payload.amount || 0),
        channel: payload.channel || 'web',
        status: payload.status || 'paid',
        product: payload.product || 'Imported product',
        category: payload.category || 'general',
        createdAt: payload.createdAt || new Date().toISOString(),
        sourceCampaignId: payload.sourceCampaignId || null
      };
      state.orders.push(order);
      return sendJson(res, 201, { order });
    }

    if (req.method === 'POST' && pathname === '/api/ai/draft') {
      const payload = await readBody(req);
      const draft = draftCampaignFromPrompt(state, payload.prompt || '');
      return sendJson(res, 200, draft);
    }

    if (req.method === 'POST' && pathname === '/api/segments') {
      const payload = await readBody(req);
      const segment = {
        id: uid('seg'),
        name: payload.name,
        description: payload.description || '',
        type: payload.type || 'manual',
        rules: payload.rules || { kind: 'recent_buyer', maxDaysSinceOrder: 30, optInOnly: true },
        createdAt: new Date().toISOString()
      };
      segment.estimatedCount = getAudienceMembers(state, segment).length;
      state.segments.push(segment);
      return sendJson(res, 201, { segment });
    }

    if (req.method === 'POST' && pathname === '/api/campaigns') {
      const payload = await readBody(req);
      const { campaign } = createCampaignFromAudience(state, payload);
      state.campaigns.push(campaign);
      return sendJson(res, 201, { campaign });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/campaigns\/[^/]+\/send$/)) {
      const campaignId = pathname.split('/')[3];
      const campaign = getCampaignById(state, campaignId);
      if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
      const segment = getSegmentById(state, campaign.segmentId);
      const audience = segment ? getAudienceMembers(state, segment) : [];
      if (!audience.length) return sendJson(res, 400, { error: 'Audience is empty' });

      const communications = audience.map((customer) => {
        const communication = {
          id: uid('com'),
          campaignId: campaign.id,
          customerId: customer.id,
          channel: campaign.channel,
          message: renderMessage(campaign.message, customer),
          status: 'sent',
          deliveryState: 'sent',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          events: [{ type: 'sent', timestamp: new Date().toISOString() }]
        };
        state.communications.push(communication);
        return { ...communication, customer };
      });

      campaign.status = 'sending';
      campaign.sentAt = new Date().toISOString();
      campaign.audienceSize = communications.length;
      campaign.metrics = computeCampaignMetrics(state, campaign);

      await fetch(`${CHANNEL_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign,
          communications,
          callbackUrl: `${CRM_URL}/api/receipts`
        })
      });

      return sendJson(res, 202, { campaign, communications: communications.length });
    }

    if (req.method === 'POST' && pathname === '/api/receipts') {
      const receipt = await readBody(req);
      return sendJson(res, 202, applyReceipt(receipt));
    }

    return sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function routeChannel(req, res, pathname) {
  try {
    if (req.method === 'POST' && pathname === '/send') {
      const payload = await readBody(req);
      const receipts = sendCampaign({
        campaign: payload.campaign,
        communications: payload.communications || [],
        onReceipt: async (receipt) => {
          await fetch(payload.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(receipt)
          }).catch(() => {});
        },
        renderMessage: (customer) => customer?.name ? `${customer.name.split(' ')[0]}'s campaign purchase` : 'Campaign purchase'
      });
      return sendJson(res, 202, { accepted: true, plannedReceipts: receipts.length });
    }

    return sendJson(res, 404, { error: 'Channel route not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

const crmServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    routeApi(req, res, url.pathname);
    return;
  }
  serveStatic(req, res);
});

const channelServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  routeChannel(req, res, url.pathname);
});

channelServer.listen(CHANNEL_PORT, () => {
  console.log(`Xeno Channel Stub running at http://localhost:${CHANNEL_PORT}`);
});

crmServer.listen(PORT, () => {
  console.log(`Xeno Mini CRM running at http://localhost:${PORT}`);
});
