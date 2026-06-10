const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(value) {
  return new Date(value).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return (name || '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

async function api(path) {
  const res = await fetch(path);
  if (res.status === 401) {
    window.location.href = '/customer-login.html';
    throw new Error('Not authenticated');
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadPortal() {
  try {
    const [profileData, ordersData, messagesData] = await Promise.all([
      api('/api/customer/profile'),
      api('/api/customer/orders'),
      api('/api/customer/messages')
    ]);

    renderPortal(profileData, ordersData.orders || [], messagesData.messages || []);
  } catch (err) {
    if (err.message !== 'Not authenticated') {
      document.getElementById('portalContent').innerHTML = `
        <div class="empty-section">
          <p>Failed to load portal data. ${safe(err.message)}</p>
        </div>
      `;
    }
  }
}

function renderPortal(profile, orders, messages) {
  const metrics = profile.metrics || {};
  const tierColors = { gold: '#d97706', silver: '#475569', bronze: '#ea580c' };
  const tierColor = tierColors[profile.loyaltyTier] || '#475569';

  document.getElementById('portalContent').innerHTML = `
    <div class="portal-greeting">
      <h2>Welcome back, ${safe(profile.name.split(' ')[0])} 👋</h2>
      <p>Here's a summary of your Loom & Lane account activity.</p>
    </div>

    <div class="portal-grid">
      <!-- Profile Card -->
      <div>
        <div class="profile-card">
          <div class="profile-avatar">${initials(profile.name)}</div>
          <div class="profile-name">${safe(profile.name)}</div>
          <div class="profile-email">${safe(profile.email)}</div>

          <div class="profile-details">
            <div class="profile-row">
              <span class="profile-label">Phone</span>
              <span class="profile-value">${safe(profile.phone)}</span>
            </div>
            <div class="profile-row">
              <span class="profile-label">City</span>
              <span class="profile-value">${safe(profile.city)}</span>
            </div>
            <div class="profile-row">
              <span class="profile-label">Preferred Channel</span>
              <span class="profile-value" style="text-transform: uppercase;">${safe(profile.preferredChannel)}</span>
            </div>
            <div class="profile-row">
              <span class="profile-label">Loyalty Tier</span>
              <span class="profile-value" style="color: ${tierColor}; text-transform: uppercase;">${safe(profile.loyaltyTier)}</span>
            </div>
            <div class="profile-row">
              <span class="profile-label">Communication</span>
              <span class="profile-value">${profile.optedIn ? '✅ Opted In' : '❌ Opted Out'}</span>
            </div>
          </div>

          <div class="stats-row">
            <div class="stat-card">
              <span>Total Spend</span>
              <strong>${money.format(metrics.totalSpend || 0)}</strong>
            </div>
            <div class="stat-card">
              <span>Orders</span>
              <strong>${metrics.orderCount || 0}</strong>
            </div>
            <div class="stat-card">
              <span>Avg Order</span>
              <strong>${money.format(metrics.averageOrderValue || 0)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Right column: Orders & Messages -->
      <div>
        <div class="portal-section">
          <h3 class="portal-section-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
            Order History
          </h3>
          ${orders.length ? `
            <table class="orders-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${orders.map((o) => `
                  <tr>
                    <td><strong>${safe(o.product)}</strong><br><span style="font-size: 11px; color: var(--muted);">${safe(o.category)}</span></td>
                    <td style="font-weight: 600;">${money.format(o.amount)}</td>
                    <td>${fmtDate(o.createdAt)}</td>
                    <td><span style="color: var(--success-text); font-weight: 600; text-transform: uppercase; font-size: 11px;">${safe(o.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="empty-section">No orders yet.</div>'}
        </div>

        <div class="portal-section">
          <h3 class="portal-section-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Campaign Messages
          </h3>
          ${messages.length ? messages.map((m) => {
            const statusColors = {
              clicked: 'var(--success-text)', delivered: 'var(--info-text)',
              opened: 'var(--info-text)', read: 'var(--success-text)',
              failed: 'var(--danger-text)', sent: 'var(--warning-text)'
            };
            return `
              <div class="message-card">
                <div class="message-header">
                  <span class="message-channel">${safe(m.channel)}</span>
                  <span class="message-date">${fmtDate(m.createdAt)}</span>
                </div>
                <div class="message-body">${safe(m.message)}</div>
                <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: ${statusColors[m.status] || 'var(--muted)'};">${safe(m.status)}</span>
                  ${m.updatedAt ? `<span style="font-size: 11px; color: var(--muted);">Updated: ${fmtDate(m.updatedAt)}</span>` : ''}
                </div>
              </div>
            `;
          }).join('') : '<div class="empty-section">No messages sent to you yet.</div>'}
        </div>
      </div>
    </div>
  `;
}

// Logout handler
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/customer-login.html';
});

// Boot
loadPortal();
