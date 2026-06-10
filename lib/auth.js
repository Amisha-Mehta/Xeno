const crypto = require('crypto');

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------
const sessions = new Map();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@xeno.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_COOKIE = 'xeno_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function createSession(role, id, extra = {}) {
  const token = crypto.randomUUID();
  sessions.set(token, { role, id, createdAt: Date.now(), ...extra });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return getSession(cookies[SESSION_COOKIE]);
}

function setSessionCookie(res, token) {
  const existing = res.getHeader('Set-Cookie') || [];
  const cookies = Array.isArray(existing) ? existing : [existing].filter(Boolean);
  cookies.push(`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  res.setHeader('Set-Cookie', cookies);
}

function clearSessionCookie(res) {
  const existing = res.getHeader('Set-Cookie') || [];
  const cookies = Array.isArray(existing) ? existing : [existing].filter(Boolean);
  cookies.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.setHeader('Set-Cookie', cookies);
}

// ---------------------------------------------------------------------------
// Auth validators
// ---------------------------------------------------------------------------

function validateAdmin(email, password) {
  return (
    typeof email === 'string' &&
    typeof password === 'string' &&
    email.toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
    password === ADMIN_PASSWORD
  );
}

function findCustomerByCredentials(state, email, phone) {
  if (!email || !phone) return null;
  const normalEmail = String(email).toLowerCase().trim();
  const normalPhone = String(phone).replace(/\s+/g, '').trim();
  return state.customers.find((c) => {
    const cEmail = String(c.email || '').toLowerCase().trim();
    const cPhone = String(c.phone || '').replace(/\s+/g, '').trim();
    return cEmail === normalEmail && cPhone === normalPhone;
  }) || null;
}

// ---------------------------------------------------------------------------
// Middleware-style checks
// ---------------------------------------------------------------------------

function requireAdmin(req) {
  const session = getSessionFromRequest(req);
  if (!session || session.role !== 'admin') return null;
  return session;
}

function requireCustomer(req) {
  const session = getSessionFromRequest(req);
  if (!session || session.role !== 'customer') return null;
  return session;
}

function requireAnyAuth(req) {
  return getSessionFromRequest(req);
}

module.exports = {
  ADMIN_EMAIL,
  SESSION_COOKIE,
  sessions,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  validateAdmin,
  findCustomerByCredentials,
  requireAdmin,
  requireCustomer,
  requireAnyAuth
};
