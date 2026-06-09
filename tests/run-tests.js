const assert = require('assert');
const { createSeedState, getAudienceMembers, computeCampaignMetrics, uid } = require('../lib/store');
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

async function run() {
  await testAiDraftCreatesAudience();
  console.log('passed testAiDraftCreatesAudience');

  testSegmentMatching();
  console.log('passed testSegmentMatching');

  testMetricsAndReceiptIdempotency();
  console.log('passed testMetricsAndReceiptIdempotency');

  testOutOfOrderReceiptsDoNotDowngrade();
  console.log('passed testOutOfOrderReceiptsDoNotDowngrade');

  console.log('All 4 tests passed.');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
