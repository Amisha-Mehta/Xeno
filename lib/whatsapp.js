// ---------------------------------------------------------------------------
// WhatsApp provider abstraction
// Supports Meta Cloud API (default) and Twilio.
// Falls back gracefully when not configured.
// ---------------------------------------------------------------------------

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();

// Meta Cloud API config
const META_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const META_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const META_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

// Twilio config
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';

function isConfigured() {
  if (PROVIDER === 'twilio') {
    return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
  }
  return !!(META_PHONE_ID && META_ACCESS_TOKEN);
}

function normalizePhone(phone) {
  // Strip spaces and ensure leading +
  let cleaned = String(phone || '').replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function sendViaMeta(to, body) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_ID}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${META_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizePhone(to),
        type: 'text',
        text: { preview_url: false, body }
      }),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: result.error?.message || `Meta API error ${response.status}`,
        provider: 'meta'
      };
    }

    return {
      success: true,
      messageId: result.messages?.[0]?.id || null,
      provider: 'meta'
    };
  } catch (err) {
    return { success: false, error: err.message, provider: 'meta' };
  }
}

async function sendViaTwilio(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const formData = new URLSearchParams({
    From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
    To: `whatsapp:${normalizePhone(to)}`,
    Body: body
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: result.message || `Twilio error ${response.status}`,
        provider: 'twilio'
      };
    }

    return {
      success: true,
      messageId: result.sid || null,
      provider: 'twilio'
    };
  } catch (err) {
    return { success: false, error: err.message, provider: 'twilio' };
  }
}

async function sendMessage(to, body) {
  if (!isConfigured()) {
    return { success: false, error: 'WhatsApp not configured', provider: 'none' };
  }
  if (PROVIDER === 'twilio') {
    return sendViaTwilio(to, body);
  }
  return sendViaMeta(to, body);
}

// ---------------------------------------------------------------------------
// Webhook payload parsers
// ---------------------------------------------------------------------------

/**
 * Parse a Meta Cloud API webhook status update into CRM receipt format.
 * Returns an array of receipt-like objects.
 */
function parseMetaWebhook(body) {
  const receipts = [];
  const entries = body?.entry || [];
  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const statuses = change?.value?.statuses || [];
      for (const status of statuses) {
        const typeMap = {
          sent: 'delivered',
          delivered: 'delivered',
          read: 'read',
          failed: 'failed'
        };
        const type = typeMap[status.status] || status.status;
        receipts.push({
          externalId: status.id,
          recipientPhone: status.recipient_id,
          type,
          timestamp: status.timestamp
            ? new Date(Number(status.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
          errors: status.errors || []
        });
      }
    }
  }
  return receipts;
}

/**
 * Parse a Twilio status callback into CRM receipt format.
 */
function parseTwilioWebhook(body) {
  const typeMap = {
    queued: 'sent',
    sent: 'delivered',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
    undelivered: 'failed'
  };
  return [{
    externalId: body.MessageSid || body.SmsSid || '',
    recipientPhone: (body.To || '').replace('whatsapp:', ''),
    type: typeMap[body.MessageStatus] || body.MessageStatus || 'delivered',
    timestamp: new Date().toISOString(),
    errors: body.ErrorCode ? [{ code: body.ErrorCode, message: body.ErrorMessage || '' }] : []
  }];
}

module.exports = {
  isConfigured,
  sendMessage,
  normalizePhone,
  parseMetaWebhook,
  parseTwilioWebhook,
  PROVIDER
};
