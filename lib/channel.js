const { uid } = require('./store');

const CHANNEL_PROFILES = {
  whatsapp: { deliver: 0.96, open: 0.74, read: 0.68, click: 0.27, order: 0.24 },
  sms: { deliver: 0.93, open: 0.38, read: 0.24, click: 0.11, order: 0.14 },
  email: { deliver: 0.91, open: 0.52, read: 0.36, click: 0.19, order: 0.18 },
  rcs: { deliver: 0.95, open: 0.66, read: 0.49, click: 0.23, order: 0.21 }
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickProfile(channel) {
  return CHANNEL_PROFILES[channel] || CHANNEL_PROFILES.whatsapp;
}

function scheduleReceipt(onReceipt, payload, delay) {
  return setTimeout(() => onReceipt(payload), delay);
}

function sendCampaign({ campaign, communications, onReceipt, renderMessage }) {
  const profile = pickProfile(campaign.channel);
  const receipts = [];

  communications.forEach((communication, index) => {
    const customer = communication.customer;
    const baseDelay = 500 + index * 120;
    const shouldDeliver = Math.random() < profile.deliver;
    const deliveryEvent = {
      id: uid('evt'),
      campaignId: campaign.id,
      communicationId: communication.id,
      customerId: customer.id,
      channel: campaign.channel,
      type: shouldDeliver ? 'delivered' : 'failed',
      timestamp: new Date().toISOString(),
      meta: { attempt: 1 }
    };

    receipts.push(deliveryEvent);
    scheduleReceipt(onReceipt, deliveryEvent, baseDelay + randomBetween(400, 1400));

    if (!shouldDeliver) {
      return;
    }

    if (Math.random() < profile.open) {
      const openEvent = {
        id: uid('evt'),
        campaignId: campaign.id,
        communicationId: communication.id,
        customerId: customer.id,
        channel: campaign.channel,
        type: 'opened',
        timestamp: new Date().toISOString()
      };
      receipts.push(openEvent);
      scheduleReceipt(onReceipt, openEvent, baseDelay + randomBetween(1400, 3200));
    }

    if (Math.random() < profile.read) {
      const readEvent = {
        id: uid('evt'),
        campaignId: campaign.id,
        communicationId: communication.id,
        customerId: customer.id,
        channel: campaign.channel,
        type: 'read',
        timestamp: new Date().toISOString()
      };
      receipts.push(readEvent);
      scheduleReceipt(onReceipt, readEvent, baseDelay + randomBetween(2600, 4600));
    }

    if (Math.random() < profile.click) {
      const clickEvent = {
        id: uid('evt'),
        campaignId: campaign.id,
        communicationId: communication.id,
        customerId: customer.id,
        channel: campaign.channel,
        type: 'clicked',
        timestamp: new Date().toISOString()
      };
      receipts.push(clickEvent);
      scheduleReceipt(onReceipt, clickEvent, baseDelay + randomBetween(3600, 6400));

      if (Math.random() < profile.order) {
        const orderEvent = {
          id: uid('evt'),
          campaignId: campaign.id,
          communicationId: communication.id,
          customerId: customer.id,
          channel: campaign.channel,
          type: 'attributed_order',
          timestamp: new Date().toISOString(),
          meta: {
            amount: Math.round(randomBetween(1800, 9200) / 100) * 100,
            product: renderMessage?.(customer) || 'Attributed purchase'
          }
        };
        receipts.push(orderEvent);
        scheduleReceipt(onReceipt, orderEvent, baseDelay + randomBetween(5400, 8800));
      }
    }
  });

  return receipts;
}

module.exports = {
  sendCampaign
};
