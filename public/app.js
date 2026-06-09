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
  toastEl.textContent = message;
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

function metric(label, value) {
  return `<div class="metric"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`;
}

function renderMetrics() {
  const summary = appState.dashboard.summary;
  el('metricsGrid').innerHTML = [
    metric('Customers', summary.customers),
    metric('Revenue tracked', money.format(summary.spend)),
    metric('Delivery rate', pct(summary.deliveryRate)),
    metric('Click rate', pct(summary.clickRate))
  ].join('');
}

function renderAttribution() {
  const campaigns = appState.campaigns || [];
  const attributed = campaigns.filter((campaign) => (campaign.metrics?.attributedOrders || 0) > 0);

  if (!attributed.length) {
    el('attributionPanel').innerHTML =
      '<p class="subtle">No campaign-attributed orders yet. Send a campaign and wait for the receipt loop to attribute purchases.</p>';
    return;
  }

  el('attributionPanel').innerHTML = attributed.slice(0, 4).map((campaign) => {
    const metrics = campaign.metrics || {};
    const clickRate = metrics.sent ? pct((metrics.clicked || 0) / metrics.sent) : '0%';
    return `
      <div class="attribution-row">
        <div>
          <strong>${safe(campaign.name)}</strong>
          <div class="subtle">${safe(campaign.channel)} · ${safe(campaign.status)} · ${clickRate} click rate</div>
        </div>
        <div class="attribution-value">
          <span class="attribution-revenue">${money.format(metrics.revenueAttributed || 0)}</span>
          <div class="subtle">${metrics.attributedOrders || 0} orders</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCampaignCard(campaign, compact = false) {
  const metrics = campaign.metrics || {};
  const cells = ['sent', 'delivered', 'opened', 'read', 'clicked', 'failed', 'attributedOrders']
    .map((key) => `<div class="progress-cell">${safe(key)}<strong>${metrics[key] || 0}</strong></div>`)
    .join('');

  let action = '<span class="status-pill">Tracked</span>';
  if (campaign.status === 'draft') {
    action = `
      <div class="row-actions">
        <button class="ghost schedule-btn" data-campaign-id="${campaign.id}">Schedule</button>
        <button class="primary send-btn" data-campaign-id="${campaign.id}">Send now</button>
      </div>
    `;
  } else if (campaign.status === 'sending') {
    action = '<span class="status-pill status-sending">Sending...</span>';
  } else if (campaign.status === 'scheduled') {
    action = `<span class="status-pill status-scheduled">Scheduled ${campaign.scheduledFor ? fmtDate(campaign.scheduledFor) : ''}</span>`;
  }

  return `
    <article class="campaign-card">
      <div class="panel-heading">
        <div>
          <h3>${safe(campaign.name)}</h3>
          <div class="campaign-meta">
            <span>${safe(campaign.channel)}</span>
            <span class="status-${safe(campaign.status)}">${safe(campaign.status)}</span>
            <span>${campaign.audienceSize || metrics.sent || 0} shoppers</span>
            ${metrics.revenueAttributed ? `<span>${money.format(metrics.revenueAttributed)} attributed</span>` : ''}
          </div>
        </div>
        ${action}
      </div>
      ${compact ? '' : `<p class="subtle">${safe(campaign.aiSummary || campaign.subject || 'Personalized campaign')}</p>`}
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
      <div class="panel-heading">
        <div>
          <h3>${safe(segment.name)}</h3>
          <p class="subtle">${safe(segment.description)}</p>
        </div>
        <span class="chip">${segment.estimatedCount} shoppers</span>
      </div>
      <div class="campaign-meta">
        <span>${safe(segment.type)}</span>
        <span>${safe(segment.rules.kind || 'compound')}</span>
      </div>
    </article>
  `).join('');
  toggleEmpty('segmentsEmpty', segments);
}

function renderCustomers() {
  const customers = appState.customers || [];
  el('customersTable').innerHTML = customers.map((customer) => `
    <tr>
      <td><strong>${safe(customer.name)}</strong><div class="subtle">${safe(customer.city)} · ${safe((customer.segmentTags || []).join(', '))}</div></td>
      <td>${safe(customer.preferredChannel)}<div class="subtle">${customer.optedIn ? 'opted in' : 'opted out'}</div></td>
      <td>${money.format(customer.metrics.totalSpend)}<div class="subtle">${customer.metrics.orderCount} orders</div></td>
      <td>${safe(customer.metrics.lastOrder ? customer.metrics.lastOrder.product : 'No orders')}<div class="subtle">${customer.metrics.daysSinceLastOrder === Infinity ? '-' : customer.metrics.daysSinceLastOrder + ' days ago'}</div></td>
    </tr>
  `).join('');
  toggleEmpty('customersEmpty', customers);
}

function renderReceipts() {
  const receipts = appState.receipts || [];
  const communications = appState.communications || [];

  el('receiptStream').innerHTML = receipts.slice(0, 24).map((receipt) => `
    <div class="receipt-row">
      <div>
        <strong class="state-${safe(receipt.type)}">${safe(receipt.type)}</strong>
        <div class="subtle">${safe(receipt.channel || 'crm')} · ${safe(receipt.communicationId)}</div>
      </div>
      <span class="subtle">${fmtDate(receipt.timestamp)}</span>
    </div>
  `).join('');
  toggleEmpty('receiptsEmpty', receipts);

  el('communicationStream').innerHTML = communications.slice(0, 24).map((communication) => {
    const customer = (appState.customers || []).find((item) => item.id === communication.customerId);
    const message = communication.message || '';
    return `
      <div class="communication-row">
        <div>
          <strong>${safe(customer ? customer.name : communication.customerId)}</strong>
          <div class="subtle">${safe(message.slice(0, 86))}${message.length > 86 ? '...' : ''}</div>
        </div>
        <span class="chip state-${safe(communication.status)}">${safe(communication.status)}</span>
      </div>
    `;
  }).join('');
  toggleEmpty('communicationsEmpty', communications);
}

function renderDraft(draft) {
  hide('draftEmpty');
  const topSpenders = (draft.summary.topSpenders || [])
    .map((item) => `<span>${safe(item.name)}: ${money.format(item.spend)}</span>`)
    .join('');
  const aiLabel = draft.aiMode === 'llm' ? 'LLM-powered' : 'Rule-based';
  el('aiModeBadge').textContent = aiLabel;

  el('draftOutput').innerHTML = `
    <article class="draft-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Suggested segment · ${safe(aiLabel)}</p>
          <h3>${safe(draft.segment.name)}</h3>
          <p class="subtle">${safe(draft.segment.description)}</p>
        </div>
        <span class="chip">${draft.summary.audienceSize} shoppers</span>
      </div>
      <div class="mini-grid">
        <div class="mini-stat"><span>Channel</span><strong>${safe(draft.message.channel)}</strong></div>
        <div class="mini-stat"><span>Avg spend</span><strong>${money.format(draft.summary.avgSpend)}</strong></div>
        <div class="mini-stat"><span>Send window</span><strong>${safe(draft.recommendation.sendWindow)}</strong></div>
      </div>
      <p class="subtle">${safe((draft.message.rationale || []).join(' '))}</p>
      <div class="draft-message">${safe(draft.message.body)}</div>
      <div class="campaign-meta">${topSpenders || '<span>No matching shoppers yet</span>'}</div>
    </article>
  `;
}

function renderNoDraft() {
  el('draftOutput').innerHTML = '';
  show('draftEmpty');
}

function appendChatMessage(text, role) {
  const container = el('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-msg-content">${safe(text)}</div>`;
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
    el('chatModeBadge').textContent = result.mode === 'llm' ? 'LLM Live' : 'Offline mode';
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
    toast('Campaign sent. Watching for channel callbacks...');
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
    button.onclick = () => sendCampaign(button.dataset.campaignId);
  });
  document.querySelectorAll('.schedule-btn').forEach((button) => {
    button.onclick = () => scheduleCampaign(button.dataset.campaignId);
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

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  el('refreshBtn').addEventListener('click', refresh);
  el('draftBtn').addEventListener('click', generateDraft);
  el('createCampaignBtn').addEventListener('click', createCampaign);
  el('scheduleCampaignBtn').addEventListener('click', () => scheduleCampaign());
  el('sendLatestBtn').addEventListener('click', () => sendCampaign());
  el('addSegmentBtn')?.addEventListener('click', () => toast('Use the Command Center AI draft to create an audience segment.', 'info'));
  el('addCustomerBtn')?.addEventListener('click', () => toast('Customer ingestion is available through POST /api/customers.', 'info'));
  el('chatSendBtn').addEventListener('click', sendChat);
  el('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendChat();
  });

  await refresh();
  await generateDraft();
  setInterval(refresh, 8000);
});
