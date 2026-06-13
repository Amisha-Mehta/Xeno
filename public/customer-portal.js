/* ================================================================
   Loom & Lane — Customer Portal JavaScript
   All tabs: Dashboard, Shop & Orders, Profile, AI Chat, Rewards
   ================================================================ */

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function safe(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(v) {
  return new Date(v).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return (name || '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(20px)'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── API Helper ──
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location.href = '/customer-login.html';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── State ──
let profile = {};
let orders = [];
let messages = [];
let chatHistory = [];

// ── Shop Catalog ──
const CATALOG = [
  { id: 'linen-jacket', name: 'Linen Blend Jacket', price: 4200, category: 'outerwear', emoji: '🧥' },
  { id: 'silk-kurta', name: 'Silk Print Kurta', price: 3800, category: 'ethnic', emoji: '👘' },
  { id: 'cashmere-scarf', name: 'Cashmere Scarf Set', price: 2600, category: 'accessories', emoji: '🧣' },
  { id: 'cotton-shirt', name: 'Handloom Cotton Shirt', price: 1900, category: 'casual', emoji: '👔' },
  { id: 'denim-jeans', name: 'Premium Stretch Denim', price: 3200, category: 'bottoms', emoji: '👖' },
  { id: 'leather-belt', name: 'Artisan Leather Belt', price: 1500, category: 'accessories', emoji: '🔶' },
];

// ── Boot ──
async function boot() {
  try {
    const [p, o, m] = await Promise.all([
      api('/api/customer/profile'),
      api('/api/customer/orders'),
      api('/api/customer/messages'),
    ]);
    profile = p;
    orders = (o.orders || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    messages = m.messages || [];

    updateSidebar();
    renderDashboard();
    setupNav();
    document.getElementById('loadingState').style.display = 'none';
  } catch (err) {
    if (err.message !== 'Not authenticated') {
      document.getElementById('mainContent').innerHTML = `<div class="empty-state"><p>Failed to load portal. ${safe(err.message)}</p></div>`;
    }
  }
}

// ── Sidebar ──
function updateSidebar() {
  document.getElementById('sidebarName').textContent = profile.name || 'Customer';
  const tier = profile.loyaltyTier || 'bronze';
  const tierEl = document.getElementById('sidebarTier');
  tierEl.textContent = `${tier.toUpperCase()} • ${(profile.loyaltyPoints || 0).toLocaleString()} pts`;
  tierEl.className = `sidebar-user-tier tier-${tier}`;
  document.getElementById('pointsBadge').textContent = profile.loyaltyPoints || 0;
}

// ── Navigation ──
function setupNav() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      const tab = item.dataset.tab;
      renderTab(tab);
    });
  });
}

function renderTab(tab) {
  const renderers = {
    dashboard: renderDashboard,
    shop: renderShop,
    profile: renderProfile,
    chat: renderChat,
    rewards: renderRewards,
  };
  (renderers[tab] || renderDashboard)();
}

// ══════════════════════════════════════════════
//  TAB 1: DASHBOARD
// ══════════════════════════════════════════════
function renderDashboard() {
  const m = profile.metrics || {};
  const tier = profile.loyaltyTier || 'bronze';
  const points = profile.loyaltyPoints || 0;
  const nextTier = tier === 'gold' ? null : tier === 'silver' ? 'gold' : 'silver';
  const nextThreshold = tier === 'gold' ? 0 : tier === 'silver' ? 500 : 200;
  const progress = nextTier ? Math.min(100, (points / nextThreshold) * 100) : 100;

  document.getElementById('mainContent').innerHTML = `
    <div class="tab-view active" id="viewDashboard">
      <div class="page-header">
        <h2>Welcome back, ${safe((profile.name || '').split(' ')[0])} 👋</h2>
        <p>Here's your Loom & Lane account overview.</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(16,185,129,0.1);">
            <svg width="20" height="20" fill="none" stroke="#10b981" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1"></path></svg>
          </div>
          <div class="stat-label">Total Spent</div>
          <div class="stat-value">${money.format(m.totalSpend || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(99,102,241,0.1);">
            <svg width="20" height="20" fill="none" stroke="#6366f1" stroke-width="2" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
          </div>
          <div class="stat-label">Orders</div>
          <div class="stat-value">${m.orderCount || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245,158,11,0.1);">
            <svg width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="2" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg>
          </div>
          <div class="stat-label">Loyalty Points</div>
          <div class="stat-value">${points.toLocaleString()}</div>
          <div class="stat-sub">${tier.toUpperCase()} Tier</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(236,72,153,0.1);">
            <svg width="20" height="20" fill="none" stroke="#ec4899" stroke-width="2" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>
          </div>
          <div class="stat-label">Avg Order</div>
          <div class="stat-value">${money.format(m.averageOrderValue || 0)}</div>
        </div>
      </div>

      <div class="content-grid">
        <div class="card">
          <div class="card-title">🏆 Loyalty Progress</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--text);">${points.toLocaleString()} points</div>
          <div class="loyalty-progress">
            <div class="loyalty-bar-bg">
              <div class="loyalty-bar-fill" style="width: ${progress}%;"></div>
            </div>
            <div class="loyalty-tier-info">
              <span>${tier.toUpperCase()}</span>
              <span>${nextTier ? `${nextThreshold - points > 0 ? nextThreshold - points : 0} pts to ${nextTier.toUpperCase()}` : '🎉 Max Tier!'}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">⚡ Quick Actions</div>
          <div class="quick-actions">
            <div class="quick-action" onclick="document.querySelector('[data-tab=shop]').click()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
              Browse Shop
            </div>
            <div class="quick-action" onclick="document.querySelector('[data-tab=chat]').click()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
              Ask AI
            </div>
            <div class="quick-action" onclick="document.querySelector('[data-tab=profile]').click()">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              Settings
            </div>
          </div>
        </div>

        <div class="card content-grid-full">
          <div class="card-title">📦 Recent Orders</div>
          ${orders.length ? `
            <div class="orders-list">
              ${orders.slice(0, 4).map((o) => `
                <div class="order-row">
                  <div>
                    <div class="order-product">${safe(o.product)}</div>
                    <div class="order-category">${safe(o.category)}</div>
                  </div>
                  <div class="order-amount">${money.format(o.amount)}</div>
                  <div class="order-date">${fmtDate(o.createdAt)}</div>
                  <div><span class="order-status status-${o.status}">${safe(o.status)}</span></div>
                  <div></div>
                </div>
              `).join('')}
            </div>
            ${orders.length > 4 ? '<div style="text-align:center; margin-top:12px;"><a href="#" onclick="document.querySelector(\'[data-tab=shop]\').click(); return false;" style="color:var(--accent);font-size:12px;font-weight:600;text-decoration:none;">View all orders →</a></div>' : ''}
          ` : '<div class="empty-state">No orders yet. Visit the Shop to start your journey!</div>'}
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════
//  TAB 2: SHOP & ORDERS
// ══════════════════════════════════════════════
function renderShop() {
  document.getElementById('mainContent').innerHTML = `
    <div class="tab-view active" id="viewShop">
      <div class="page-header">
        <h2>Shop & Orders 🛍️</h2>
        <p>Browse our curated collection and manage your orders.</p>
      </div>

      <div class="card-title" style="margin-bottom:12px;">BROWSE COLLECTION</div>
      <div class="shop-grid" id="shopGrid">
        ${CATALOG.map((item) => `
          <div class="shop-item">
            <span class="shop-emoji">${item.emoji}</span>
            <div class="shop-name">${safe(item.name)}</div>
            <div class="shop-price">${money.format(item.price)}</div>
            <div class="shop-points">Earn ${Math.floor(item.price / 10)} pts</div>
            <button class="shop-btn" onclick="placeOrder('${item.id}')">Add to Cart & Buy</button>
          </div>
        `).join('')}
      </div>

      <div class="card-title" style="margin-bottom:12px;">ORDER HISTORY</div>
      <div class="orders-header">
        <div>Product</div>
        <div>Amount</div>
        <div>Date</div>
        <div>Status</div>
        <div>Action</div>
      </div>
      <div class="orders-list" id="ordersList">
        ${renderOrderRows()}
      </div>
    </div>
  `;
}

function renderOrderRows() {
  if (!orders.length) return '<div class="empty-state">No orders yet. Browse our collection above!</div>';
  return orders.map((o) => `
    <div class="order-row" id="order-${o.id}">
      <div>
        <div class="order-product">${safe(o.product)}</div>
        <div class="order-category">${safe(o.category)}</div>
      </div>
      <div class="order-amount">${money.format(o.amount)}</div>
      <div class="order-date">${fmtDate(o.createdAt)}</div>
      <div><span class="order-status status-${o.status}">${safe(o.status)}</span></div>
      <div>
        ${o.status === 'paid' ? `<button class="cancel-btn" onclick="cancelOrder('${o.id}')">Cancel</button>` : '<span style="font-size:11px;color:var(--text-muted);">—</span>'}
      </div>
    </div>
  `).join('');
}

async function placeOrder(itemId) {
  const item = CATALOG.find((i) => i.id === itemId);
  if (!item) return;
  
  // Disable all shop buttons during order
  document.querySelectorAll('.shop-btn').forEach((b) => b.disabled = true);
  
  try {
    const data = await api('/api/customer/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: item.name, amount: item.price, category: item.category })
    });
    
    orders.unshift(data.order);
    profile.loyaltyPoints = data.loyaltyPoints;
    profile.metrics.totalSpend = (profile.metrics.totalSpend || 0) + item.price;
    profile.metrics.orderCount = (profile.metrics.orderCount || 0) + 1;
    
    // Auto-upgrade tier
    if (profile.loyaltyPoints >= 500) profile.loyaltyTier = 'gold';
    else if (profile.loyaltyPoints >= 200) profile.loyaltyTier = 'silver';
    
    updateSidebar();
    showToast(`Order placed! +${data.pointsEarned} loyalty points earned 🎉`, 'success');
    
    // Re-render order list
    const ordersList = document.getElementById('ordersList');
    if (ordersList) ordersList.innerHTML = renderOrderRows();
  } catch (err) {
    showToast(err.message || 'Failed to place order', 'error');
  } finally {
    document.querySelectorAll('.shop-btn').forEach((b) => b.disabled = false);
  }
}
window.placeOrder = placeOrder;

async function cancelOrder(orderId) {
  try {
    const data = await api(`/api/customer/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const idx = orders.findIndex((o) => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = 'cancelled';
      profile.loyaltyPoints = data.loyaltyPoints;
      profile.metrics.totalSpend = Math.max(0, (profile.metrics.totalSpend || 0) - orders[idx].amount);
      
      // Re-check tier
      if (profile.loyaltyPoints < 200) profile.loyaltyTier = 'bronze';
      else if (profile.loyaltyPoints < 500) profile.loyaltyTier = 'silver';
    }
    
    updateSidebar();
    showToast(`Order cancelled. ${data.pointsDeducted} points deducted.`, 'info');
    
    const ordersList = document.getElementById('ordersList');
    if (ordersList) ordersList.innerHTML = renderOrderRows();
  } catch (err) {
    showToast(err.message || 'Failed to cancel order', 'error');
  }
}
window.cancelOrder = cancelOrder;

// ══════════════════════════════════════════════
//  TAB 3: PROFILE
// ══════════════════════════════════════════════
function renderProfile() {
  document.getElementById('mainContent').innerHTML = `
    <div class="tab-view active" id="viewProfile">
      <div class="page-header">
        <h2>Profile Settings ⚙️</h2>
        <p>Manage your account information and communication preferences.</p>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div class="card-title">Account Information</div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
          <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#a5b4fc,#6366f1);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:20px;">${initials(profile.name)}</div>
          <div>
            <div style="font-size:18px;font-weight:700;color:var(--text);">${safe(profile.name)}</div>
            <div style="font-size:12px;color:var(--text-dim);">${safe(profile.email)} • ${safe(profile.source || 'Customer')}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Member since ${profile.createdAt ? fmtDate(profile.createdAt) : 'N/A'}</div>
          </div>
        </div>

        <form id="profileForm">
          <div class="profile-grid">
            <div class="profile-field">
              <label for="profName">Full Name</label>
              <input type="text" id="profName" value="${safe(profile.name)}" required>
            </div>
            <div class="profile-field">
              <label for="profPhone">Phone</label>
              <input type="tel" id="profPhone" value="${safe(profile.phone)}" required>
            </div>
            <div class="profile-field">
              <label for="profCity">City</label>
              <input type="text" id="profCity" value="${safe(profile.city)}">
            </div>
            <div class="profile-field">
              <label for="profChannel">Preferred Channel</label>
              <select id="profChannel">
                <option value="whatsapp" ${profile.preferredChannel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
                <option value="sms" ${profile.preferredChannel === 'sms' ? 'selected' : ''}>SMS</option>
                <option value="email" ${profile.preferredChannel === 'email' ? 'selected' : ''}>Email</option>
              </select>
            </div>
            <div class="profile-field profile-field-full">
              <label for="profAddress">Address</label>
              <input type="text" id="profAddress" value="${safe(profile.address || '')}">
            </div>
            <div class="profile-field profile-field-full">
              <label>Communications Opt-In</label>
              <div style="display:flex;align-items:center;gap:12px;">
                <button type="button" class="toggle-switch ${profile.optedIn ? 'active' : ''}" id="optInToggle"></button>
                <span style="font-size:13px;color:var(--text-dim);" id="optInLabel">${profile.optedIn ? 'Opted In — You receive campaigns & promotions' : 'Opted Out — No marketing messages'}</span>
              </div>
            </div>
            <div class="profile-save">
              <button type="submit" class="btn-primary" id="saveProfileBtn">Save Changes</button>
            </div>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-title">Account Details</div>
        <div class="profile-grid">
          <div class="profile-field">
            <label>Email (read-only)</label>
            <input type="email" value="${safe(profile.email)}" disabled style="opacity:0.5;">
          </div>
          <div class="profile-field">
            <label>Customer ID</label>
            <input type="text" value="${safe(profile.id)}" disabled style="opacity:0.5;">
          </div>
          <div class="profile-field">
            <label>Loyalty Tier</label>
            <input type="text" value="${(profile.loyaltyTier || 'bronze').toUpperCase()}" disabled style="opacity:0.5;">
          </div>
          <div class="profile-field">
            <label>Last Active</label>
            <input type="text" value="${profile.lastActive ? fmtDate(profile.lastActive) : 'N/A'}" disabled style="opacity:0.5;">
          </div>
        </div>
      </div>
    </div>
  `;

  // Toggle opt-in
  document.getElementById('optInToggle').addEventListener('click', function() {
    this.classList.toggle('active');
    const isOn = this.classList.contains('active');
    document.getElementById('optInLabel').textContent = isOn ? 'Opted In — You receive campaigns & promotions' : 'Opted Out — No marketing messages';
  });

  // Save profile
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const payload = {
        name: document.getElementById('profName').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        city: document.getElementById('profCity').value.trim(),
        address: document.getElementById('profAddress').value.trim(),
        preferredChannel: document.getElementById('profChannel').value,
        optedIn: document.getElementById('optInToggle').classList.contains('active'),
      };

      await api('/api/customer/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Update local state
      Object.assign(profile, payload);
      updateSidebar();
      showToast('Profile updated successfully! ✅');
    } catch (err) {
      showToast(err.message || 'Failed to save profile', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

// ══════════════════════════════════════════════
//  TAB 4: AI SHOPPING ASSISTANT
// ══════════════════════════════════════════════
function renderChat() {
  document.getElementById('mainContent').innerHTML = `
    <div class="tab-view active" id="viewChat">
      <div class="page-header">
        <h2>AI Shopping Assistant 🤖</h2>
        <p>Your personal Loom & Lane copilot — ask about orders, rewards, or recommendations.</p>
      </div>

      <div class="chat-container">
        <div class="chat-messages" id="chatMessages">
          ${chatHistory.length ? chatHistory.map((m) => `<div class="chat-msg ${m.role}">${m.role === 'bot' ? '<pre>' : ''}${safe(m.text)}${m.role === 'bot' ? '</pre>' : ''}</div>`).join('') : `
            <div class="chat-msg bot">
              <pre>Hello ${safe((profile.name || '').split(' ')[0])}! 👋 I'm your Loom & Lane shopping assistant.

I can help you with:
• 📦 Check your order history
• 🏆 View loyalty points & tier
• 🔥 Get personalized recommendations
• ❓ Answer questions about your account

What would you like to know?</pre>
            </div>
          `}
        </div>
        <div class="chat-input-area">
          <input type="text" class="chat-input" id="chatInput" placeholder="Ask me anything..." autocomplete="off">
          <button class="chat-send" id="chatSendBtn" onclick="sendChat()">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            Send
          </button>
        </div>
      </div>
    </div>
  `;

  // Enter key
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // Scroll to bottom
  const msgs = document.getElementById('chatMessages');
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  btn.disabled = true;

  // Add user message
  chatHistory.push({ role: 'user', text: msg });
  const msgsEl = document.getElementById('chatMessages');
  msgsEl.innerHTML += `<div class="chat-msg user">${safe(msg)}</div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;

  // Add typing indicator
  msgsEl.innerHTML += `<div class="chat-msg bot" id="typingIndicator" style="opacity:0.6;"><pre>Thinking...</pre></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;

  try {
    const data = await api('/api/customer/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });

    // Remove typing indicator
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();

    chatHistory.push({ role: 'bot', text: data.reply });
    msgsEl.innerHTML += `<div class="chat-msg bot"><pre>${safe(data.reply)}</pre></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch (err) {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
    msgsEl.innerHTML += `<div class="chat-msg bot" style="border-color:rgba(239,68,68,0.2);"><pre>Sorry, I couldn't process that. Please try again.</pre></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } finally {
    btn.disabled = false;
    document.getElementById('chatInput')?.focus();
  }
}
window.sendChat = sendChat;

// ══════════════════════════════════════════════
//  TAB 5: REWARDS & CAMPAIGNS
// ══════════════════════════════════════════════
function renderRewards() {
  const points = profile.loyaltyPoints || 0;
  const tier = profile.loyaltyTier || 'bronze';
  const nextTier = tier === 'gold' ? null : tier === 'silver' ? 'gold' : 'silver';
  const nextThreshold = tier === 'gold' ? 0 : tier === 'silver' ? 500 : 200;
  const progress = nextTier ? Math.min(100, (points / nextThreshold) * 100) : 100;

  const tierPerks = {
    bronze: ['Earn 1 pt per ₹10 spent', 'Birthday bonus points', 'Access to seasonal sales'],
    silver: ['All Bronze perks', 'Early access to new collections', 'Exclusive member discounts', '1.5x point multiplier'],
    gold: ['All Silver perks', 'VIP priority support', 'Free shipping on all orders', '2x point multiplier', 'Invite-only events'],
  };

  document.getElementById('mainContent').innerHTML = `
    <div class="tab-view active" id="viewRewards">
      <div class="page-header">
        <h2>Rewards & Loyalty 🏆</h2>
        <p>Track your points, tier progress, and campaign interactions.</p>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="stat-card">
          <div class="stat-label">Current Points</div>
          <div class="stat-value" style="color:var(--accent);">${points.toLocaleString()}</div>
          <div class="stat-sub">Lifetime earned</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Current Tier</div>
          <div class="stat-value" style="color:${tier === 'gold' ? 'var(--gold)' : tier === 'silver' ? 'var(--silver)' : 'var(--bronze)'};">${tier.toUpperCase()}</div>
          <div class="stat-sub">${nextTier ? `${Math.max(0, nextThreshold - points)} pts to ${nextTier.toUpperCase()}` : 'Highest tier!'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Transactions</div>
          <div class="stat-value">${(profile.metrics?.orderCount || 0)}</div>
          <div class="stat-sub">${money.format(profile.metrics?.totalSpend || 0)} total</div>
        </div>
      </div>

      <div class="content-grid">
        <div class="card">
          <div class="card-title">📊 Tier Progress</div>
          <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:4px;">${points}/${nextTier ? nextThreshold : '∞'} points</div>
          <div class="loyalty-progress">
            <div class="loyalty-bar-bg">
              <div class="loyalty-bar-fill" style="width: ${progress}%;"></div>
            </div>
            <div class="loyalty-tier-info">
              <span>Current: ${tier.toUpperCase()}</span>
              <span>${nextTier ? `Next: ${nextTier.toUpperCase()}` : '🎉 Max Tier!'}</span>
            </div>
          </div>

          <div style="margin-top:20px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Tier Benefits</div>
            ${(tierPerks[tier] || []).map((p) => `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;color:var(--text-dim);">
                <span style="color:var(--accent);">✓</span> ${p}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-title">📩 Campaign Messages</div>
          <div style="max-height:320px;overflow-y:auto;">
            ${messages.length ? messages.slice(0, 6).map((m) => {
              const statusColors = { clicked: '#34d399', delivered: '#a5b4fc', opened: '#a5b4fc', read: '#34d399', failed: '#fca5a5', sent: '#fbbf24' };
              return `
                <div class="message-card" style="margin-bottom:8px;">
                  <div class="message-header">
                    <span class="message-channel">${safe(m.channel)}</span>
                    <span class="message-date">${fmtDate(m.createdAt)}</span>
                  </div>
                  <div class="message-body">${safe(m.message)}</div>
                  <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${statusColors[m.status] || 'var(--text-muted)'};">${safe(m.status)}</span>
                  </div>
                </div>
              `;
            }).join('') : '<div class="empty-state">No campaign messages yet.</div>'}
          </div>
        </div>

        <div class="card content-grid-full">
          <div class="card-title">💰 Points Activity</div>
          ${orders.length ? `
            <div class="orders-list">
              ${orders.slice(0, 8).map((o) => {
                const pts = Math.floor(o.amount / 10);
                const isCancel = o.status === 'cancelled';
                return `
                  <div class="order-row" style="grid-template-columns: 2fr 1fr 1fr 1fr;">
                    <div>
                      <div class="order-product">${safe(o.product)}</div>
                      <div class="order-category">${fmtDate(o.createdAt)}</div>
                    </div>
                    <div class="order-amount">${money.format(o.amount)}</div>
                    <div><span class="order-status status-${o.status}">${safe(o.status)}</span></div>
                    <div style="font-size:13px;font-weight:700;color:${isCancel ? '#fca5a5' : 'var(--accent)'};">${isCancel ? `-${pts}` : `+${pts}`} pts</div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="empty-state">Place an order to start earning points!</div>'}
        </div>
      </div>
    </div>
  `;
}

// ── Logout ──
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/customer-login.html';
});

// ── Boot ──
boot();
