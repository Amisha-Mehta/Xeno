const { getAudienceMembers, getOrderMetrics } = require('./store');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function promptToSegment(prompt) {
  const text = (prompt || '').toLowerCase();
  const rules = { kind: 'recent_buyer', maxDaysSinceOrder: 30, optInOnly: true };
  let name = 'Recent buyers';
  let description = 'Customers who bought recently and are likely to respond again.';
  const rationale = ['The prompt hints at recency, which usually converts best for shopper CRM campaigns.'];

  if (text.includes('vip') || text.includes('high value') || text.includes('premium')) {
    rules.kind = 'vip_recent';
    rules.maxDaysSinceOrder = text.includes('lapsed') ? 180 : 45;
    rules.minOrders = 2;
    rules.channel = text.includes('email') ? ['email'] : ['whatsapp', 'email'];
    name = 'VIP repeat buyers';
    description = 'High-value shoppers with a strong likelihood to convert on a premium offer.';
    rationale.push('VIP language maps to a higher AOV cohort with repeated purchases.');
  }

  if (text.includes('lapsed') || text.includes('quiet') || text.includes('churn') || text.includes('win back')) {
    rules.kind = 'lapsed';
    rules.minDaysSinceOrder = text.includes('90') ? 90 : 60;
    rules.maxDaysSinceOrder = text.includes('365') ? 365 : 240;
    name = 'Lapsed shoppers';
    description = 'Customers who used to buy but have not returned recently.';
    rationale.push('The prompt asks for win-back behavior, so we bias toward inactivity plus prior purchase history.');
  }

  if (text.includes('email') && !text.includes('whatsapp')) {
    if (rules.kind === 'recent_buyer') {
      rules.kind = 'channel_preference';
      rules.channel = ['email'];
      name = 'Email loyalists';
      description = 'Opted-in shoppers who tend to respond to email.';
    }
    rationale.push('Channel preference improves delivery and engagement for this audience.');
  }

  if (text.includes('whatsapp') && !text.includes('email')) {
    if (rules.kind === 'recent_buyer') {
      rules.kind = 'channel_preference';
      rules.channel = ['whatsapp'];
      name = 'WhatsApp-first shoppers';
      description = 'Customers who prefer conversational, high-open-rate channels.';
    }
    rationale.push('WhatsApp typically supports richer conversational prompts and stronger open rates.');
  }

  if (text.includes('first time') || text.includes('new customer') || text.includes('onboard')) {
    rules.kind = 'first_time';
    name = 'First-time buyers';
    description = 'Shoppers who placed one order and need a second purchase nudge.';
    rationale.push('New shoppers benefit from a lighter, confidence-building message.');
  }

  if (text.includes('sms')) {
    if (rules.kind === 'recent_buyer') {
      rules.channel = ['sms'];
      name = 'SMS-responsive shoppers';
      description = 'Customers reachable via SMS with strong delivery rates.';
    }
    rationale.push('SMS works well for time-sensitive, short-form offers.');
  }

  if (text.includes('rcs')) {
    if (rules.kind === 'recent_buyer') {
      rules.channel = ['rcs'];
      name = 'RCS-engaged shoppers';
      description = 'Customers who engage with rich messaging formats.';
    }
    rationale.push('RCS supports richer media and higher engagement for visual campaigns.');
  }

  const requestedChannel = ['whatsapp', 'email', 'sms', 'rcs'].find((candidate) => text.includes(candidate));
  const channel = requestedChannel || (Array.isArray(rules.channel) ? rules.channel[0] : 'whatsapp');
  const tone = text.includes('luxury') || text.includes('premium') ? 'elevated'
    : text.includes('urgent') || text.includes('flash') ? 'urgent'
      : 'friendly';
  const offer = text.includes('discount') || text.includes('offer') || text.includes('promo') || text.includes('%')
    ? '12% off'
    : 'early access';

  return {
    segment: { name, description, rules },
    message: {
      channel,
      subject: `${offer === 'early access' ? 'Early Access' : 'Special Offer'} - ${name}`,
      body: buildMessageFromPrompt(name, tone, offer, text),
      rationale
    }
  };
}

function buildMessageFromPrompt(name, tone, offer, prompt) {
  const urgent = prompt.includes('urgent') || prompt.includes('flash');
  const actionLine = urgent
    ? 'The window is short, so act now.'
    : 'It is a good moment to bring them back in.';
  const style = tone === 'elevated'
    ? 'We curated this drop for your best customers'
    : tone === 'urgent'
      ? 'A limited-time nudge for your strongest shoppers'
      : 'A thoughtful re-engagement note';

  return [
    'Hi {{first_name}},',
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

function buildStateSummary(state) {
  const customers = state.customers.length;
  const orders = state.orders.length;
  const totalSpend = state.orders.reduce((sum, order) => sum + (order.amount || 0), 0);
  const segments = state.segments.map((segment) => `${segment.name} (${segment.rules.kind})`).join('; ');
  const pastCampaigns = state.campaigns
    .slice(-3)
    .map((campaign) => `${campaign.name} via ${campaign.channel}: ${campaign.metrics?.clicked || 0} clicks, Rs ${campaign.metrics?.revenueAttributed || 0} revenue`)
    .join(' | ');
  const channelsActive = [...new Set(state.communications.map((communication) => communication.channel))].join(', ') || 'none yet';

  return [
    'Brand: Loom & Lane, a D2C fashion and lifestyle brand.',
    `${customers} customers, ${orders} orders totalling Rs ${totalSpend.toLocaleString('en-IN')}.`,
    `Existing segments: ${segments || 'none yet'}.`,
    `Recent campaigns: ${pastCampaigns || 'none yet'}.`,
    `Active channels: ${channelsActive}.`
  ].join(' ');
}

function buildDraftSystemPrompt(stateSummary) {
  return `You are Xeno's AI Campaign Strategist, embedded inside a Mini CRM for D2C brands.

Respond with raw JSON only. Use this exact shape:
{
  "segment": {
    "name": "human-readable segment name",
    "description": "one-sentence segment description",
    "rules": {
      "kind": "vip_recent | lapsed | channel_preference | high_value | recent_buyer | first_time | custom",
      "maxDaysSinceOrder": 30,
      "minDaysSinceOrder": null,
      "minOrders": null,
      "minSpend": null,
      "channel": ["whatsapp"],
      "optInOnly": true
    }
  },
  "message": {
    "channel": "whatsapp",
    "subject": "campaign subject",
    "body": "personalized message using {{first_name}}"
  },
  "strategyBrief": "2-3 sentences explaining the strategy",
  "recommendation": {
    "sendWindow": "Tomorrow 10-12 AM",
    "budgetConfidence": 75,
    "recommendedOffer": "12% off"
  }
}

CRM context: ${stateSummary}

Rules:
- Pick one primary channel unless the user explicitly asks for multiple.
- Always include optInOnly true unless the user explicitly asks for analysis only.
- Keep the message under 140 words and include {{first_name}}.
- Use realistic confidence, usually 50-90.
- Do not wrap JSON in markdown.`;
}

async function draftWithLLM(state, prompt) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey || apiKey.length < 8) return null;

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildDraftSystemPrompt(buildStateSummary(state)) },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1200
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  const raw = body?.choices?.[0]?.message?.content || '';
  if (!raw) return null;

  let json = raw.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(json);
  if (!parsed.segment?.rules?.kind || !parsed.message?.body) return null;
  return parsed;
}

async function draftCampaignFromPrompt(state, prompt) {
  const llmResult = await draftWithLLM(state, prompt).catch(() => null);

  if (llmResult) {
    const segment = llmResult.segment;
    const audience = getAudienceMembers(state, { rules: segment.rules });
    const summary = suggestAudienceSummary(state, { rules: segment.rules });

    return {
      segment,
      audience,
      summary,
      message: {
        channel: llmResult.message.channel || 'whatsapp',
        subject: llmResult.message.subject || 'Campaign',
        body: llmResult.message.body,
        rationale: [llmResult.strategyBrief || 'Generated by AI copilot.']
      },
      recommendation: llmResult.recommendation || {
        sendWindow: 'Tomorrow 10-12 AM',
        budgetConfidence: clamp(60 + audience.length * 6, 58, 92),
        recommendedOffer: 'early access'
      },
      aiMode: 'llm'
    };
  }

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
    },
    aiMode: 'rule-based'
  };
}

async function aiChat(state, userMessage) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || apiKey.length < 8) {
    const draft = await draftCampaignFromPrompt(state, userMessage || '');
    return {
      reply: [
        `I am running in offline mode, so I used the local campaign planner.`,
        `Suggested audience: ${draft.segment.name}.`,
        `Recommended channel: ${draft.message.channel}.`,
        `Message: ${draft.message.body.replace(/\n+/g, ' ')}`
      ].join(' '),
      mode: 'offline'
    };
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const system = [
    'You are Xeno AI Campaign Copilot for a D2C brand named Loom & Lane.',
    `CRM state: ${buildStateSummary(state)}`,
    'Help marketers choose audience, channel, offer, and message.',
    'Keep replies concise, practical, and action-oriented.'
  ].join(' ');

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 800
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error('AI request failed');
    const body = await response.json();
    return {
      reply: body?.choices?.[0]?.message?.content || 'I processed that, but got an empty AI response.',
      mode: 'llm'
    };
  } catch {
    return {
      reply: "I could not reach the AI service. The offline draft engine is still available in the Command Center.",
      mode: 'offline'
    };
  }
}

module.exports = {
  promptToSegment,
  draftCampaignFromPrompt,
  suggestAudienceSummary,
  aiChat
};
