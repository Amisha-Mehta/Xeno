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
  getCustomerOrders,
  CHANNELS
} = require('./store');
const { draftCampaignFromPrompt, aiChat, hasAiConfig } = require('./ai');
const { loadState, saveState, resetState } = require('./persistence');
const whatsapp = require('./whatsapp');
const email = require('./email');
const {
  createSession,
  destroySession,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  validateAdmin,
  findCustomerByCredentials,
  requireAdmin,
  requireCustomer
} = require('./auth');

function createCrmApp(options = {}) {
  const state = options.state || loadState();
  const crmUrl = options.crmUrl || process.env.CRM_URL || 'http://localhost:3000';
  const channelUrl = options.channelApp ? `${crmUrl}/channel-stub` : (options.channelUrl || process.env.CHANNEL_URL || 'http://localhost:3001');
  const channelApp = options.channelApp;
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

  // Files that do not require authentication
  const PUBLIC_FILES = new Set([
    '/login.html', '/login.js',
    '/customer-login.html', '/customer-login.js',
    '/customer-portal.html', '/customer-portal.js',
    '/styles.css'
  ]);

  function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Auth-gated routing for the main dashboard
    if (pathname === '/' || pathname === '/index.html') {
      const session = getSessionFromRequest(req);
      if (!session || session.role !== 'admin') {
        res.writeHead(302, { Location: '/login.html' });
        res.end();
        return;
      }
    }

    // Customer portal auth gate
    if (pathname === '/customer-portal.html') {
      const session = getSessionFromRequest(req);
      if (!session || session.role !== 'customer') {
        res.writeHead(302, { Location: '/customer-login.html' });
        res.end();
        return;
      }
    }

    // Serve app.js only to admin sessions
    if (pathname === '/app.js') {
      const session = getSessionFromRequest(req);
      if (!session || session.role !== 'admin') {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
    }

    const filePath = publicFilePath(pathname);
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
    const audience = Array.isArray(campaign.recipientIds)
      ? state.customers.filter((customer) => campaign.recipientIds.includes(customer.id))
      : segment
        ? getAudienceMembers(state, segment)
        : [];
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

  function scheduleCampaignTimer(campaign, scheduledFor) {
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
      .forEach((campaign) => scheduleCampaignTimer(campaign, campaign.scheduledFor));
  }

  // -----------------------------------------------------------------------
  // Auth API routes
  // -----------------------------------------------------------------------

  async function routeAuth(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/auth/admin/login') {
      const payload = await readBody(req);
      if (validateAdmin(payload.email, payload.password)) {
        const token = createSession('admin', 'admin');
        setSessionCookie(res, token);
        return sendJson(res, 200, { ok: true, role: 'admin' });
      }
      return sendJson(res, 401, { error: 'Invalid admin credentials' });
    }

    if (req.method === 'POST' && pathname === '/api/auth/customer/login') {
      const payload = await readBody(req);
      const customer = findCustomerByCredentials(state, payload.email, payload.phone);
      if (customer) {
        const token = createSession('customer', customer.id, { email: customer.email });
        setSessionCookie(res, token);
        return sendJson(res, 200, {
          ok: true,
          role: 'customer',
          customer: { id: customer.id, name: customer.name, email: customer.email }
        });
      }
      return sendJson(res, 401, { error: 'No matching customer found. Check your email and phone number.' });
    }

    if (req.method === 'POST' && pathname === '/api/auth/customer/register') {
      const payload = await readBody(req);
      const email = String(payload.email || '').trim().toLowerCase();
      const phone = String(payload.phone || '').trim();
      const name = String(payload.name || '').trim();
      const city = String(payload.city || '').trim() || 'Unknown';
      const address = String(payload.address || '').trim();

      if (!email || !phone || !name) {
        return sendJson(res, 400, { error: 'Name, email, and phone number are required.' });
      }

      const existing = findCustomerByCredentials(state, email, phone);
      if (existing) {
        return sendJson(res, 409, { error: 'A customer account with this email and phone already exists.' });
      }

      const customer = {
        id: uid('cus'),
        name,
        email,
        phone,
        city,
        address,
        segmentTags: ['Self Registered'],
        preferredChannel: payload.preferredChannel || 'whatsapp',
        optedIn: true,
        lifecycle: 'new',
        source: 'Self Registered',
        loyaltyPoints: 100, // welcome bonus
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        attributes: { gender: 'unknown', region: 'unknown', loyaltyTier: 'bronze' }
      };

      state.customers.push(customer);
      persist();

      const token = createSession('customer', customer.id, { email: customer.email });
      setSessionCookie(res, token);
      return sendJson(res, 200, {
        ok: true,
        role: 'customer',
        customer: { id: customer.id, name: customer.name, email: customer.email }
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const session = getSessionFromRequest(req);
      if (session) {
        const cookies = require('./auth').parseCookies(req);
        destroySession(cookies.xeno_session);
      }
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const session = getSessionFromRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Not authenticated' });
      }
      const info = { role: session.role };
      if (session.role === 'customer') {
        const customer = state.customers.find((c) => c.id === session.id);
        if (customer) {
          info.customer = { id: customer.id, name: customer.name, email: customer.email };
        }
      }
      return sendJson(res, 200, info);
    }

    return null; // not an auth route
  }

  // -----------------------------------------------------------------------
  // Customer portal API routes
  // -----------------------------------------------------------------------

  async function routeCustomerApi(req, res, pathname) {
    const session = requireCustomer(req);
    if (!session) {
      return sendJson(res, 401, { error: 'Customer authentication required' });
    }

    const customerId = session.id;
    const customer = state.customers.find((c) => c.id === customerId);
    if (!customer) {
      return sendJson(res, 404, { error: 'Customer not found' });
    }

    if (req.method === 'GET' && pathname === '/api/customer/profile') {
      const metrics = getOrderMetrics(state, customerId);
      return sendJson(res, 200, {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        city: customer.city,
        address: customer.address || '',
        preferredChannel: customer.preferredChannel,
        optedIn: customer.optedIn,
        lifecycle: customer.lifecycle,
        loyaltyTier: customer.attributes?.loyaltyTier || 'bronze',
        loyaltyPoints: customer.loyaltyPoints || 0,
        segmentTags: customer.segmentTags || [],
        source: customer.source || 'Unknown',
        createdAt: customer.createdAt,
        lastActive: customer.lastActive,
        metrics
      });
    }

    if (req.method === 'POST' && pathname === '/api/customer/profile') {
      const payload = await readBody(req);
      if (payload.name) customer.name = String(payload.name).trim();
      if (payload.phone) customer.phone = String(payload.phone).trim();
      if (payload.city) customer.city = String(payload.city).trim();
      if (payload.address !== undefined) customer.address = String(payload.address).trim();
      if (payload.preferredChannel) customer.preferredChannel = payload.preferredChannel;
      if (payload.optedIn !== undefined) customer.optedIn = !!payload.optedIn;
      customer.lastActive = new Date().toISOString();
      persist();
      return sendJson(res, 200, { ok: true, customer: { id: customer.id, name: customer.name, email: customer.email } });
    }

    if (req.method === 'GET' && pathname === '/api/customer/orders') {
      const orders = getCustomerOrders(state, customerId);
      return sendJson(res, 200, { orders });
    }

    if (req.method === 'POST' && pathname === '/api/customer/orders') {
      const payload = await readBody(req);
      const amount = Number(payload.amount || 0);
      if (amount <= 0 || !payload.product) {
        return sendJson(res, 400, { error: 'Product and positive amount required.' });
      }
      const order = {
        id: uid('ord'),
        customerId,
        amount,
        channel: 'web',
        status: 'paid',
        product: String(payload.product),
        category: String(payload.category || 'apparel'),
        createdAt: new Date().toISOString(),
        sourceCampaignId: null
      };
      state.orders.push(order);
      // Award loyalty points: 1 point per ₹10 spent
      const pointsEarned = Math.floor(amount / 10);
      customer.loyaltyPoints = (customer.loyaltyPoints || 0) + pointsEarned;
      customer.lastActive = new Date().toISOString();
      // Auto-upgrade loyalty tier
      if (customer.loyaltyPoints >= 500) customer.attributes.loyaltyTier = 'gold';
      else if (customer.loyaltyPoints >= 200) customer.attributes.loyaltyTier = 'silver';
      persist();
      return sendJson(res, 201, { order, pointsEarned, loyaltyPoints: customer.loyaltyPoints });
    }

    if (req.method === 'POST' && pathname.match(/^\/api\/customer\/orders\/[^/]+\/cancel$/)) {
      const orderId = pathname.split('/')[4];
      const order = state.orders.find((o) => o.id === orderId && o.customerId === customerId);
      if (!order) return sendJson(res, 404, { error: 'Order not found' });
      if (order.status === 'cancelled') return sendJson(res, 400, { error: 'Order already cancelled' });
      order.status = 'cancelled';
      // Deduct loyalty points that were awarded
      const pointsDeducted = Math.floor(order.amount / 10);
      customer.loyaltyPoints = Math.max(0, (customer.loyaltyPoints || 0) - pointsDeducted);
      // Downgrade tier if needed
      if (customer.loyaltyPoints < 200) customer.attributes.loyaltyTier = 'bronze';
      else if (customer.loyaltyPoints < 500) customer.attributes.loyaltyTier = 'silver';
      customer.lastActive = new Date().toISOString();
      persist();
      return sendJson(res, 200, { ok: true, order, pointsDeducted, loyaltyPoints: customer.loyaltyPoints });
    }

    if (req.method === 'GET' && pathname === '/api/customer/messages') {
      const messages = state.communications
        .filter((c) => c.customerId === customerId)
        .map((c) => ({
          id: c.id,
          campaignId: c.campaignId,
          channel: c.channel,
          message: c.message,
          status: c.status,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, { messages });
    }

    if (req.method === 'GET' && pathname === '/api/customer/loyalty') {
      const metrics = getOrderMetrics(state, customerId);
      return sendJson(res, 200, {
        points: customer.loyaltyPoints || 0,
        tier: customer.attributes?.loyaltyTier || 'bronze',
        totalSpend: metrics.totalSpend || 0,
        nextTier: customer.attributes?.loyaltyTier === 'gold' ? null : customer.attributes?.loyaltyTier === 'silver' ? 'gold' : 'silver',
        pointsToNextTier: customer.attributes?.loyaltyTier === 'gold' ? 0 : customer.attributes?.loyaltyTier === 'silver' ? Math.max(0, 500 - (customer.loyaltyPoints || 0)) : Math.max(0, 200 - (customer.loyaltyPoints || 0))
      });
    }

    if (req.method === 'POST' && pathname === '/api/customer/ai-chat') {
      const payload = await readBody(req);
      const userMsg = String(payload.message || '').trim();
      if (!userMsg) return sendJson(res, 400, { error: 'Message is required' });

      const metrics = getOrderMetrics(state, customerId);
      const orders = getCustomerOrders(state, customerId).slice(0, 10);
      const tier = customer.attributes?.loyaltyTier || 'bronze';

      // Context-aware AI response
      const lowerMsg = userMsg.toLowerCase();
      let reply = '';

      if (lowerMsg.includes('order') && (lowerMsg.includes('what') || lowerMsg.includes('history') || lowerMsg.includes('my') || lowerMsg.includes('show'))) {
        if (orders.length === 0) {
          reply = `Hey ${customer.name.split(' ')[0]}! You haven't placed any orders yet. Check out our Shop tab to browse our premium collection! 🛍️`;
        } else {
          const orderList = orders.slice(0, 5).map((o) => `• ${o.product} — ₹${o.amount.toLocaleString()} (${o.status})`).join('\n');
          reply = `Here are your recent orders, ${customer.name.split(' ')[0]}:\n\n${orderList}\n\nYou've spent ₹${(metrics.totalSpend || 0).toLocaleString()} across ${metrics.orderCount || 0} orders. ${metrics.orderCount > 3 ? 'You\'re one of our valued customers! 🌟' : 'Keep shopping to earn more rewards! 🎁'}`;
        }
      } else if (lowerMsg.includes('point') || lowerMsg.includes('reward') || lowerMsg.includes('loyalty') || lowerMsg.includes('tier')) {
        const points = customer.loyaltyPoints || 0;
        reply = `You currently have **${points} loyalty points** and you're a **${tier.toUpperCase()}** tier member! 🏆\n\n`;
        if (tier === 'bronze') reply += `Earn ${Math.max(0, 200 - points)} more points to reach Silver tier. Silver members get exclusive early access to sales!`;
        else if (tier === 'silver') reply += `Earn ${Math.max(0, 500 - points)} more points to reach Gold tier. Gold members get VIP perks and priority support!`;
        else reply += `You're at our highest tier! Enjoy exclusive VIP benefits, priority support, and early access to new collections. 👑`;
      } else if (lowerMsg.includes('recommend') || lowerMsg.includes('suggest') || lowerMsg.includes('buy') || lowerMsg.includes('trending')) {
        const recs = ['Linen Blend Jacket — ₹4,200', 'Silk Print Kurta — ₹3,800', 'Cashmere Scarf Set — ₹2,600', 'Handloom Cotton Shirt — ₹1,900'];
        reply = `Based on your ${tier} tier profile, here are my top picks for you:\n\n${recs.map((r) => `🔥 ${r}`).join('\n')}\n\nHead to the Shop tab to place an order! You'll earn 1 loyalty point for every ₹10 spent.`;
      } else if (lowerMsg.includes('cancel') || lowerMsg.includes('return') || lowerMsg.includes('refund')) {
        reply = `To cancel an order, go to the **Orders** tab and click the cancel button next to the order. Points earned from that order will be automatically deducted.\n\nIf you need further assistance, our team is here to help! 📞`;
      } else if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('hey')) {
        reply = `Hello ${customer.name.split(' ')[0]}! 👋 Welcome to your Loom & Lane shopping assistant!\n\nI can help you with:\n• 📦 Check your order history\n• 🏆 View loyalty points & tier\n• 🔥 Get personalized recommendations\n• ❓ Answer questions about your account\n\nWhat would you like to know?`;
      } else if (lowerMsg.includes('help') || lowerMsg.includes('support') || lowerMsg.includes('?')) {
        reply = `I'm your Loom & Lane shopping copilot! Here's what I can help with:\n\n📦 **Orders** — Ask "What are my orders?" or "Show order history"\n🏆 **Rewards** — Ask "What are my points?" or "What tier am I?"\n🔥 **Recommendations** — Ask "Suggest something" or "What's trending?"\n🔄 **Returns** — Ask "How to cancel an order?"\n\nJust ask me anything! 😊`;
      } else {
        reply = `Thanks for reaching out, ${customer.name.split(' ')[0]}! 😊\n\nAs your ${tier.toUpperCase()} tier member, you have ${customer.loyaltyPoints || 0} loyalty points. You've placed ${metrics.orderCount || 0} orders worth ₹${(metrics.totalSpend || 0).toLocaleString()}.\n\nTry asking me:\n• "What are my orders?"\n• "How many points do I have?"\n• "Recommend something for me"\n• "How do I cancel an order?"`;
      }

      return sendJson(res, 200, { reply, context: { tier, points: customer.loyaltyPoints, orderCount: metrics.orderCount } });
    }

    return sendJson(res, 404, { error: 'Customer route not found' });
  }

  // -----------------------------------------------------------------------
  // Main admin API routes (now protected)
  // -----------------------------------------------------------------------

  async function routeApi(req, res, pathname) {
    try {
      // Public routes — no auth required
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, service: 'crm', channelUrl, persisted: options.persist !== false });
      }

      // Auth routes
      const authResult = await routeAuth(req, res, pathname);
      if (authResult !== null) return;

      // Receipt callback — no auth required (channel service calls this)
      if (req.method === 'POST' && pathname === '/api/receipts') {
        const receipt = await readBody(req);
        return sendJson(res, 202, applyReceipt(receipt));
      }

      // Customer portal routes
      if (pathname.startsWith('/api/customer/')) {
        return routeCustomerApi(req, res, pathname);
      }

      // All remaining routes require admin auth
      const adminSession = requireAdmin(req);
      if (!adminSession) {
        return sendJson(res, 401, { error: 'Admin authentication required' });
      }

      if (req.method === 'POST' && pathname === '/api/admin/reset') {
        const fresh = resetState();
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, fresh);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname === '/api/admin/whatsapp-config') {
        return sendJson(res, 200, {
          ...whatsapp.getConfig(),
          isConfigured: whatsapp.isConfigured()
        });
      }

      if (req.method === 'POST' && pathname === '/api/admin/whatsapp-config') {
        const payload = await readBody(req);
        whatsapp.updateConfig(payload);
        return sendJson(res, 200, { ok: true, isConfigured: whatsapp.isConfigured() });
      }

      if (req.method === 'GET' && pathname === '/api/admin/email-config') {
        return sendJson(res, 200, {
          ...email.getConfig(),
          isConfigured: email.isConfigured()
        });
      }

      if (req.method === 'POST' && pathname === '/api/admin/email-config') {
        const payload = await readBody(req);
        email.updateConfig(payload);
        return sendJson(res, 200, { ok: true, isConfigured: email.isConfigured() });
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
          address: payload.address || '',
          preferredChannel: payload.preferredChannel || 'whatsapp',
          optedIn: payload.optedIn !== false,
          lifecycle: payload.lifecycle || 'new',
          segmentTags: payload.segmentTags || ['Imported'],
          source: payload.source || 'Admin Created',
          loyaltyPoints: payload.loyaltyPoints || 0,
          lastActive: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          attributes: payload.attributes || { loyaltyTier: 'bronze', region: 'unknown', gender: 'unknown' }
        };
        state.customers.push(customer);

        if (customer.source === 'Admin Created') {
          state.communications.push({
            id: uid('com'),
            campaignId: null,
            customerId: customer.id,
            channel: customer.preferredChannel,
            message: `Welcome to Loom & Lane, ${customer.name.split(' ')[0]}! Your shopper account has been activated.`,
            status: 'delivered',
            deliveryState: 'delivered',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            events: [{ type: 'delivered', timestamp: new Date().toISOString() }]
          });
        }

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

      if (req.method === 'GET' && pathname === '/api/ai/status') {
        return sendJson(res, 200, {
          configured: hasAiConfig(),
          mode: hasAiConfig() ? 'llm' : 'offline',
          model: process.env.LLM_MODEL || 'gpt-4o-mini'
        });
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
        scheduleCampaignTimer(campaign, scheduledFor);
        return sendJson(res, 202, { campaign, scheduledFor: campaign.scheduledFor });
      }

      return sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // Check if the path is intended for the Channel Stub simulator
    if (channelApp && (url.pathname.startsWith('/channel-stub') || url.pathname === '/channel-stub')) {
      if (url.pathname === '/channel-stub') {
        res.writeHead(301, { Location: '/channel-stub/' });
        res.end();
        return;
      }
      let stripped = url.pathname.replace('/channel-stub', '');
      if (stripped === '') stripped = '/';
      channelApp.route(req, res, stripped);
      return;
    }

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
