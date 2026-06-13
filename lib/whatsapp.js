const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'whatsapp-config.json');

const config = {
  provider: (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase(),
  metaPhoneId: process.env.WHATSAPP_PHONE_ID || '',
  metaAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  metaApiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM || ''
};

// Try loading from file to override defaults
try {
  if (fs.existsSync(configPath)) {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    updateConfig(saved, false);
  }
} catch (e) {
  console.error('[whatsapp] Failed to load config file:', e.message);
}

function getConfig() {
  return config;
}

function updateConfig(newConfig = {}, saveToFile = true) {
  if (newConfig.provider) config.provider = String(newConfig.provider).toLowerCase();
  if (newConfig.metaPhoneId !== undefined) config.metaPhoneId = String(newConfig.metaPhoneId);
  if (newConfig.metaAccessToken !== undefined) config.metaAccessToken = String(newConfig.metaAccessToken);
  if (newConfig.metaApiVersion !== undefined) config.metaApiVersion = String(newConfig.metaApiVersion);
  if (newConfig.twilioAccountSid !== undefined) config.twilioAccountSid = String(newConfig.twilioAccountSid);
  if (newConfig.twilioAuthToken !== undefined) config.twilioAuthToken = String(newConfig.twilioAuthToken);
  if (newConfig.twilioWhatsappFrom !== undefined) config.twilioWhatsappFrom = String(newConfig.twilioWhatsappFrom);

  if (saveToFile) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('[whatsapp] Failed to save config file:', e.message);
    }
  }
}

function isConfigured() {
  if (config.provider === 'twilio') {
    return !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioWhatsappFrom) &&
           !config.twilioAccountSid.startsWith('YOUR_');
  }
  return !!(config.metaPhoneId && config.metaAccessToken) &&
         !config.metaPhoneId.startsWith('YOUR_') &&
         !config.metaAccessToken.startsWith('YOUR_');
}

function normalizePhone(phone) {
  // Strip spaces and ensure leading +
  let cleaned = String(phone || '').replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function sendViaMeta(to, body) {
  const url = `https://graph.facebook.com/${config.metaApiVersion}/${config.metaPhoneId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.metaAccessToken}`
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
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
  const credentials = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const formData = new URLSearchParams({
    From: `whatsapp:${config.twilioWhatsappFrom}`,
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
  if (config.provider === 'twilio') {
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
  getConfig,
  updateConfig,
  get PROVIDER() { return config.provider; }
};
