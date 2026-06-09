let appState = null;
let latestDraft = null;
let latestCampaignId = null;
let isDrafting = false;
let isChatting = false;

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
    el('chatModeBadge').textContent = result.mode === 'llm' ? 'LLM Live' : 'Offline Mode';
    el('chatModeBadge').className = result.mode === 'llm' ? 'status-pill success' : 'status-pill primary';
  } catch (err) {
    appendChatMessage('Sorry, something went wrong. Try again.', 'assistant');
    toast('Chat failed: ' + err.message, 'error');
  } finally {
    isChatting = false;
    el('chatSendBtn').disabled = false;
    input.focus();
  }
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

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  el('refreshBtn').addEventListener('click', refresh);
  el('draftBtn').addEventListener('click', generateDraft);
  el('createCampaignBtn').addEventListener('click', createCampaign);
  el('scheduleCampaignBtn').addEventListener('click', () => scheduleCampaign());
  el('sendLatestBtn').addEventListener('click', () => sendCampaign());
  el('addSegmentBtn')?.addEventListener('click', () => toast('Use the Command Center AI draft to create an audience segment.', 'info'));
  el('addCustomerBtn')?.addEventListener('click', () => toast('Customer ingestion is available through POST /api/customers.', 'info'));
  el('resetDemoBtn')?.addEventListener('click', resetDemoData);
  el('chatSendBtn').addEventListener('click', sendChat);
  el('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendChat();
  });

  await refresh();
  await generateDraft();
  setInterval(refresh, 8000);
});
