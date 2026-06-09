const { getAudienceMembers, getOrderMetrics } = require('./store');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function promptToSegment(prompt) {
  const text = (prompt || '').toLowerCase();
  const rules = { kind: 'recent_buyer', maxDaysSinceOrder: 30, optInOnly: true };
  let name = 'Recent buyers';
  let description = 'Customers who bought recently and are likely to respond again.';
  let rationale = ['The prompt hints at recency, which usually converts best for shopper CRM campaigns.'];

  if (text.includes('vip') || text.includes('high value') || text.includes('premium')) {
    rules.kind = 'vip_recent';
    rules.maxDaysSinceOrder = text.includes('lapsed') ? 180 : 45;
    rules.minOrders = 2;
    rules.channel = text.includes('email') ? ['email'] : ['whatsapp', 'email'];
    name = 'VIP repeat buyers';
    description = 'High-value shoppers with a strong likelihood to convert on a premium offer.';
    rationale.push('VIP language maps to a higher AOV cohort with repeated purchases.');
  }

  if (text.includes('lapsed') || text.includes('quiet') || text.includes('churn')) {
    rules.kind = 'lapsed';
    rules.minDaysSinceOrder = text.includes('90') ? 90 : 60;
    rules.maxDaysSinceOrder = text.includes('365') ? 365 : 240;
    name = 'Lapsed shoppers';
    description = 'Customers who used to buy but have not returned recently.';
    rationale.push('The prompt asks for win-back behavior, so we bias toward inactivity plus prior purchase history.');
  }

  if (text.includes('email')) {
    rules.kind = 'channel_preference';
    rules.channel = ['email'];
    name = 'Email loyalists';
    description = 'Opted-in shoppers who tend to respond to email.';
    rationale.push('Channel preference improves delivery and engagement for this audience.');
  }

  if (text.includes('whatsapp')) {
    rules.kind = 'channel_preference';
    rules.channel = ['whatsapp'];
    name = 'WhatsApp-first shoppers';
    description = 'Customers who prefer conversational, high-open-rate channels.';
    rationale.push('WhatsApp typically supports richer conversational prompts and stronger open rates.');
  }

  if (text.includes('first time') || text.includes('new customer') || text.includes('onboard')) {
    rules.kind = 'first_time';
    name = 'First-time buyers';
    description = 'Shoppers who placed one order and need a second purchase nudge.';
    rationale.push('New shoppers benefit from a lighter, confidence-building message.');
  }

  const channel = Array.isArray(rules.channel) ? rules.channel[0] : 'whatsapp';
  const tone = text.includes('luxury') || text.includes('premium') ? 'elevated' : text.includes('urgent') ? 'urgent' : 'friendly';
  const offer = text.includes('discount') || text.includes('offer') || text.includes('promo') ? '12% off' : 'early access';

  return {
    segment: {
      name,
      description,
      rules
    },
    message: {
      channel,
      subject: `${offer} for ${name.toLowerCase()}`,
      body: buildMessageFromPrompt(name, tone, offer, text),
      rationale
    }
  };
}

function buildMessageFromPrompt(name, tone, offer, prompt) {
  const urgent = prompt.includes('urgent') || prompt.includes('flash');
  const actionLine = urgent ? 'The window is short, so act now.' : 'It is a good moment to bring them back in.';
  const style = tone === 'elevated'
    ? 'We curated this drop for your best customers'
    : tone === 'urgent'
      ? 'A limited-time nudge for your strongest shoppers'
      : 'A thoughtful re-engagement note';

  return [
    `Hi {{first_name}},`,
    '',
    `${style} - ${offer} is ready for ${name.toLowerCase()}.`,
    actionLine,
    '',
    'Tap through to see the edit and complete your next order.'
  ].join('\n');
}

function suggestAudienceSummary(state, segment) {
  const members = getAudienceMembers(state, segment);
  const topSpenders = members
    .map((customer) => ({ customer, metrics: getOrderMetrics(state, customer.id) }))
    .sort((a, b) => b.metrics.totalSpend - a.metrics.totalSpend)
    .slice(0, 3);

  const avgSpend = members.length
    ? members.reduce((total, customer) => total + getOrderMetrics(state, customer.id).totalSpend, 0) / members.length
    : 0;

  return {
    audienceSize: members.length,
    avgSpend: Math.round(avgSpend),
    topSpenders: topSpenders.map((entry) => ({
      name: entry.customer.name,
      spend: entry.metrics.totalSpend,
      orders: entry.metrics.orderCount
    }))
  };
}

function draftCampaignFromPrompt(state, prompt) {
  const parsed = promptToSegment(prompt);
  const segment = parsed.segment;
  const audience = getAudienceMembers(state, { rules: segment.rules });
  const summary = suggestAudienceSummary(state, { rules: segment.rules });
  const urgency = prompt.toLowerCase().includes('today') || prompt.toLowerCase().includes('now') ? 'high' : 'medium';

  return {
    segment,
    audience,
    summary,
    message: {
      channel: parsed.message.channel,
      subject: parsed.message.subject,
      body: parsed.message.body,
      rationale: parsed.message.rationale
    },
    recommendation: {
      sendWindow: urgency === 'high' ? 'Today 5-8 PM' : 'Tomorrow 10-12 AM',
      budgetConfidence: clamp(60 + audience.length * 6, 58, 92),
      recommendedOffer: audience.length > 3 ? 'free shipping' : '12% off'
    }
  };
}

module.exports = {
  promptToSegment,
  draftCampaignFromPrompt,
  suggestAudienceSummary
};
