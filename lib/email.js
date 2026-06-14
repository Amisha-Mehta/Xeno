const fs = require('fs');
const path = require('path');
const tls = require('tls');

const configPath = path.join(__dirname, '..', 'data', 'email-config.json');

const config = {
  provider: (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase(),
  gmailAddress: process.env.EMAIL_GMAIL_ADDRESS || '',
  gmailAppPassword: process.env.EMAIL_GMAIL_APP_PASSWORD || '',
  gmailFromName: process.env.EMAIL_GMAIL_FROM_NAME || 'Xeno CRM',
  smtpHost: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.EMAIL_SMTP_PORT || 465),
  useGmailForCampaigns: String(process.env.EMAIL_USE_GMAIL_FOR_CAMPAIGNS || 'true').toLowerCase() === 'true'
};

try {
  if (fs.existsSync(configPath)) {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    updateConfig(saved, false);
  }
} catch (error) {
  console.error('[email] Failed to load config file:', error.message);
}

function getConfig() {
  return config;
}

function updateConfig(newConfig = {}, saveToFile = true) {
  if (newConfig.provider) config.provider = String(newConfig.provider).toLowerCase();
  if (newConfig.gmailAddress !== undefined) config.gmailAddress = String(newConfig.gmailAddress);
  if (newConfig.gmailAppPassword !== undefined) config.gmailAppPassword = String(newConfig.gmailAppPassword);
  if (newConfig.gmailFromName !== undefined) config.gmailFromName = String(newConfig.gmailFromName);
  if (newConfig.smtpHost !== undefined) config.smtpHost = String(newConfig.smtpHost);
  if (newConfig.smtpPort !== undefined) config.smtpPort = Number(newConfig.smtpPort) || 465;
  if (newConfig.useGmailForCampaigns !== undefined) config.useGmailForCampaigns = !!newConfig.useGmailForCampaigns;

  if (saveToFile) {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('[email] Failed to save config file:', error.message);
    }
  }
}

function isConfigured() {
  return config.provider === 'gmail'
    && !!(config.gmailAddress && config.gmailAppPassword)
    && !config.gmailAddress.startsWith('YOUR_')
    && !config.gmailAppPassword.startsWith('YOUR_');
}

function shouldUseGmailForCampaigns() {
  return config.useGmailForCampaigns;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function encodeSubject(subject) {
  const value = String(subject || '').trim();
  if (!value) return 'Xeno CRM campaign';
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage({ to, subject, body }) {
  const normalizedBody = String(body || '')
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');

  return [
    `From: "${config.gmailFromName}" <${config.gmailAddress}>`,
    `To: ${normalizeEmail(to)}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedBody
  ].join('\r\n');
}

function createSmtpSession() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: config.smtpHost,
      port: config.smtpPort,
      servername: config.smtpHost,
      timeout: 15000
    });

    socket.setEncoding('utf8');

    let buffer = '';
    let lineBuffer = [];
    const pendingResponses = [];
    let currentResolver = null;
    let currentRejecter = null;

    const flushResponse = (response) => {
      if (currentResolver) {
        const resolveCurrent = currentResolver;
        currentResolver = null;
        currentRejecter = null;
        resolveCurrent(response);
      } else {
        pendingResponses.push(response);
      }
    };

    const readResponse = () => {
      if (pendingResponses.length) {
        return Promise.resolve(pendingResponses.shift());
      }

      return new Promise((resolve, reject) => {
        currentResolver = resolve;
        currentRejecter = reject;
      });
    };

    const handleLine = (line) => {
      if (!line) return;
      lineBuffer.push(line);
      if (/^\d{3} /.test(line)) {
        const response = {
          code: Number(line.slice(0, 3)),
          lines: lineBuffer.slice(),
          text: lineBuffer.join('\n')
        };
        lineBuffer = [];
        flushResponse(response);
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        handleLine(rawLine.replace(/\r$/, ''));
      }
    });

    socket.on('error', (error) => {
      if (currentRejecter) {
        const rejectCurrent = currentRejecter;
        currentResolver = null;
        currentRejecter = null;
        rejectCurrent(error);
      } else {
        reject(error);
      }
    });

    socket.on('close', () => {
      if (currentRejecter) {
        const rejectCurrent = currentRejecter;
        currentResolver = null;
        currentRejecter = null;
        rejectCurrent(new Error('SMTP connection closed unexpectedly'));
      }
    });

    socket.once('secureConnect', async () => {
      try {
        const greeting = await readResponse();
        if (greeting.code !== 220) throw new Error(greeting.text || 'SMTP greeting failed');

        resolve({
          async command(line, expectedCodes = []) {
            socket.write(`${line}\r\n`);
            const response = await readResponse();
            if (expectedCodes.length && !expectedCodes.includes(response.code)) {
              throw new Error(response.text || `SMTP error ${response.code}`);
            }
            return response;
          },
          async data(message) {
            socket.write(`${message.replace(/\r?\n/g, '\r\n')}\r\n.\r\n`);
            const response = await readResponse();
            if (response.code !== 250) {
              throw new Error(response.text || `SMTP error ${response.code}`);
            }
            return response;
          },
          end() {
            socket.end('QUIT\r\n');
          }
        });
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}

async function sendViaGmail(to, subject, body) {
  let client;
  try {
    client = await createSmtpSession();
    await client.command(`EHLO localhost`, [250]);
    await client.command('AUTH LOGIN', [334]);
    await client.command(Buffer.from(normalizeEmail(config.gmailAddress), 'utf8').toString('base64'), [334]);
    await client.command(Buffer.from(config.gmailAppPassword, 'utf8').toString('base64'), [235]);
    await client.command(`MAIL FROM:<${normalizeEmail(config.gmailAddress)}>` , [250]);
    await client.command(`RCPT TO:<${normalizeEmail(to)}>` , [250, 251]);
    await client.command('DATA', [354]);

    const message = buildMessage({ to, subject, body });
    await client.data(message);
    client.end();

    return {
      success: true,
      messageId: null,
      provider: 'gmail'
    };
  } catch (error) {
    if (client) client.end();
    return {
      success: false,
      error: error.message,
      provider: 'gmail'
    };
  }
}

async function sendMessage(to, subject, body) {
  if (!isConfigured()) {
    return { success: false, error: 'Gmail not configured', provider: 'none' };
  }
  return sendViaGmail(to, subject, body);
}

module.exports = {
  getConfig,
  updateConfig,
  isConfigured,
  shouldUseGmailForCampaigns,
  normalizeEmail,
  sendMessage,
  get PROVIDER() {
    return config.provider;
  }
};
