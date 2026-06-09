const assert = require('assert');
const { createSeedState, getAudienceMembers, computeCampaignMetrics, uid } = require('../lib/store');
const { draftCampaignFromPrompt } = require('../lib/ai');
const { createCrmApp } = require('../lib/crm-app');

function testAiDraftCreatesAudience() {
  const state = createSeedState();
  const draft = draftCampaignFromPrompt(state, 'Win back lapsed shoppers with a WhatsApp offer');
  assert.ok(draft.segment.rules.kind === 'channel_preference' || draft.segment.rules.kind === 'lapsed');
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

const tests = [
  testAiDraftCreatesAudience,
  testSegmentMatching,
  testMetricsAndReceiptIdempotency,
  testOutOfOrderReceiptsDoNotDowngrade
];

for (const test of tests) {
  test();
  console.log(`passed ${test.name}`);
}

console.log(`All ${tests.length} tests passed.`);
