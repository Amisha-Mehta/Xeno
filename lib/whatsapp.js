const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const configPath = path.join(DATA_DIR, 'whatsapp-config.json');

const config = {
  provider: (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase(),
  metaPhoneId: process.env.WHATSAPP_PHONE_ID || '',
  metaAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  metaApiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  metaTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || '',
  metaTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
  metaUseTemplateForCampaigns: String(process.env.WHATSAPP_USE_TEMPLATE_FOR_CAMPAIGNS || 'false').toLowerCase() === 'true',
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
  if (newConfig.metaTemplateName !== undefined) config.metaTemplateName = String(newConfig.metaTemplateName);
  if (newConfig.metaTemplateLanguage !== undefined) config.metaTemplateLanguage = String(newConfig.metaTemplateLanguage);
  if (newConfig.metaUseTemplateForCampaigns !== undefined) {
    config.metaUseTemplateForCampaigns = !!newConfig.metaUseTemplateForCampaigns;
  }
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
  // Strip spaces and normalize local 10-digit Indian numbers to +91 format.
  let cleaned = String(phone || '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }
  if (!cleaned.startsWith('+')) {
    cleaned = cleaned.length === 10 ? `+91${cleaned}` : `+${cleaned}`;
  }
  return cleaned;
}

function hasTemplateConfig() {
  return !!(config.metaTemplateName && config.metaTemplateLanguage);
}

async function postMetaMessage(payload) {
  const url = `https://graph.facebook.com/${config.metaApiVersion}/${config.metaPhoneId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.metaAccessToken}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMsg = result.error?.message || `Meta API error ${response.status}`;
      console.error(`[whatsapp] Meta API error: ${errorMsg}`, { 
        code: result.error?.code, 
        subcode: result.error?.error_subcode,
        to: payload.to
      });
      return {
        success: false,
        error: errorMsg,
        provider: 'meta',
        errorCode: result.error?.code || null,
        errorSubcode: result.error?.error_subcode || null
      };
    }

    console.log(`[whatsapp] Message sent successfully to ${payload.to}, ID: ${result.messages?.[0]?.id}`);
    return {
      success: true,
      messageId: result.messages?.[0]?.id || null,
      provider: 'meta'
    };
  } catch (err) {
    console.error(`[whatsapp] Network/fetch error: ${err.message}`);
    return { success: false, error: err.message, provider: 'meta' };
  }
}

async function sendViaMetaText(to, body) {
  return postMetaMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(to),
    type: 'text',
    text: { preview_url: false, body }
  });
}

function buildTemplateComponents(customer, body) {
  if (!body) return undefined;
  
  // Only attempt to build parameters if the body contains a valid {{variable}}
  const hasValidVariable = /\{\{\w+\}\}/.test(body);
  if (!hasValidVariable) {
    // If they typed something broken like "Hii {{" we just don't pass components.
    // The Meta API will either accept it as a template with no variables, 
    // or fail clearly rather than us breaking during parsing.
    return undefined;
  }

  return [{
    type: 'body',
    parameters: [{
      type: 'text',
      text: customer?.name?.split(' ')?.[0] || 'Customer'
    }]
  }];
}

async function sendViaMetaTemplate(to, body, customer) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(to),
    type: 'template',
    template: {
      name: config.metaTemplateName,
      language: {
        code: config.metaTemplateLanguage
      }
    }
  };

  const components = buildTemplateComponents(customer, body || '');
  if (components) {
    payload.template.components = components;
  }

  const result = await postMetaMessage(payload);
  if (result.success) {
    result.usedTemplate = true;
    result.templateName = config.metaTemplateName;
  }
  return result;
}

function shouldRetryWithTemplate(errorMessage = '') {
  const text = String(errorMessage || '').toLowerCase();
  return text.includes('template')
    || text.includes('24-hour')
    || text.includes('24 hour')
    || text.includes('outside')
    || text.includes('re-engagement message')
    || text.includes('marketing message')
    || text.includes('business-initiated');
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

async function sendMessage(to, body, options = {}) {
  if (!isConfigured()) {
    return { success: false, error: 'WhatsApp not configured', provider: 'none' };
  }
  if (config.provider === 'twilio') {
    return sendViaTwilio(to, body);
  }

  const wantsTemplate = options.useTemplate === true || config.metaUseTemplateForCampaigns === true;
  if (wantsTemplate && hasTemplateConfig()) {
    return sendViaMetaTemplate(to, body, options.customer);
  }

  const textResult = await sendViaMetaText(to, body);
  if (!textResult.success && hasTemplateConfig() && shouldRetryWithTemplate(textResult.error)) {
    const templateResult = await sendViaMetaTemplate(to, body, options.customer);
    if (templateResult.success) {
      return templateResult;
    }
  }

  return textResult;
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
  hasTemplateConfig,
  sendMessage,
  normalizePhone,
  parseMetaWebhook,
  parseTwilioWebhook,
  getConfig,
  updateConfig,
  get PROVIDER() { return config.provider; }
};
