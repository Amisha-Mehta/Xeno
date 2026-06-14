let appState = null;
let latestDraft = null;
let latestCampaignId = null;
let isDrafting = false;
let isChatting = false;
let aiStatus = { configured: false, mode: 'offline' };

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function fmtDate(value) {
  return new Date(value).toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function el(id) {
  return document.getElementById(id);
}

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function toast(message, type = 'info') {
  const container = el('toastContainer');
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.innerHTML = `
    <div style="display:flex; gap:10px; align-items:center;">
      <span style="font-weight:600;">${safe(message)}</span>
    </div>
  `;
  container.appendChild(toastEl);
  setTimeout(() => {
    toastEl.classList.add('toast-out');
    setTimeout(() => toastEl.remove(), 300);
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 401 && path !== '/api/auth/me') {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function show(elId) {
  el(elId)?.classList.remove('hidden');
}

function hide(elId) {
  el(elId)?.classList.add('hidden');
}

function toggleEmpty(emptyId, items) {
  if (items && items.length > 0) {
    hide(emptyId);
  } else {
    show(emptyId);
  }
}

// Visual sparkline generator using inline SVGs
function sparklineSVG(points, color = '#4f46e5') {
  const width = 100;
  const height = 30;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const spread = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, idx) => {
    const x = idx * step;
    const y = height - ((p - min) / spread) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return `
    <svg class="metric-sparkline" viewBox="0 0 ${width} ${height}">
      <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${coords}" />
    </svg>
  `;
}

function renderMetrics() {
  const summary = appState.dashboard.summary;
  const campaigns = appState.campaigns || [];
  
  // Calculate dynamic sparkline data
  const revenuePoints = campaigns.length 
    ? campaigns.map(c => c.metrics?.revenueAttributed || 0).reverse() 
    : [0, 0, 0];
  if (revenuePoints.length < 5) revenuePoints.unshift(0, 2000, 4000);
  
  const deliveryPoints = campaigns.length
    ? campaigns.map(c => c.metrics?.sent ? (c.metrics.delivered / c.metrics.sent) : 0).reverse()
    : [0, 0, 0];
  if (deliveryPoints.length < 5) deliveryPoints.unshift(0.5, 0.7, 0.9);

  const clickPoints = campaigns.length
    ? campaigns.map(c => c.metrics?.sent ? (c.metrics.clicked / c.metrics.sent) : 0).reverse()
    : [0, 0, 0];
  if (clickPoints.length < 5) clickPoints.unshift(0.1, 0.15, 0.22);
  
  el('metricsGrid').innerHTML = `
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">Total Customers</span>
        <span class="metric-trend up">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"></path></svg>
          Active
        </span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${safe(summary.customers)}</span>
        ${sparklineSVG([2, 4, 3, 5, 6, 8, summary.customers], '#10b981')}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">Revenue Tracked</span>
        <span class="metric-trend up" style="color: var(--success-text);">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"></path></svg>
          Attributed
        </span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${money.format(summary.spend)}</span>
        ${sparklineSVG(revenuePoints, '#4f46e5')}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">Delivery Rate</span>
        <span class="metric-trend" style="color: var(--info-text);">
          ${summary.deliveryRate >= 0.85 ? 'High' : 'Optimal'}
        </span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${pct(summary.deliveryRate)}</span>
        ${sparklineSVG(deliveryPoints, '#3b82f6')}
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">Click-Through Rate</span>
        <span class="metric-trend" style="color: var(--warning-text);">
          Optimal
        </span>
      </div>
      <div class="metric-value-row">
        <span class="metric-value">${pct(summary.clickRate)}</span>
        ${sparklineSVG(clickPoints, '#f59e0b')}
      </div>
    </div>
  `;
}

function renderAttribution() {
  const campaigns = appState.campaigns || [];
  const attributed = campaigns.filter((campaign) => (campaign.metrics?.attributedOrders || 0) > 0);

  if (!attributed.length) {
    el('attributionPanel').innerHTML = `
      <div class="empty-state">
        <p class="subtle">No campaign-attributed orders yet. Send a campaign and wait for the receipt loop to attribute purchases.</p>
      </div>
    `;
    return;
  }

  el('attributionPanel').innerHTML = attributed.slice(0, 4).map((campaign) => {
    const metrics = campaign.metrics || {};
    const clickRate = metrics.sent ? pct((metrics.clicked || 0) / metrics.sent) : '0%';
    return `
      <div class="attribution-row">
        <div class="attribution-info">
          <strong>${safe(campaign.name)}</strong>
          <div class="attribution-sub">${safe(campaign.channel.toUpperCase())} · ${safe(campaign.status)} · ${clickRate} click rate</div>
        </div>
        <div class="attribution-stats">
          <span class="attribution-rev">${money.format(metrics.revenueAttributed || 0)}</span>
          <div class="attribution-sub">${metrics.attributedOrders || 0} orders</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCampaignCard(campaign, compact = false) {
  const metrics = campaign.metrics || {};
  const cells = ['sent', 'delivered', 'opened', 'read', 'clicked', 'failed', 'attributedOrders']
    .map((key) => `
      <div class="progress-cell">
        ${safe(key === 'attributedOrders' ? 'Conversions' : key)}
        <strong>${metrics[key] || 0}</strong>
      </div>
    `)
    .join('');

  let action = '<span class="status-pill success">Completed</span>';
  if (campaign.status === 'draft') {
    action = `
      <div class="action-buttons">
        <button class="btn btn-secondary btn-sm schedule-btn" data-campaign-id="${campaign.id}">Schedule</button>
        <button class="btn btn-primary btn-sm send-btn" data-campaign-id="${campaign.id}">Send now</button>
      </div>
    `;
  } else if (campaign.status === 'sending') {
    action = '<span class="status-pill warning">Sending...</span>';
  } else if (campaign.status === 'scheduled') {
    action = `<span class="status-pill info">Scheduled ${campaign.scheduledFor ? fmtDate(campaign.scheduledFor) : ''}</span>`;
  }

  const channelBadge = `<span class="badge badge-channel">${safe(campaign.channel)}</span>`;

  return `
    <article class="campaign-card" data-campaign-id="${campaign.id}" data-card-id="${campaign.id}">
      <div class="campaign-card-header">
        <div class="campaign-info">
          <h3 style="display: flex; align-items: center; gap: 8px;">
            ${safe(campaign.name)}
            ${channelBadge}
          </h3>
          <div class="campaign-card-meta">
            <span>Status: <strong class="status-${safe(campaign.status)}">${safe(campaign.status)}</strong></span>
            <span>Audience: <strong>${campaign.audienceSize || metrics.sent || 0} shoppers</strong></span>
            ${metrics.revenueAttributed ? `<span>Revenue: <strong style="color: var(--success-text)">${money.format(metrics.revenueAttributed)}</strong></span>` : ''}
          </div>
        </div>
        ${action}
      </div>
      ${compact ? '' : `<p class="campaign-card-desc">${safe(campaign.aiSummary || campaign.subject || 'AI-assisted personalized campaign.')}</p>`}
      <div class="progress-grid">${cells}</div>
    </article>
  `;
}

function renderCampaigns() {
  const campaigns = appState.campaigns || [];
  const radar = el('campaignRadar');
  if (radar) {
    radar.innerHTML = campaigns.slice(0, 3).map((campaign) => renderCampaignCard(campaign, true)).join('');
  }
  el('campaignList').innerHTML = campaigns.map((campaign) => renderCampaignCard(campaign)).join('');
  toggleEmpty('campaignsEmpty', campaigns);
}

function populateManualCampaignSegments() {
  const select = el('manualSegmentId');
  if (!select || !appState) return;

  const segments = appState.segments || [];
  const current = select.value;
  select.innerHTML = segments.length
    ? ['<option value="">Select segment</option>']
      .concat(segments.map((segment) => `<option value="${safe(segment.id)}">${safe(segment.name)} (${segment.estimatedCount} shoppers)</option>`))
      .join('')
    : '<option value="">No segments available</option>';

  if (segments.some((segment) => segment.id === current)) {
    select.value = current;
  } else {
    select.value = '';
  }
}

function setupManualAudienceSelector() {
  const audienceSelect = el('manualAudienceType');
  const segmentSelect = el('manualSegmentId');
  if (!audienceSelect || !segmentSelect) return;

  function syncAudienceMode() {
    const useSegment = audienceSelect.value === 'existing_segment';
    segmentSelect.disabled = !useSegment;
    segmentSelect.style.opacity = useSegment ? '1' : '0.6';
    if (!useSegment) {
      segmentSelect.value = '';
    }
  }

  audienceSelect.addEventListener('change', syncAudienceMode);
  syncAudienceMode();
}

function renderSegments() {
  const segments = appState.segments || [];
  el('segmentsList').innerHTML = segments.map((segment) => `
    <article class="segment-card">
      <div class="segment-header">
        <div class="segment-title">
          <h4>${safe(segment.name)}</h4>
          <p class="segment-desc">${safe(segment.description)}</p>
        </div>
        <span class="status-pill primary">${segment.estimatedCount} shoppers</span>
      </div>
      <div class="segment-chips-row">
        <span class="badge badge-tag">${safe(segment.type.toUpperCase())}</span>
        <span class="badge badge-tag">${safe(segment.rules.kind || 'compound')}</span>
      </div>
    </article>
  `).join('');
  toggleEmpty('segmentsEmpty', segments);
}

function renderCustomers() {
  const customers = appState.customers || [];
  el('customersTable').innerHTML = customers.map((customer) => {
    const tier = customer.attributes.loyaltyTier || 'bronze';
    const tierBadge = `<span class="badge badge-${tier}">${tier.toUpperCase()}</span>`;
    const channelBadge = `<span class="badge badge-channel">${customer.preferredChannel}</span>`;
    const tags = (customer.segmentTags || []).map(t => `<span class="badge badge-tag">${safe(t)}</span>`).join(' ');
    
    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: var(--ink);">${safe(customer.name)}</div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${safe(customer.city)} · ${customer.email}</div>
          <div class="customer-meta-badges">${tags}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${channelBadge}
            <span class="status-pill ${customer.optedIn ? 'success' : 'danger'}">${customer.optedIn ? 'OPTED IN' : 'OPTED OUT'}</span>
          </div>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--ink);">${money.format(customer.metrics.totalSpend)}</div>
          <div style="font-size: 11px; color: var(--muted);">${customer.metrics.orderCount} orders · AOV: ${money.format(customer.metrics.averageOrderValue)}</div>
        </td>
        <td>
          <div style="font-weight: 500;">${safe(customer.metrics.lastOrder ? customer.metrics.lastOrder.product : 'No orders')}</div>
          <div style="font-size: 11px; color: var(--muted);">${customer.metrics.daysSinceLastOrder === Infinity ? '-' : customer.metrics.daysSinceLastOrder + ' days ago'}</div>
          <div style="margin-top: 4px;">${tierBadge}</div>
        </td>
      </tr>
    `;
  }).join('');
  toggleEmpty('customersEmpty', customers);
}

function renderReceipts() {
  const receipts = appState.receipts || [];
  const communications = appState.communications || [];

  el('receiptStream').innerHTML = receipts.slice(0, 24).map((receipt) => {
    let statusClass = 'info';
    if (receipt.type === 'clicked') statusClass = 'success';
    if (receipt.type === 'failed') statusClass = 'danger';
    if (receipt.type === 'delivered') statusClass = 'info';
    
    return `
      <div class="receipt-row" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <div>
          <span class="status-pill ${statusClass}" style="text-transform: uppercase;">${safe(receipt.type)}</span>
          <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">
            ${safe(receipt.channel || 'crm')} · Comm ID: <code>${safe(receipt.communicationId.slice(-8))}</code>
          </div>
        </div>
        <span style="font-size: 11px; color: var(--muted);">${fmtDate(receipt.timestamp)}</span>
      </div>
    `;
  }).join('');
  toggleEmpty('receiptsEmpty', receipts);

  el('communicationStream').innerHTML = communications.slice(0, 24).map((communication) => {
    const customer = (appState.customers || []).find((item) => item.id === communication.customerId);
    const message = communication.message || '';
    
    let statusClass = 'info';
    if (communication.status === 'clicked') statusClass = 'success';
    if (communication.status === 'read' || communication.status === 'opened') statusClass = 'success';
    if (communication.status === 'failed') statusClass = 'danger';
    if (communication.status === 'sending') statusClass = 'warning';
    
    return `
      <div class="communication-row" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border);">
        <div style="max-width: 70%;">
          <strong style="font-size: 13px; color: var(--ink);">${safe(customer ? customer.name : communication.customerId)}</strong>
          <div style="font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
            ${safe(message)}
          </div>
        </div>
        <span class="status-pill ${statusClass}">${safe(communication.status.toUpperCase())}</span>
      </div>
    `;
  }).join('');
  toggleEmpty('communicationsEmpty', communications);
}

function updateMobilePreview(channel, body) {
  const frame = el('phonePreviewFrame');
  const label = el('phoneHeaderLabel');
  const bubble = el('phonePreviewMessage');
  
  if (!frame || !bubble) return;
  
  frame.className = `phone-mockup ${channel.toLowerCase()}`;
  
  if (channel.toLowerCase() === 'whatsapp') {
    label.textContent = 'WhatsApp Business';
  } else if (channel.toLowerCase() === 'email') {
    label.textContent = 'Inbox: Loom & Lane';
  } else if (channel.toLowerCase() === 'sms') {
    label.textContent = 'Text Message (SMS)';
  } else if (channel.toLowerCase() === 'rcs') {
    label.textContent = 'Chat Message (RCS)';
  } else {
    label.textContent = 'Message Preview';
  }
  
  bubble.textContent = body || 'Select a campaign draft to view the render message here.';
}

function selectCampaignForPreview(id) {
  const campaigns = appState.campaigns || [];
  const campaign = campaigns.find(c => c.id === id);
  if (!campaign) return;
  
  updateMobilePreview(campaign.channel, campaign.message || campaign.subject || 'Empty message');
  
  document.querySelectorAll('.campaign-card').forEach(card => {
    card.style.borderColor = 'var(--border)';
  });
  const selectedCard = document.querySelector(`[data-card-id="${id}"]`);
  if (selectedCard) {
    selectedCard.style.borderColor = 'var(--primary)';
  }
}

function renderDashboardCharts() {
  const summary = appState.dashboard.summary;
  const campaigns = appState.campaigns || [];
  
  let sent = 0, delivered = 0, opened = 0, clicked = 0, spend = summary.spend;
  campaigns.forEach(c => {
    const m = c.metrics || {};
    sent += (m.sent || 0);
    delivered += (m.delivered || 0);
    opened += (m.opened || 0);
    clicked += (m.clicked || 0);
  });
  
  if (sent === 0) {
    sent = 10;
    delivered = 9;
    opened = 7;
    clicked = 4;
  }

  const delPct = Math.round((delivered / sent) * 100);
  const opPct = Math.round((opened / sent) * 100);
  const clPct = Math.round((clicked / sent) * 100);
  
  const funnelContainer = el('dashboardFunnelContainer');
  if (funnelContainer) {
    funnelContainer.innerHTML = `
      <div style="width: 100%; display: flex; flex-direction: column; gap: 10px;">
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <strong style="color: var(--ink-soft)">Sent (${sent})</strong>
            <span>100%</span>
          </div>
          <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
            <div style="width: 100%; height: 100%; background: var(--primary);"></div>
          </div>
        </div>
        
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <strong style="color: var(--ink-soft)">Delivered (${delivered})</strong>
            <span>${delPct}%</span>
          </div>
          <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
            <div style="width: ${delPct}%; height: 100%; background: var(--info);"></div>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <strong style="color: var(--ink-soft)">Opened (${opened})</strong>
            <span>${opPct}%</span>
          </div>
          <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
            <div style="width: ${opPct}%; height: 100%; background: var(--warning);"></div>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <strong style="color: var(--ink-soft)">Clicked (${clicked})</strong>
            <span>${clPct}%</span>
          </div>
          <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
            <div style="width: ${clPct}%; height: 100%; background: var(--success);"></div>
          </div>
        </div>
      </div>
    `;
  }
  
  const fSent = el('funnelSentVal');
  if (fSent) {
    fSent.textContent = sent;
    el('funnelDeliveredVal').textContent = delivered;
    el('funnelDeliveredPct').textContent = `${delPct}%`;
    el('funnelOpenedVal').textContent = opened;
    el('funnelOpenedPct').textContent = `${opPct}%`;
    el('funnelClickedVal').textContent = clicked;
    el('funnelClickedPct').textContent = `${clPct}%`;
    el('funnelSpendVal').textContent = money.format(spend);
    el('funnelSpendPct').textContent = `AOV: ${money.format(summary.orderAov)}`;
  }
}

function renderDraft(draft) {
  hide('draftEmpty');
  const topSpenders = (draft.summary.topSpenders || [])
    .map((item) => `<span class="draft-shopper-tag">${safe(item.name)}: ${money.format(item.spend)}</span>`)
    .join('');
  const aiLabel = draft.aiMode === 'llm' ? 'LLM-powered' : 'Rule-based';
  el('aiModeBadge').textContent = aiLabel;
  el('aiModeBadge').className = draft.aiMode === 'llm' ? 'status-pill success' : 'status-pill primary';

  el('draftOutput').innerHTML = `
    <article class="draft-card">
      <div class="draft-card-header">
        <div class="draft-segment-info">
          <span class="status-pill primary" style="margin-bottom: 6px;">Suggested Segment · ${safe(aiLabel)}</span>
          <h4>${safe(draft.segment.name)}</h4>
          <p>${safe(draft.segment.description)}</p>
        </div>
        <span class="status-pill success" style="font-size: 12px; font-weight: 700; padding: 6px 12px;">${draft.summary.audienceSize} shoppers</span>
      </div>
      
      <div class="draft-grid">
        <div class="draft-grid-item">
          <span>Channel</span>
          <strong>${safe(draft.message.channel.toUpperCase())}</strong>
        </div>
        <div class="draft-grid-item">
          <span>Avg Spend</span>
          <strong>${money.format(draft.summary.avgSpend)}</strong>
        </div>
        <div class="draft-grid-item">
          <span>Send Window</span>
          <strong>${safe(draft.recommendation.sendWindow)}</strong>
        </div>
      </div>
      
      <p class="draft-rationale">${safe((draft.message.rationale || []).join(' '))}</p>
      <div class="draft-message-body">${safe(draft.message.body)}</div>
      
      <div class="draft-top-shoppers">
        <span class="draft-top-shoppers-label">Top Matched Shoppers</span>
        <div class="draft-shopper-list">
          ${topSpenders || '<span style="font-size: 12px; color: var(--muted);">No matching shoppers yet</span>'}
        </div>
      </div>
    </article>
  `;
  
  updateMobilePreview(draft.message.channel, draft.message.body);
}

function renderNoDraft() {
  el('draftOutput').innerHTML = '';
  show('draftEmpty');
  updateMobilePreview('whatsapp', 'Select a campaign draft to view the render message here.');
}

function appendChatMessage(text, role) {
  const container = el('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  
  const avatar = role === 'user' ? 'ME' : 'AI';
  
  div.innerHTML = `
    <div class="chat-avatar">${avatar}</div>
    <div class="chat-bubble">${safe(text)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function setChatModeBadge(mode) {
  const badge = el('chatModeBadge');
  if (!badge) return;

  if (mode === 'llm') {
    badge.textContent = 'LLM Live';
    badge.className = 'status-pill success';
    return;
  }

  if (mode === 'error') {
    badge.textContent = 'AI Unavailable';
    badge.className = 'status-pill warning';
    return;
  }

  badge.textContent = 'Offline Mode';
  badge.className = 'status-pill primary';
}

async function sendChat() {
  const input = el('chatInput');
  const message = input.value.trim();
  if (!message || isChatting) return;

  input.value = '';
  isChatting = true;
  el('chatSendBtn').disabled = true;
  appendChatMessage(message, 'user');

  try {
    const result = await api('/api/ai/chat', { method: 'POST', body: { message } });
    appendChatMessage(result.reply, 'assistant');
    setChatModeBadge(result.mode);
  } catch (err) {
    appendChatMessage('Sorry, something went wrong. Try again.', 'assistant');
    toast('Chat failed: ' + err.message, 'error');
  } finally {
    isChatting = false;
    el('chatSendBtn').disabled = false;
    input.focus();
  }
}

function syncAiBadges() {
  const plannerBadge = el('aiModeBadge');
  const chatBadge = el('chatModeBadge');
  const isLive = aiStatus.mode === 'llm';

  if (plannerBadge && !latestDraft) {
    plannerBadge.textContent = isLive ? 'LLM Ready' : 'Offline Mode';
    plannerBadge.className = isLive ? 'status-pill success' : 'status-pill primary';
  }

  if (chatBadge) {
    setChatModeBadge(isLive ? 'llm' : 'offline');
  }
}

async function loadAiStatus() {
  try {
    aiStatus = await api('/api/ai/status');
  } catch {
    aiStatus = { configured: false, mode: 'offline' };
  }
  syncAiBadges();
}

async function refresh() {
  try {
    appState = await api('/api/state');
    renderMetrics();
    renderCampaigns();
    renderAttribution();
    renderSegments();
    renderCustomers();
    renderReceipts();
    renderDashboardCharts();
    populateManualCampaignSegments();
    bindDynamicButtons();
  } catch (err) {
    toast('Refresh failed: ' + err.message, 'error');
  }
}

async function generateDraft() {
  if (isDrafting) return;
  isDrafting = true;
  el('draftBtn').disabled = true;
  hide('draftBtnText');
  show('draftSpinner');

  try {
    latestDraft = await api('/api/ai/draft', {
      method: 'POST',
      body: { prompt: el('promptInput').value }
    });
    renderDraft(latestDraft);
    toast('Draft generated (' + (latestDraft.aiMode || 'rule-based') + ')');
  } catch (err) {
    toast('Draft failed: ' + err.message, 'error');
    renderNoDraft();
  } finally {
    isDrafting = false;
    el('draftBtn').disabled = false;
    show('draftBtnText');
    hide('draftSpinner');
  }
}

async function createCampaign() {
  if (!latestDraft) {
    toast('Generate a draft first', 'warn');
    return null;
  }
  try {
    const segmentResponse = await api('/api/segments', {
      method: 'POST',
      body: {
        name: latestDraft.segment.name,
        description: latestDraft.segment.description,
        type: 'ai',
        rules: latestDraft.segment.rules
      }
    });
    const campaignResponse = await api('/api/campaigns', {
      method: 'POST',
      body: {
        name: `${latestDraft.segment.name} - ${new Date().toLocaleDateString('en-IN')}`,
        segmentId: segmentResponse.segment.id,
        channel: latestDraft.message.channel,
        subject: latestDraft.message.subject,
        message: latestDraft.message.body,
        offer: latestDraft.recommendation.recommendedOffer || 'early access',
        aiSummary: (latestDraft.message.rationale || []).join(' ')
      }
    });
    latestCampaignId = campaignResponse.campaign.id;
    toast('Campaign created as draft');
    await refresh();
    return latestCampaignId;
  } catch (err) {
    toast('Failed to create campaign: ' + err.message, 'error');
    return null;
  }
}

async function createManualCampaign({ sendNow = false } = {}) {
  const audienceType = el('manualAudienceType').value;
  const segmentId = el('manualSegmentId').value;
  const name = el('manualCampaignName').value.trim();
  const channel = el('manualCampaignChannel').value;
  const subject = el('manualCampaignSubject').value.trim();
  const message = el('manualCampaignMessage').value.trim();

  if (!audienceType) {
    toast('Select a target audience first', 'warn');
    return null;
  }
  if (audienceType === 'existing_segment' && !segmentId) {
    toast('Select a segment first', 'warn');
    return null;
  }
  if (!channel) {
    toast('Select a channel first', 'warn');
    return null;
  }
  if (!name || !message) {
    toast('Campaign name and message are required', 'warn');
    return null;
  }

  const recipientIds = audienceType === 'existing_segment'
    ? null
    : (appState.customers || [])
      .filter((customer) => {
        if (audienceType === 'gold_members') return customer.attributes?.loyaltyTier === 'gold';
        if (audienceType === 'silver_members') return customer.attributes?.loyaltyTier === 'silver';
        if (audienceType === 'bronze_members') return customer.attributes?.loyaltyTier === 'bronze';
        if (audienceType === 'vip_members') {
          return customer.lifecycle === 'vip' || (customer.segmentTags || []).includes('VIP');
        }
        return false;
      })
      .map((customer) => customer.id);

  if (audienceType !== 'existing_segment' && (!recipientIds || !recipientIds.length)) {
    toast('No matching customers found for that audience', 'warn');
    return null;
  }

  try {
    const campaignResponse = await api('/api/campaigns', {
      method: 'POST',
      body: {
        name,
        segmentId: audienceType === 'existing_segment' ? segmentId : null,
        recipientIds,
        channel,
        subject: subject || name,
        message,
        offer: '',
        aiSummary: audienceType === 'existing_segment'
          ? 'Manual campaign created from an existing segment.'
          : `Manual campaign created for ${audienceType.replaceAll('_', ' ')}.`
      }
    });
    latestCampaignId = campaignResponse.campaign.id;
    toast(sendNow ? 'Campaign saved. Sending now...' : 'Manual campaign saved as draft', 'success');
    await refresh();

    if (sendNow) {
      await sendCampaign(latestCampaignId);
    }

    return latestCampaignId;
  } catch (err) {
    toast('Failed to create manual campaign: ' + err.message, 'error');
    return null;
  }
}

async function ensureDraftCampaign() {
  if (latestCampaignId) return latestCampaignId;
  return createCampaign();
}

async function sendCampaign(campaignId) {
  const id = campaignId || latestCampaignId || (appState.campaigns || []).find((campaign) => campaign.status === 'draft')?.id;
  if (!id) {
    toast('No draft campaign to send. Create one first.', 'warn');
    return;
  }
  try {
    await api(`/api/campaigns/${id}/send`, { method: 'POST' });
    toast('Campaign launched. Callback receipt loop initialized.');
    await refresh();
    setTimeout(refresh, 1600);
    setTimeout(refresh, 3600);
    setTimeout(refresh, 7000);
    setTimeout(refresh, 9500);
  } catch (err) {
    toast('Send failed: ' + err.message, 'error');
  }
}

async function scheduleCampaign(campaignId) {
  const id = campaignId || await ensureDraftCampaign();
  if (!id) {
    toast('No campaign to schedule. Generate a draft first.', 'warn');
    return;
  }
  try {
    await api(`/api/campaigns/${id}/schedule`, {
      method: 'POST',
      body: { delayMs: 30000 }
    });
    toast('Campaign scheduled for 30 seconds from now');
    await refresh();
    setTimeout(refresh, 32000);
    setTimeout(refresh, 41000);
  } catch (err) {
    toast('Schedule failed: ' + err.message, 'error');
  }
}

function bindDynamicButtons() {
  document.querySelectorAll('.send-btn').forEach((button) => {
    button.onclick = (e) => {
      e.stopPropagation();
      sendCampaign(button.dataset.campaignId);
    };
  });
  document.querySelectorAll('.schedule-btn').forEach((button) => {
    button.onclick = (e) => {
      e.stopPropagation();
      scheduleCampaign(button.dataset.campaignId);
    };
  });
  document.querySelectorAll('.campaign-card').forEach((card) => {
    card.style.cursor = 'pointer';
    card.onclick = () => {
      selectCampaignForPreview(card.dataset.campaignId);
    };
  });
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
      button.classList.add('active');
      el(button.dataset.view).classList.add('active');
    });
  });
}

async function resetDemoData() {
  if (!confirm('Are you sure you want to reset all CRM demo data? This will clear custom campaigns, segments, and receipts.')) {
    return;
  }
  try {
    await api('/api/admin/reset', { method: 'POST' });
    toast('CRM database reset to seed values successfully.');
    await refresh();
  } catch (err) {
    toast('Reset failed: ' + err.message, 'error');
  }
}

async function checkAuth() {
  try {
    const session = await api('/api/auth/me');
    if (!session || session.role !== 'admin') {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  } catch (err) {
    window.location.href = '/login.html';
    return false;
  }
}

// Modal helpers
function openModal(modalId) {
  el('modalBackdrop').classList.remove('hidden');
  el(modalId).classList.remove('hidden');
}

function closeModals() {
  el('modalBackdrop').classList.add('hidden');
  el('addCustomerModal').classList.add('hidden');
  el('addSegmentModal').classList.add('hidden');
}

function getSegmentRuleValue() {
  const field = el('ruleField')?.value;
  if (!field) return '';
  if (field === 'loyaltyTier' || field === 'preferredChannel') {
    return el('ruleValueSelect').value;
  }
  return el('ruleValue').value.trim();
}

function setupSegmentRuleField() {
  const fieldSelect = el('ruleField');
  const textInput = el('ruleValue');
  const selectInput = el('ruleValueSelect');
  if (!fieldSelect || !textInput || !selectInput) return;

  const optionSets = {
    loyaltyTier: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
      { value: 'bronze', label: 'Bronze' }
    ],
    preferredChannel: [
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'sms', label: 'SMS' },
      { value: 'email', label: 'Email' },
      { value: 'rcs', label: 'RCS' }
    ]
  };

  function applyFieldMode() {
    const field = fieldSelect.value;
    const options = optionSets[field];

    if (options) {
      selectInput.innerHTML = ['<option value="">Select value</option>']
        .concat(options.map((option) => `<option value="${safe(option.value)}">${safe(option.label)}</option>`))
        .join('');
      textInput.classList.add('hidden');
      textInput.required = false;
      selectInput.classList.remove('hidden');
      selectInput.required = true;
      selectInput.value = '';
      return;
    }

    selectInput.classList.add('hidden');
    selectInput.required = false;
    textInput.classList.remove('hidden');
    textInput.required = !!field;
    textInput.placeholder = field === 'city' ? 'e.g. Delhi' : field ? 'Enter value' : 'Choose a field first';
    textInput.value = '';
  }

  fieldSelect.addEventListener('change', applyFieldMode);
  applyFieldMode();
}

// Ingest Customer
async function handleAddCustomerSubmit() {
  const name = el('custName').value;
  const email = el('custEmail').value;
  const phone = el('custPhone').value;
  const city = el('custCity').value;
  const loyaltyTier = el('custTier').value;
  const lifecycle = el('custLifecycle').value;
  const preferredChannel = el('custChannel').value;
  if (!loyaltyTier || !lifecycle || !preferredChannel) {
    toast('Select loyalty tier, member type, and preferred channel', 'warn');
    return;
  }
  const segmentTags = lifecycle === 'vip'
    ? ['VIP', 'Admin Created']
    : lifecycle === 'high_value'
      ? ['High Value', 'Admin Created']
      : [lifecycle.replaceAll('_', ' '), 'Admin Created'];

  try {
    await api('/api/customers', {
      method: 'POST',
      body: { name, email, phone, city, preferredChannel, lifecycle, segmentTags, attributes: { loyaltyTier } }
    });
    toast('Customer ingested successfully!', 'success');
    closeModals();
    el('addCustomerForm').reset();
    await refresh();
  } catch (err) {
    toast('Failed to ingest customer: ' + err.message, 'error');
  }
}

// Create Segment
async function handleAddSegmentSubmit() {
  const name = el('segName').value;
  const description = el('segDesc').value;
  const field = el('ruleField').value;
  const val = getSegmentRuleValue();

  if (!field || !val) {
    toast('Select both a rule field and a value', 'warn');
    return;
  }

  const rules = {
    kind: 'custom',
    optInOnly: true,
    [field]: val
  };

  try {
    await api('/api/segments', {
      method: 'POST',
      body: { name, description, type: 'manual', rules }
    });
    toast('Segment created successfully!', 'success');
    closeModals();
    el('addSegmentForm').reset();
    await refresh();
    populateManualCampaignSegments();
  } catch (err) {
    toast('Failed to create segment: ' + err.message, 'error');
  }
}

// Workspace Selector Dropdown
function setupWorkspaceSelector() {
  const wsBtn = el('workspaceSelectBtn');
  const wsMenu = el('workspaceDropdownMenu');
  const wsLabel = el('activeWorkspaceLabel');

  if (wsBtn && wsMenu) {
    wsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wsMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      wsMenu.classList.add('hidden');
    });

    document.querySelectorAll('.workspace-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsName = opt.dataset.ws;
        
        // Remove active class
        document.querySelectorAll('.workspace-option').forEach((o) => o.classList.remove('active'));
        opt.classList.add('active');
        
        // Update label
        wsLabel.textContent = wsName;
        toast(`Switched workspace to ${wsName}`, 'success');
        wsMenu.classList.add('hidden');
      });
    });
  }
}

// Global Search Filtering
function setupGlobalSearch() {
  const searchInput = el('globalSearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    
    // Find which view is currently active
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const viewId = activeView.id;

    if (viewId === 'customers') {
      const rows = document.querySelectorAll('#customersTable tr');
      rows.forEach((row) => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    } else if (viewId === 'segments') {
      const cards = document.querySelectorAll('#segmentsList .segment-card');
      cards.forEach((card) => {
        const text = card.textContent.toLowerCase();
        if (text.includes(query)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    } else if (viewId === 'campaigns') {
      const items = document.querySelectorAll('#campaignList .campaign-card');
      items.forEach((item) => {
        const text = item.textContent.toLowerCase();
        if (text.includes(query)) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    } else if (viewId === 'command') {
      // Filter recent campaigns list in the attribution panel
      const atts = document.querySelectorAll('#attributionPanel .attribution-item');
      atts.forEach((att) => {
        const text = att.textContent.toLowerCase();
        if (text.includes(query)) {
          att.style.display = '';
        } else {
          att.style.display = 'none';
        }
      });
    }
  });
}

// WhatsApp Config API calls
async function loadWhatsAppConfig() {
  const providerSelect = el('waProvider');
  const metaFields = el('metaFields');
  const twilioFields = el('twilioFields');

  if (!providerSelect) return;

  try {
    const config = await api('/api/admin/whatsapp-config');
    providerSelect.value = config.provider || 'meta';
    
    el('waMetaPhoneId').value = config.metaPhoneId || '';
    el('waMetaAccessToken').value = config.metaAccessToken || '';
    el('waMetaTemplateName').value = config.metaTemplateName || '';
    el('waMetaTemplateLanguage').value = config.metaTemplateLanguage || 'en_US';
    el('waMetaUseTemplateForCampaigns').checked = !!config.metaUseTemplateForCampaigns;
    
    el('waTwilioSid').value = config.twilioAccountSid || '';
    el('waTwilioToken').value = config.twilioAuthToken || '';
    el('waTwilioFrom').value = config.twilioWhatsappFrom || '';

    // Toggle fields visibility
    if (config.provider === 'twilio') {
      metaFields.classList.add('hidden');
      twilioFields.classList.remove('hidden');
    } else {
      metaFields.classList.remove('hidden');
      twilioFields.classList.add('hidden');
    }

    // Update status badge
    updateWhatsAppStatusBadge(config.isConfigured, config.provider);
  } catch (err) {
    console.error('Failed to load WhatsApp config', err);
  }
}

function updateWhatsAppStatusBadge(isConfigured, provider) {
  const statusBadge = el('waConfigStatus');
  if (!statusBadge) return;

  if (isConfigured) {
    statusBadge.className = 'status-pill success';
    statusBadge.textContent = `Live WhatsApp Connected (${provider.toUpperCase()})`;
  } else {
    statusBadge.className = 'status-pill warning';
    statusBadge.textContent = 'Simulation Fallback Active';
  }
}

async function saveWhatsAppConfig() {
  const provider = el('waProvider').value;
  const metaPhoneId = el('waMetaPhoneId').value;
  const metaAccessToken = el('waMetaAccessToken').value;
  const metaTemplateName = el('waMetaTemplateName').value;
  const metaTemplateLanguage = el('waMetaTemplateLanguage').value;
  const metaUseTemplateForCampaigns = el('waMetaUseTemplateForCampaigns').checked;
  const twilioAccountSid = el('waTwilioSid').value;
  const twilioAuthToken = el('waTwilioToken').value;
  const twilioWhatsappFrom = el('waTwilioFrom').value;

  try {
    const result = await api('/api/admin/whatsapp-config', {
      method: 'POST',
      body: {
        provider,
        metaPhoneId,
        metaAccessToken,
        metaTemplateName,
        metaTemplateLanguage,
        metaUseTemplateForCampaigns,
        twilioAccountSid,
        twilioAuthToken,
        twilioWhatsappFrom
      }
    });
    
    toast('WhatsApp configuration saved successfully!', 'success');
    updateWhatsAppStatusBadge(result.isConfigured, provider);
  } catch (err) {
    toast('Failed to save config: ' + err.message, 'error');
  }
}

function setupWhatsAppConfigListeners() {
  const providerSelect = el('waProvider');
  const configForm = el('whatsappConfigForm');
  const metaFields = el('metaFields');
  const twilioFields = el('twilioFields');

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      const prov = providerSelect.value;
      if (prov === 'twilio') {
        metaFields.classList.add('hidden');
        twilioFields.classList.remove('hidden');
      } else {
        metaFields.classList.remove('hidden');
        twilioFields.classList.add('hidden');
      }
    });
  }

  if (configForm) {
    configForm.addEventListener('submit', saveWhatsAppConfig);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await checkAuth();
  if (!authenticated) return;

  setupNavigation();
  el('refreshBtn').addEventListener('click', refresh);
  el('draftBtn').addEventListener('click', generateDraft);
  el('createCampaignBtn').addEventListener('click', createCampaign);
  el('scheduleCampaignBtn').addEventListener('click', () => scheduleCampaign());
  el('sendLatestBtn').addEventListener('click', () => sendCampaign());
  el('manualCreateCampaignBtn')?.addEventListener('click', () => createManualCampaign());
  el('manualCreateAndSendBtn')?.addEventListener('click', () => createManualCampaign({ sendNow: true }));
  
  // Modal trigger actions
  el('addCustomerBtn')?.addEventListener('click', () => openModal('addCustomerModal'));
  el('addSegmentBtn')?.addEventListener('click', () => openModal('addSegmentModal'));
  
  document.querySelectorAll('.closeModalBtn').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });
  el('modalBackdrop').addEventListener('click', (e) => {
    if (e.target === el('modalBackdrop')) closeModals();
  });

  el('addCustomerForm').addEventListener('submit', handleAddCustomerSubmit);
  el('addSegmentForm').addEventListener('submit', handleAddSegmentSubmit);
  setupSegmentRuleField();

  // Additional Topbar logic
  setupWorkspaceSelector();
  setupGlobalSearch();
  setupManualAudienceSelector();

  // Settings screen configs
  setupWhatsAppConfigListeners();
  await loadWhatsAppConfig();
  await loadAiStatus();

  el('resetDemoBtn')?.addEventListener('click', resetDemoData);
  el('chatSendBtn').addEventListener('click', sendChat);
  el('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendChat();
  });

  const logoutBtn = el('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
      } catch (err) {
        toast('Logout failed: ' + err.message, 'error');
      }
    });
  }

  await refresh();
  await generateDraft();
  setInterval(refresh, 8000);
});
