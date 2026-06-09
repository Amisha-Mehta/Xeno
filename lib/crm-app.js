const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  uid,
  getAudienceMembers,
  getSegmentById,
  getCampaignById,
  computeDashboard,
  computeCampaignMetrics,
  createCampaignFromAudience,
  getOrderMetrics,
  CHANNELS
} = require('./store');
const { draftCampaignFromPrompt, aiChat } = require('./ai');
const { loadState, saveState, resetState } = require('./persistence');

function createCrmApp(options = {}) {
  const state = options.state || loadState();
  const channelUrl = options.channelUrl || process.env.CHANNEL_URL || 'http://localhost:3001';
  const crmUrl = options.crmUrl || process.env.CRM_URL || 'http://localhost:3000';
  const scheduleTimers = new Map();

  function persist() {
    if (options.persist !== false) {
      saveState(state);
    }
  }

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
    const publicRoot = path.join(__dirname, '..', 'public');
    const resolved = path.join(publicRoot, safePath);
    if (!resolved.startsWith(publicRoot)) return null;
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
      persist();
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
    const terminal = campaign.metrics.delivered + campaign.metrics.failed >= campaign.metrics.sent;
    if (campaign.status === 'sending' && terminal) {
      campaign.status = 'completed';
      campaign.completedAt = new Date().toISOString();
    }
    persist();
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

  async function sendCampaignToChannel(campaign) {
    const segment = getSegmentById(state, campaign.segmentId);
    const audience = segment ? getAudienceMembers(state, segment) : [];
    if (!audience.length) {
      campaign.status = 'audience_empty';
      campaign.scheduledFor = null;
      persist();
      return { statusCode: 400, payload: { error: 'Audience is empty' } };
    }

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
    campaign.scheduledFor = null;
    campaign.audienceSize = communications.length;
    campaign.metrics = computeCampaignMetrics(state, campaign);
    persist();

    const channelResponse = await fetch(`${channelUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, communications, callbackUrl: `${crmUrl}/api/receipts` })
    });

    if (!channelResponse.ok) {
      campaign.status = 'channel_error';
      persist();
      return { statusCode: 502, payload: { error: 'Channel service unavailable' } };
    }

    return { statusCode: 202, payload: { campaign, communications: communications.length } };
  }

  function scheduleCampaign(campaign, scheduledFor) {
    if (scheduleTimers.has(campaign.id)) {
      clearTimeout(scheduleTimers.get(campaign.id));
    }

    const runAt = new Date(scheduledFor).getTime();
    const delayMs = Math.max(0, runAt - Date.now());
    campaign.status = delayMs === 0 ? 'sending' : 'scheduled';
    campaign.scheduledFor = new Date(runAt).toISOString();
    persist();

    const timer = setTimeout(async () => {
      scheduleTimers.delete(campaign.id);
      await sendCampaignToChannel(campaign);
    }, delayMs);
    scheduleTimers.set(campaign.id, timer);
  }

  function hydrateScheduledCampaigns() {
    state.campaigns
      .filter((campaign) => campaign.status === 'scheduled' && campaign.scheduledFor)
      .forEach((campaign) => scheduleCampaign(campaign, campaign.scheduledFor));
  }

  async function routeApi(req, res, pathname) {
    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, service: 'crm', channelUrl, persisted: options.persist !== false });
      }

      if (req.method === 'POST' && pathname === '/api/admin/reset') {
        const fresh = resetState();
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, fresh);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        return sendJson(res, 200, {
          dashboard: computeDashboard(state),
          customers: getCustomers(),
          segments: getSegments(),
          campaigns: state.campaigns.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((campaign) => ({ ...campaign, metrics: computeCampaignMetrics(state, campaign) })),
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
        persist();
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
        persist();
        return sendJson(res, 201, { order });
      }

      if (req.method === 'POST' && pathname === '/api/ai/draft') {
        const payload = await readBody(req);
        const draft = await draftCampaignFromPrompt(state, payload.prompt || '');
        return sendJson(res, 200, draft);
      }

      if (req.method === 'POST' && pathname === '/api/ai/chat') {
        const payload = await readBody(req);
        const chatResult = await aiChat(state, payload.message || '');
        return sendJson(res, 200, chatResult);
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
        persist();
        return sendJson(res, 201, { segment });
      }

      if (req.method === 'POST' && pathname === '/api/campaigns') {
        const payload = await readBody(req);
        const { campaign } = createCampaignFromAudience(state, payload);
        state.campaigns.push(campaign);
        persist();
        return sendJson(res, 201, { campaign });
      }

      if (req.method === 'POST' && pathname.match(/^\/api\/campaigns\/[^/]+\/send$/)) {
        const campaignId = pathname.split('/')[3];
        const campaign = getCampaignById(state, campaignId);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
        if (scheduleTimers.has(campaign.id)) {
          clearTimeout(scheduleTimers.get(campaign.id));
          scheduleTimers.delete(campaign.id);
        }
        const result = await sendCampaignToChannel(campaign);
        return sendJson(res, result.statusCode, result.payload);
      }

      if (req.method === 'POST' && pathname.match(/^\/api\/campaigns\/[^/]+\/schedule$/)) {
        const campaignId = pathname.split('/')[3];
        const campaign = getCampaignById(state, campaignId);
        if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });
        const payload = await readBody(req);
        const scheduledFor = payload.scheduledFor || new Date(Date.now() + Number(payload.delayMs || 30000)).toISOString();
        scheduleCampaign(campaign, scheduledFor);
        return sendJson(res, 202, { campaign, scheduledFor: campaign.scheduledFor });
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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      routeApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res);
  });

  hydrateScheduledCampaigns();

  return { server, state, applyReceipt, scheduleTimers };
}

module.exports = { createCrmApp };
