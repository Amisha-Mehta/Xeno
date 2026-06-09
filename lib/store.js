const crypto = require('crypto');

const CHANNELS = ['whatsapp', 'sms', 'email', 'rcs'];

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function isoMinutesAgo(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
}

function daysBetween(a, b = new Date()) {
  return Math.floor((b.getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function createCustomer(seed) {
  return {
    id: uid('cus'),
    name: seed.name,
    email: seed.email,
    phone: seed.phone,
    city: seed.city,
    segmentTags: seed.tags,
    preferredChannel: seed.preferredChannel,
    optedIn: seed.optedIn,
    lifecycle: seed.lifecycle,
    createdAt: isoDaysAgo(seed.customerAgeDays),
    attributes: {
      gender: seed.gender,
      region: seed.region,
      loyaltyTier: seed.loyaltyTier
    }
  };
}

function createOrder(customerId, seed) {
  return {
    id: uid('ord'),
    customerId,
    amount: seed.amount,
    channel: seed.channel,
    status: seed.status || 'paid',
    product: seed.product,
    category: seed.category,
    createdAt: isoDaysAgo(seed.daysAgo),
    sourceCampaignId: seed.sourceCampaignId || null
  };
}

function createSeedState() {
  const customerSeeds = [
    {
      name: 'Aanya Sharma',
      email: 'aanya@loomandlane.com',
      phone: '+91 90000 10001',
      city: 'Delhi',
      gender: 'women',
      region: 'north',
      loyaltyTier: 'gold',
      preferredChannel: 'whatsapp',
      optedIn: true,
      lifecycle: 'vip',
      tags: ['VIP', 'Repeat Buyer', 'WhatsApp-first'],
      customerAgeDays: 612
    },
    {
      name: 'Arjun Mehta',
      email: 'arjun@loomandlane.com',
      phone: '+91 90000 10002',
      city: 'Mumbai',
      gender: 'men',
      region: 'west',
      loyaltyTier: 'gold',
      preferredChannel: 'email',
      optedIn: true,
      lifecycle: 'high_value',
      tags: ['High Value', 'Newsletter Reader'],
      customerAgeDays: 780
    },
    {
      name: 'Meera Iyer',
      email: 'meera@loomandlane.com',
      phone: '+91 90000 10003',
      city: 'Bengaluru',
      gender: 'women',
      region: 'south',
      loyaltyTier: 'silver',
      preferredChannel: 'rcs',
      optedIn: true,
      lifecycle: 'active',
      tags: ['RCS-engaged', 'Summer Drop'],
      customerAgeDays: 344
    },
    {
      name: 'Kabir Singh',
      email: 'kabir@loomandlane.com',
      phone: '+91 90000 10004',
      city: 'Pune',
      gender: 'men',
      region: 'west',
      loyaltyTier: 'silver',
      preferredChannel: 'sms',
      optedIn: true,
      lifecycle: 'lapsed',
      tags: ['Lapsed', 'SMS-responsive'],
      customerAgeDays: 901
    },
    {
      name: 'Isha Nair',
      email: 'isha@loomandlane.com',
      phone: '+91 90000 10005',
      city: 'Chennai',
      gender: 'women',
      region: 'south',
      loyaltyTier: 'gold',
      preferredChannel: 'whatsapp',
      optedIn: true,
      lifecycle: 'active',
      tags: ['Fast Rebuyer', 'Cart Saver'],
      customerAgeDays: 422
    },
    {
      name: 'Rahul Verma',
      email: 'rahul@loomandlane.com',
      phone: '+91 90000 10006',
      city: 'Jaipur',
      gender: 'men',
      region: 'north',
      loyaltyTier: 'bronze',
      preferredChannel: 'sms',
      optedIn: true,
      lifecycle: 'new',
      tags: ['First Time', 'Coupon Seeker'],
      customerAgeDays: 72
    },
    {
      name: 'Diya Kapoor',
      email: 'diya@loomandlane.com',
      phone: '+91 90000 10007',
      city: 'Hyderabad',
      gender: 'women',
      region: 'south',
      loyaltyTier: 'gold',
      preferredChannel: 'email',
      optedIn: true,
      lifecycle: 'active',
      tags: ['Email Loyalist', 'High AOV'],
      customerAgeDays: 510
    },
    {
      name: 'Nikhil Rao',
      email: 'nikhil@loomandlane.com',
      phone: '+91 90000 10008',
      city: 'Ahmedabad',
      gender: 'men',
      region: 'west',
      loyaltyTier: 'silver',
      preferredChannel: 'whatsapp',
      optedIn: false,
      lifecycle: 'inactive',
      tags: ['Opted Out', 'Dormant'],
      customerAgeDays: 1080
    },
    {
      name: 'Sara Khan',
      email: 'sara@loomandlane.com',
      phone: '+91 90000 10009',
      city: 'Kolkata',
      gender: 'women',
      region: 'east',
      loyaltyTier: 'gold',
      preferredChannel: 'whatsapp',
      optedIn: true,
      lifecycle: 'vip',
      tags: ['VIP', 'New Collection Fan'],
      customerAgeDays: 680
    },
    {
      name: 'Dev Joshi',
      email: 'dev@loomandlane.com',
      phone: '+91 90000 10010',
      city: 'Surat',
      gender: 'men',
      region: 'west',
      loyaltyTier: 'bronze',
      preferredChannel: 'sms',
      optedIn: true,
      lifecycle: 'active',
      tags: ['Price Sensitive', 'Weekend Buyer'],
      customerAgeDays: 241
    }
  ];

  const customers = customerSeeds.map(createCustomer);
  const customerByName = Object.fromEntries(customers.map((customer) => [customer.name, customer]));

  const orders = [];
  const orderPlan = [
    ['Aanya Sharma', [
      { amount: 4200, product: 'Linen Jacket', category: 'apparel', daysAgo: 12, channel: 'whatsapp' },
      { amount: 3600, product: 'Silk Co-ord Set', category: 'apparel', daysAgo: 41, channel: 'email' },
      { amount: 2900, product: 'Tailored Trousers', category: 'apparel', daysAgo: 95, channel: 'whatsapp' }
    ]],
    ['Arjun Mehta', [
      { amount: 5400, product: 'Weekend Bag', category: 'accessories', daysAgo: 17, channel: 'email' },
      { amount: 3100, product: 'Oxford Shirt', category: 'apparel', daysAgo: 58, channel: 'email' },
      { amount: 4800, product: 'Chelsea Boots', category: 'footwear', daysAgo: 126, channel: 'rcs' }
    ]],
    ['Meera Iyer', [
      { amount: 2100, product: 'Coffee Subscription', category: 'beverage', daysAgo: 5, channel: 'rcs' },
      { amount: 1800, product: 'Reusable Tumbler', category: 'accessories', daysAgo: 33, channel: 'whatsapp' }
    ]],
    ['Kabir Singh', [
      { amount: 1900, product: 'Overshirt', category: 'apparel', daysAgo: 178, channel: 'sms' },
      { amount: 2200, product: 'Training Shoes', category: 'footwear', daysAgo: 244, channel: 'sms' }
    ]],
    ['Isha Nair', [
      { amount: 6100, product: 'Signature Trench', category: 'apparel', daysAgo: 9, channel: 'whatsapp' },
      { amount: 3300, product: 'Leather Belt', category: 'accessories', daysAgo: 47, channel: 'whatsapp' },
      { amount: 2700, product: 'Rib Knit Dress', category: 'apparel', daysAgo: 83, channel: 'email' },
      { amount: 2400, product: 'Stud Earrings', category: 'accessories', daysAgo: 140, channel: 'whatsapp' }
    ]],
    ['Rahul Verma', [
      { amount: 1200, product: 'Intro Hoodie', category: 'apparel', daysAgo: 15, channel: 'sms' }
    ]],
    ['Diya Kapoor', [
      { amount: 7600, product: 'Cashmere Coat', category: 'apparel', daysAgo: 22, channel: 'email' },
      { amount: 4100, product: 'Leather Tote', category: 'accessories', daysAgo: 61, channel: 'email' }
    ]],
    ['Nikhil Rao', [
      { amount: 2600, product: 'Utility Jacket', category: 'apparel', daysAgo: 283, channel: 'whatsapp' },
      { amount: 3100, product: 'Sneakers', category: 'footwear', daysAgo: 322, channel: 'sms' }
    ]],
    ['Sara Khan', [
      { amount: 8800, product: 'Evening Edit Set', category: 'apparel', daysAgo: 7, channel: 'whatsapp' },
      { amount: 4500, product: 'Statement Bag', category: 'accessories', daysAgo: 29, channel: 'whatsapp' },
      { amount: 3100, product: 'Pleated Dress', category: 'apparel', daysAgo: 54, channel: 'email' }
    ]],
    ['Dev Joshi', [
      { amount: 1400, product: 'Utility Cap', category: 'accessories', daysAgo: 18, channel: 'sms' },
      { amount: 2900, product: 'Relaxed Tee Pack', category: 'apparel', daysAgo: 66, channel: 'sms' }
    ]]
  ];

  for (const [name, items] of orderPlan) {
    const customer = customerByName[name];
    items.forEach((item, index) => {
      orders.push(createOrder(customer.id, {
        ...item,
        daysAgo: item.daysAgo + index,
        sourceCampaignId: item.sourceCampaignId || null
      }));
    });
  }

  const segments = [
    {
      id: uid('seg'),
      name: 'VIPs who bought in the last 45 days',
      description: 'High-value shoppers with recent purchase intent.',
      type: 'ai',
      rules: { kind: 'vip_recent', maxDaysSinceOrder: 45, minOrders: 2, channel: ['whatsapp', 'email'] },
      estimatedCount: 3,
      createdAt: isoDaysAgo(8)
    },
    {
      id: uid('seg'),
      name: 'Lapsed shoppers at risk',
      description: 'Customers who used to buy but have gone quiet.',
      type: 'ai',
      rules: { kind: 'lapsed', minDaysSinceOrder: 90, maxDaysSinceOrder: 365, minOrders: 2, optInOnly: true },
      estimatedCount: 2,
      createdAt: isoDaysAgo(4)
    },
    {
      id: uid('seg'),
      name: 'Email loyalists',
      description: 'Opted-in shoppers who consistently open email.',
      type: 'manual',
      rules: { kind: 'channel_preference', channel: ['email'], optInOnly: true },
      estimatedCount: 3,
      createdAt: isoDaysAgo(3)
    }
  ];

  const state = {
    customers,
    orders,
    segments,
    campaigns: [],
    communications: [],
    receipts: [],
    seenReceiptIds: new Set(),
    events: [],
    notes: []
  };

  const seededCampaign = {
    id: uid('cam'),
    name: 'Monsoon Layering Push',
    channel: 'whatsapp',
    status: 'completed',
    segmentId: segments[0].id,
    audienceSize: 3,
    createdAt: isoDaysAgo(6),
    sentAt: isoDaysAgo(6),
    completedAt: isoDaysAgo(6),
    aiSummary: 'Re-engage high-value shoppers with an early access offer and a concise, inventory-led message.',
    subject: 'Early access: the layering edit is here',
    message: 'Hi {{first_name}}, your next favorite layer just landed. Tap to unlock early access and a 12% thank-you offer.',
    metrics: {
      sent: 3,
      delivered: 3,
      opened: 3,
      read: 2,
      clicked: 2,
      failed: 0,
      attributedOrders: 2,
      revenueAttributed: 11800
    }
  };

  state.campaigns.push(seededCampaign);

  const seededRecipients = customers.slice(0, 3);
  seededRecipients.forEach((customer, index) => {
    const communicationId = uid('com');
    state.communications.push({
      id: communicationId,
      campaignId: seededCampaign.id,
      customerId: customer.id,
      channel: seededCampaign.channel,
      message: seededCampaign.message.replace('{{first_name}}', customer.name.split(' ')[0]),
      status: index === 0 ? 'clicked' : index === 1 ? 'opened' : 'read',
      deliveryState: index === 0 ? 'clicked' : index === 1 ? 'opened' : 'read',
      createdAt: isoDaysAgo(6),
      updatedAt: isoDaysAgo(6),
      events: [
        { type: 'queued', timestamp: isoDaysAgo(6) },
        { type: 'delivered', timestamp: isoDaysAgo(6), meta: { attempt: 1 } },
        ...(index === 0 ? [{ type: 'opened', timestamp: isoDaysAgo(6) }, { type: 'clicked', timestamp: isoDaysAgo(6) }] : []),
        ...(index === 1 ? [{ type: 'opened', timestamp: isoDaysAgo(6) }] : []),
        ...(index === 2 ? [{ type: 'opened', timestamp: isoDaysAgo(6) }, { type: 'read', timestamp: isoDaysAgo(6) }] : [])
      ]
    });
  });

  state.receipts.push(
    { id: uid('evt'), campaignId: seededCampaign.id, communicationId: state.communications[0].id, customerId: seededRecipients[0].id, type: 'delivered', timestamp: isoDaysAgo(6) },
    { id: uid('evt'), campaignId: seededCampaign.id, communicationId: state.communications[0].id, customerId: seededRecipients[0].id, type: 'opened', timestamp: isoDaysAgo(6) },
    { id: uid('evt'), campaignId: seededCampaign.id, communicationId: state.communications[0].id, customerId: seededRecipients[0].id, type: 'clicked', timestamp: isoDaysAgo(6) }
  );

  return state;
}

function getCustomerOrders(state, customerId) {
  return state.orders.filter((order) => order.customerId === customerId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getLatestOrder(state, customerId) {
  const orders = getCustomerOrders(state, customerId);
  return orders[0] || null;
}

function getOrderMetrics(state, customerId) {
  const orders = getCustomerOrders(state, customerId);
  const totalSpend = sum(orders.map((order) => order.amount));
  const lastOrder = orders[0] || null;
  const daysSinceLastOrder = lastOrder ? daysBetween(lastOrder.createdAt) : Infinity;
  return {
    orderCount: orders.length,
    totalSpend,
    averageOrderValue: orders.length ? totalSpend / orders.length : 0,
    daysSinceLastOrder,
    lastOrder,
    orders
  };
}

function evaluateSegment(segment, customer, state) {
  if (segment.rules.all) {
    return segment.rules.all.every((rule) => evaluateSegment({ rules: rule }, customer, state));
  }

  if (segment.rules.any) {
    return segment.rules.any.some((rule) => evaluateSegment({ rules: rule }, customer, state));
  }

  const metrics = getOrderMetrics(state, customer.id);
  const tags = customer.segmentTags || [];
  const preferredChannel = customer.preferredChannel;
  const channelMatch = Array.isArray(segment.rules.channel) ? segment.rules.channel.includes(preferredChannel) : true;
  const optInOk = segment.rules.optInOnly ? customer.optedIn : true;
  const minSpendOk = segment.rules.minSpend ? metrics.totalSpend >= segment.rules.minSpend : true;
  const cityOk = segment.rules.city ? customer.city.toLowerCase() === String(segment.rules.city).toLowerCase() : true;
  const lifecycleOk = segment.rules.lifecycle ? customer.lifecycle === segment.rules.lifecycle : true;
  const tierOk = segment.rules.loyaltyTier ? customer.attributes.loyaltyTier === segment.rules.loyaltyTier : true;
  const categoryOk = segment.rules.category
    ? metrics.orders.some((order) => order.category === segment.rules.category)
    : true;
  const baseOk = optInOk && channelMatch && minSpendOk && cityOk && lifecycleOk && tierOk && categoryOk;

  switch (segment.rules.kind) {
    case 'vip_recent':
      return baseOk && tags.includes('VIP') && metrics.orderCount >= (segment.rules.minOrders || 2) && metrics.daysSinceLastOrder <= (segment.rules.maxDaysSinceOrder || 45);
    case 'lapsed':
      return baseOk && metrics.orderCount >= (segment.rules.minOrders || 2) && metrics.daysSinceLastOrder >= (segment.rules.minDaysSinceOrder || 90) && metrics.daysSinceLastOrder <= (segment.rules.maxDaysSinceOrder || 365);
    case 'channel_preference':
      return baseOk;
    case 'high_value':
      return baseOk && metrics.totalSpend >= (segment.rules.minSpend || 8000);
    case 'recent_buyer':
      return baseOk && metrics.daysSinceLastOrder <= (segment.rules.maxDaysSinceOrder || 30);
    case 'first_time':
      return baseOk && metrics.orderCount === 1;
    case 'custom':
      return baseOk;
    default:
      return baseOk;
  }
}

function getAudienceMembers(state, segment) {
  return state.customers.filter((customer) => evaluateSegment(segment, customer, state));
}

function getSegmentById(state, id) {
  return state.segments.find((segment) => segment.id === id) || null;
}

function getCampaignById(state, id) {
  return state.campaigns.find((campaign) => campaign.id === id) || null;
}

function getCommunicationsByCampaign(state, campaignId) {
  return state.communications.filter((communication) => communication.campaignId === campaignId);
}

function computeCampaignMetrics(state, campaign) {
  const communications = getCommunicationsByCampaign(state, campaign.id);
  const sent = communications.length;
  const delivered = communications.filter((communication) => ['delivered', 'opened', 'read', 'clicked'].includes(communication.status)).length;
  const opened = communications.filter((communication) => ['opened', 'read', 'clicked'].includes(communication.status)).length;
  const read = communications.filter((communication) => ['read', 'clicked'].includes(communication.status)).length;
  const clicked = communications.filter((communication) => communication.status === 'clicked').length;
  const failed = communications.filter((communication) => communication.status === 'failed').length;
  const attributedOrders = state.orders.filter((order) => order.sourceCampaignId === campaign.id).length;
  const revenueAttributed = state.orders.filter((order) => order.sourceCampaignId === campaign.id).reduce((total, order) => total + order.amount, 0);

  return {
    sent,
    delivered,
    opened,
    read,
    clicked,
    failed,
    attributedOrders,
    revenueAttributed
  };
}

function computeDashboard(state) {
  const spend = sum(state.orders.map((order) => order.amount));
  const activeCampaigns = state.campaigns.filter((campaign) => ['draft', 'sending', 'scheduled'].includes(campaign.status)).length;
  const completedCampaigns = state.campaigns.filter((campaign) => campaign.status === 'completed').length;
  const totalCommunications = state.communications.length;
  const deliveredCommunications = state.communications.filter((communication) => ['delivered', 'opened', 'read', 'clicked'].includes(communication.status)).length;
  const clickedCommunications = state.communications.filter((communication) => communication.status === 'clicked').length;
  const topCustomers = [...state.customers]
    .map((customer) => {
      const metrics = getOrderMetrics(state, customer.id);
      return { ...customer, metrics };
    })
    .sort((a, b) => b.metrics.totalSpend - a.metrics.totalSpend)
    .slice(0, 5);

  const campaignSummaries = state.campaigns
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((campaign) => ({
      ...campaign,
      metrics: computeCampaignMetrics(state, campaign)
    }));

  const channelBreakdown = CHANNELS.map((channel) => {
    const comms = state.communications.filter((communication) => communication.channel === channel);
    const delivered = comms.filter((communication) => ['delivered', 'opened', 'read', 'clicked'].includes(communication.status)).length;
    const clicked = comms.filter((communication) => communication.status === 'clicked').length;
    return {
      channel,
      sent: comms.length,
      delivered,
      clicked,
      deliveryRate: comms.length ? delivered / comms.length : 0,
      clickRate: comms.length ? clicked / comms.length : 0
    };
  });

  const orderAov = average(state.orders.map((order) => order.amount));

  return {
    summary: {
      customers: state.customers.length,
      orders: state.orders.length,
      spend,
      activeCampaigns,
      completedCampaigns,
      communications: totalCommunications,
      deliveryRate: totalCommunications ? deliveredCommunications / totalCommunications : 0,
      clickRate: totalCommunications ? clickedCommunications / totalCommunications : 0,
      orderAov
    },
    topCustomers,
    channelBreakdown,
    campaigns: campaignSummaries
  };
}

function createCampaignFromAudience(state, payload) {
  const segment = payload.segmentId ? getSegmentById(state, payload.segmentId) : null;
  const audience = payload.recipientIds
    ? state.customers.filter((customer) => payload.recipientIds.includes(customer.id))
    : segment
      ? getAudienceMembers(state, segment)
      : [];

  return {
    campaign: {
      id: uid('cam'),
      name: payload.name,
      segmentId: segment ? segment.id : null,
      audienceSize: audience.length,
      channel: payload.channel,
      subject: payload.subject,
      message: payload.message,
      offer: payload.offer || '',
      aiSummary: payload.aiSummary || '',
      status: 'draft',
      scheduledFor: payload.scheduledFor || null,
      createdAt: new Date().toISOString(),
      metrics: {
        sent: 0,
        delivered: 0,
        opened: 0,
        read: 0,
        clicked: 0,
        failed: 0,
        attributedOrders: 0,
        revenueAttributed: 0
      }
    },
    audience
  };
}

function enrichCampaign(state, campaign) {
  return {
    ...campaign,
    metrics: computeCampaignMetrics(state, campaign),
    audience: campaign.segmentId ? getAudienceMembers(state, getSegmentById(state, campaign.segmentId) || { rules: { kind: 'unknown' } }) : []
  };
}

module.exports = {
  uid,
  isoDaysAgo,
  isoMinutesAgo,
  daysBetween,
  createSeedState,
  getCustomerOrders,
  getOrderMetrics,
  evaluateSegment,
  getAudienceMembers,
  getSegmentById,
  getCampaignById,
  getCommunicationsByCampaign,
  computeCampaignMetrics,
  computeDashboard,
  createCampaignFromAudience,
  enrichCampaign,
  CHANNELS
};
