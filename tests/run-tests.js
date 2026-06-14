const assert = require('assert');
const { createSeedState, getAudienceMembers, computeCampaignMetrics, getCampaignById, uid } = require('../lib/store');
const { draftCampaignFromPrompt } = require('../lib/ai');
const { createCrmApp } = require('../lib/crm-app');

async function testAiDraftCreatesAudience() {
  const state = createSeedState();
  const draft = await draftCampaignFromPrompt(state, 'Win back lapsed shoppers with a WhatsApp offer');
  assert.ok(draft.segment, 'Draft should have a segment');
  assert.ok(draft.segment.rules, 'Draft segment should have rules');
  const kind = draft.segment.rules.kind;
  assert.ok(kind === 'channel_preference' || kind === 'lapsed' || kind === 'recent_buyer',
    `Expected lapsed/channel_preference/recent_buyer, got ${kind}`);
  assert.ok(Array.isArray(draft.audience));
  assert.ok(draft.message.body.includes('{{first_name}}'));
}

function testSegmentMatching() {
  const state = createSeedState();
  const segment = state.segments.find((item) => item.name.includes('Lapsed'));
  const audience = getAudienceMembers(state, segment);
  assert.ok(audience.length >= 1);
  audience.forEach((customer) => {
    assert.equal(customer.optedIn, true);
  });
}

function testMetricsAndReceiptIdempotency() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const campaign = state.campaigns[0];
  const communication = state.communications[0];
  const receipt = {
    id: uid('evt'),
    campaignId: campaign.id,
    communicationId: communication.id,
    customerId: communication.customerId,
    channel: campaign.channel,
    type: 'clicked',
    timestamp: new Date().toISOString()
  };

  const first = app.applyReceipt(receipt);
  const second = app.applyReceipt(receipt);
  const metrics = computeCampaignMetrics(state, campaign);

  assert.deepEqual(first, { accepted: true });
  assert.deepEqual(second, { duplicate: true });
  assert.equal(metrics.clicked >= 1, true);
}

function testOutOfOrderReceiptsDoNotDowngrade() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const campaign = state.campaigns[0];
  const communication = state.communications[0];

  app.applyReceipt({
    id: uid('evt'),
    campaignId: campaign.id,
    communicationId: communication.id,
    customerId: communication.customerId,
    channel: campaign.channel,
    type: 'clicked',
    timestamp: new Date().toISOString()
  });
  app.applyReceipt({
    id: uid('evt'),
    campaignId: campaign.id,
    communicationId: communication.id,
    customerId: communication.customerId,
    channel: campaign.channel,
    type: 'delivered',
    timestamp: new Date().toISOString()
  });

  assert.equal(communication.status, 'clicked');
}

function testCompoundSegments() {
  const state = createSeedState();
  const segment = {
    rules: {
      all: [
        { kind: 'high_value', minSpend: 8000, optInOnly: true },
        { kind: 'custom', loyaltyTier: 'gold', optInOnly: true }
      ]
    }
  };
  const audience = getAudienceMembers(state, segment);
  assert.ok(audience.length >= 1);
  audience.forEach((customer) => {
    assert.equal(customer.optedIn, true);
    assert.equal(customer.attributes.loyaltyTier, 'gold');
  });
}

async function testSchedulingEndpoint() {
  const state = createSeedState();
  const app = createCrmApp({
    state,
    persist: false,
    channelUrl: 'http://127.0.0.1:1',
    crmUrl: 'http://127.0.0.1:2'
  });
  const campaign = state.campaigns[0];

  const server = app.server.listen(0);
  const port = server.address().port;

  // First, we need to log in as admin to get the cookie
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@xeno.io', password: 'admin123' })
  });
  assert.equal(loginResponse.status, 200);
  const cookieHeader = loginResponse.headers.get('set-cookie');
  assert.ok(cookieHeader);

  const response = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaign.id}/schedule`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': cookieHeader
    },
    body: JSON.stringify({ delayMs: 60000 })
  });
  const body = await response.json();
  server.close();
  app.scheduleTimers.forEach((timer) => clearTimeout(timer));
  app.scheduleTimers.clear();

  assert.equal(response.status, 202);
  assert.equal(getCampaignById(state, campaign.id).status, 'scheduled');
  assert.ok(body.scheduledFor);
}

async function testAdminLoginSuccess() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const server = app.server.listen(0);
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@xeno.io', password: 'admin123' })
  });
  const body = await response.json();
  const cookie = response.headers.get('set-cookie');

  server.close();
  assert.equal(response.status, 200);
  assert.ok(body.ok);
  assert.equal(body.role, 'admin');
  assert.ok(cookie && cookie.includes('xeno_session='));
}

async function testAdminLoginFailure() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const server = app.server.listen(0);
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@xeno.io', password: 'wrongpassword' })
  });
  server.close();
  assert.equal(response.status, 401);
}

async function testProtectedRouteRequiresAuth() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const server = app.server.listen(0);
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/state`);
  server.close();
  assert.equal(response.status, 401);
}

async function testCustomerLoginSuccess() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const server = app.server.listen(0);
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aanya@loomandlane.com', phone: '+91 90000 10001' })
  });
  const body = await response.json();
  const cookie = response.headers.get('set-cookie');

  server.close();
  assert.equal(response.status, 200);
  assert.ok(body.ok);
  assert.equal(body.role, 'customer');
  assert.equal(body.customer.email, 'aanya@loomandlane.com');
  assert.ok(cookie && cookie.includes('xeno_session='));
}

async function testCustomerPortalDataIsolation() {
  const state = createSeedState();
  const app = createCrmApp({ state, persist: false });
  const server = app.server.listen(0);
  const port = server.address().port;

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aanya@loomandlane.com', phone: '+91 90000 10001' })
  });
  const cookie = loginResponse.headers.get('set-cookie');

  const response = await fetch(`http://127.0.0.1:${port}/api/state`, {
    headers: { 'Cookie': cookie }
  });

  server.close();
  assert.equal(response.status, 401);
}

async function testWhatsAppFallbackWhenNotConfigured() {
  const { createChannelApp } = require('../lib/channel-app');
  const channelApp = createChannelApp({ forceSimulation: true });
  const channelServer = channelApp.server.listen(0);
  const port = channelServer.address().port;

  const state = createSeedState();
  const campaign = state.campaigns[0];
  const communications = state.communications.map(comm => {
    const customer = state.customers.find(c => c.id === comm.customerId);
    return { ...comm, customer };
  });

  const response = await fetch(`http://127.0.0.1:${port}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign,
      communications,
      callbackUrl: 'http://127.0.0.1:1/callback'
    })
  });
  const body = await response.json();
  channelServer.close();

  assert.equal(response.status, 202);
  assert.equal(body.mode, 'simulated');
}

async function run() {
  await testAiDraftCreatesAudience();
  console.log('passed testAiDraftCreatesAudience');

  testSegmentMatching();
  console.log('passed testSegmentMatching');

  testMetricsAndReceiptIdempotency();
  console.log('passed testMetricsAndReceiptIdempotency');

  testOutOfOrderReceiptsDoNotDowngrade();
  console.log('passed testOutOfOrderReceiptsDoNotDowngrade');

  testCompoundSegments();
  console.log('passed testCompoundSegments');

  await testSchedulingEndpoint();
  console.log('passed testSchedulingEndpoint');

  await testAdminLoginSuccess();
  console.log('passed testAdminLoginSuccess');

  await testAdminLoginFailure();
  console.log('passed testAdminLoginFailure');

  await testProtectedRouteRequiresAuth();
  console.log('passed testProtectedRouteRequiresAuth');

  await testCustomerLoginSuccess();
  console.log('passed testCustomerLoginSuccess');

  await testCustomerPortalDataIsolation();
  console.log('passed testCustomerPortalDataIsolation');

  await testWhatsAppFallbackWhenNotConfigured();
  console.log('passed testWhatsAppFallbackWhenNotConfigured');

  console.log('All tests passed.');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
