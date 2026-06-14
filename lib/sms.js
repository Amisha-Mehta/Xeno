const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const configPath = path.join(DATA_DIR, 'sms-config.json');

const config = {
  provider: (process.env.SMS_PROVIDER || 'twilio').toLowerCase(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || ''
};

try {
  if (fs.existsSync(configPath)) {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    updateConfig(saved, false);
  }
} catch (error) {
  console.error('[sms] Failed to load config file:', error.message);
}

function getConfig() {
  return config;
}

function updateConfig(newConfig = {}, saveToFile = true) {
  if (newConfig.provider) config.provider = String(newConfig.provider).toLowerCase();
  if (newConfig.twilioAccountSid !== undefined) config.twilioAccountSid = String(newConfig.twilioAccountSid);
  if (newConfig.twilioAuthToken !== undefined) config.twilioAuthToken = String(newConfig.twilioAuthToken);
  if (newConfig.twilioPhoneNumber !== undefined) config.twilioPhoneNumber = String(newConfig.twilioPhoneNumber);

  if (saveToFile) {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('[sms] Failed to save config file:', error.message);
    }
  }
}

function isConfigured() {
  return config.provider === 'twilio'
    && !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioPhoneNumber)
    && !config.twilioAccountSid.startsWith('YOUR_');
}

async function sendViaTwilio(to, message) {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      To: to,
      From: config.twilioPhoneNumber,
      Body: message || ' '
    }).toString();

    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = require('https').request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseBody);
            resolve({ success: true, messageId: parsed.sid, provider: 'twilio' });
          } catch(e) {
            resolve({ success: true, messageId: null, provider: 'twilio' });
          }
        } else {
          console.error('[sms] Twilio API error:', res.statusCode, responseBody);
          resolve({ success: false, error: `Twilio API Error ${res.statusCode}`, provider: 'twilio' });
        }
      });
    });

    req.on('error', (error) => {
      console.error('[sms] Error connecting to Twilio:', error);
      resolve({ success: false, error: error.message || String(error), provider: 'twilio' });
    });

    req.write(postData);
    req.end();
  });
}

async function sendMessage(to, message) {
  if (!isConfigured()) {
    return { success: false, error: 'SMS not configured', provider: 'none' };
  }
  return sendViaTwilio(to, message);
}

module.exports = {
  getConfig,
  updateConfig,
  isConfigured,
  sendMessage,
  get PROVIDER() {
    return config.provider;
  }
};
