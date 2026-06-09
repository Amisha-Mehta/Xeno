// ---------------------------------------------------------------
// Xeno Mini CRM — Frontend
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// API helper
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Toggle helpers
// ---------------------------------------------------------------

function show(elId) { el(elId).classList.remove('hidden'); }
function hide(elId) { el(elId).classList.add('hidden'); }

function toggleEmpty(containerId, emptyId, items) {
  if (items && items.length > 0) {
    hide(emptyId);
  } else {
    show(emptyId);
  }
}

// ---------------------------------------------------------------
// Metrics grid
// ---------------------------------------------------------------

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
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

// ---------------------------------------------------------------
// Attribution panel
// ---------------------------------------------------------------

function renderAttribution() {
  const campaigns = appState.campaigns || [];
  const attributed = campaigns.filter((c) => (c.metrics?.attributedOrders || 0) > 0);

  if (!attributed.length) {
    el('attributionPanel').innerHTML =
      '<p class="subtle">No campaign-attributed orders yet. Send a campaign and wait for the receipt loop to attribute purchases.</p>';
    return;
  }

  el('attributionPanel').innerHTML = attributed.slice(0, 3).map((c) => {
    const m = c.metrics || {};
    const roi = m.revenueAttributed > 0
      ? `${money.format(m.revenueAttributed)} from ${m.attributedOrders} orders`
      : 'Awaiting attribution';
    return `
      <div class="attribution-row">
        <div>
          <strong>${c.name}</strong>
          <div class="subtle">${c.channel} · ${c.status}</div>
        </div>
        <div class="attribution-value">
          <span class="attribution-revenue">${roi}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------
// Campaign cards
// ---------------------------------------------------------------

function renderCampaignCard(campaign, compact = false) {
  const metrics = campaign.metrics || {};
  const cells = ['sent', 'delivered', 'opened', 'read', 'clicked', 'failed']
    .map((key) => `<div class="progress-cell">${key}<strong>${metrics[key] || 0}</strong></div>`)
    .join('');
  return `
    <article class="campaign-card">
      <div class="panel-heading">
        <div>
          <h3>${campaign.name}</h3>
          <div class="campaign-meta">
            <span>${campaign.channel}</span>
            <span class="status-${campaign.status}">${campaign.status}</span>
            <span>${campaign.audienceSize || metrics.sent || 0} shoppers</span>
            ${metrics.revenueAttributed ? `<span>${money.format(metrics.revenueAttributed)} attributed</span>` : ''}
          </div>
        </div>
        ${campaign.status === 'draft'
          ? `<button class="primary send-btn" data-campaign-id="${campaign.id}">Send now</button>`
          : campaign.status === 'sending'
            ? '<span class="status-pill status-sending">Sending…</span>'
            : '<span class="status-pill">Tracked</span>'}
      </div>
      ${compact ? '' : `<p class="subtle">${campaign.aiSummary || campaign.subject || 'Personalized campaign'}</p>`}
      <div class="progress-grid">${cells}</div>
    </article>
  `;
}

function renderCampaigns() {
  const campaigns = appState.campaigns || [];
  const radar = el('campaignRadar');
  if (radar) {
    radar.innerHTML = campaigns.slice(0, 3).map((c) => renderCampaignCard(c, true)).join('');
  }
  el('campaignList').innerHTML = campaigns.map((c) => renderCampaignCard(c)).join('');
  toggleEmpty('campaignList', 'campaignsEmpty', campaigns);
}

// ---------------------------------------------------------------
// Segments & Customers
// ---------------------------------------------------------------

function renderSegments() {
  const segments = appState.segments || [];
  el('segmentsList').innerHTML = segments.map((segment) => `
    <article class="segment-card">
      <div class="panel-heading">
        <div>
          <h3>${segment.name}</h3>
          <p class="subtle">${segment.description}</p>
        </div>
        <span class="chip">${segment.estimatedCount} shoppers</span>
      </div>
      <div class="campaign-meta">
        <span>${segment.type}</span>
        <span>${segment.rules.kind}</span>
      </div>
    </article>
  `).join('');
  toggleEmpty('segmentsList', 'segmentsEmpty', segments);
}

function renderCustomers() {
  const customers = appState.customers || [];
  el('customersTable').innerHTML = customers.map((customer) => `
    <tr>
      <td><strong>${customer.name}</strong><div class="subtle">${customer.city} · ${(customer.segmentTags || []).join(', ')}</div></td>
      <td>${customer.preferredChannel}<div class="subtle">${customer.optedIn ? 'opted in' : 'opted out'}</div></td>
      <td>${money.format(customer.metrics.totalSpend)}<div class="subtle">${customer.metrics.orderCount} orders</div></td>
      <td>${customer.metrics.lastOrder ? customer.metrics.lastOrder.product : 'No orders'}<div class="subtle">${customer.metrics.daysSinceLastOrder === Infinity ? '—' : customer.metrics.daysSinceLastOrder + ' days ago'}</div></td>
    </tr>
  `).join('');
  toggleEmpty('customersTable', 'customersEmpty', customers);
}

// ---------------------------------------------------------------
// Receipts & Communications
// ---------------------------------------------------------------

function renderReceipts() {
  const receipts = appState.receipts || [];
  const comms = appState.communications || [];

  el('receiptStream').innerHTML = receipts.slice(0, 24).map((receipt) => `
    <div class="receipt-row">
      <div>
        <strong class="state-${receipt.type}">${receipt.type}</strong>
        <div class="subtle">${receipt.channel || 'crm'} · ${receipt.communicationId}</div>
      </div>
      <span class="subtle">${fmtDate(receipt.timestamp)}</span>
    </div>
  `).join('');
  toggleEmpty('receiptStream', 'receiptsEmpty', receipts);

  el('communicationStream').innerHTML = comms.slice(0, 24).map((communication) => {
    const customer = (appState.customers || []).find((item) => item.id === communication.customerId);
    return `
      <div class="communication-row">
        <div>
          <strong>${customer ? customer.name : communication.customerId}</strong>
          <div class="subtle">${(communication.message || '').slice(0, 86)}${(communication.message || '').length > 86 ? '...' : ''}</div>
        </div>
        <span class="chip state-${communication.status}">${communication.status}</span>
      </div>
    `;
  }).join('');
  toggleEmpty('communicationStream', 'communicationsEmpty', comms);
}

// ---------------------------------------------------------------
// Draft rendering
// ---------------------------------------------------------------

function renderDraft(draft) {
  hide('draftEmpty');
  const topSpenders = (draft.summary.topSpenders || [])
    .map((item) => `<span>${item.name}: ${money.format(item.spend)}</span>`)
    .join('');

  const aiLabel = draft.aiMode === 'llm' ? 'LLM-powered' : 'Rule-based';
  el('aiModeBadge').textContent = aiLabel;

  el('draftOutput').innerHTML = `
    <article class="draft-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Suggested segment · ${aiLabel}</p>
          <h3>${draft.segment.name}</h3>
          <p class="subtle">${draft.segment.description}</p>
        </div>
        <span class="chip">${draft.summary.audienceSize} shoppers</span>
      </div>
      <div class="mini-grid">
        <div class="mini-stat"><span>Channel</span><strong>${draft.message.channel}</strong></div>
        <div class="mini-stat"><span>Avg spend</span><strong>${money.format(draft.summary.avgSpend)}</strong></div>
        <div class="mini-stat"><span>Send window</span><strong>${draft.recommendation.sendWindow}</strong></div>
      </div>
      <p class="subtle">${(draft.message.rationale || []).join(' ')}</p>
      <div class="draft-message">${draft.message.body}</div>
      <div class="campaign-meta">${topSpenders || '<span>No matching shoppers yet</span>'}</div>
    </article>
  `;
}

function renderNoDraft() {
  el('draftOutput').innerHTML = '';
  show('draftEmpty');
}

// ---------------------------------------------------------------
// AI Chat
// ---------------------------------------------------------------

function appendChatMessage(text, role) {
  const container = el('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-msg-content">${text}</div>`;
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
    const result = await api('/api/ai/chat', {
      method: 'POST',
      body: { message }
    });
    appendChatMessage(result.reply, 'assistant');
    if (result.mode === 'llm') {
      el('chatModeBadge').textContent = 'LLM Live';
    } else {
      el('chatModeBadge').textContent = 'Offline mode';
    }
  } catch (err) {
    appendChatMessage('Sorry, something went wrong. Try again.', 'assistant');
    toast('Chat failed: ' + err.message, 'error');
  } finally {
    isChatting = false;
    el('chatSendBtn').disabled = false;
    input.focus();
  }
}

// ---------------------------------------------------------------
// Actions
// ---------------------------------------------------------------

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
    return;
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
  } catch (err) {
    toast('Failed to create campaign: ' + err.message, 'error');
  }
}

async function sendCampaign(campaignId) {
  const id = campaignId || latestCampaignId || (appState.campaigns || []).find((c) => c.status === 'draft')?.id;
  if (!id) {
    toast('No draft campaign to send. Create one first.', 'warn');
    return;
  }
  try {
    await api(`/api/campaigns/${id}/send`, { method: 'POST' });
    toast('Campaign sent! Watching for channel callbacks...');
    await refresh();
    // Poll for receipt updates
    setTimeout(refresh, 1600);
    setTimeout(refresh, 3600);
    setTimeout(refresh, 7000);
    setTimeout(refresh, 9500);
  } catch (err) {
    toast('Send failed: ' + err.message, 'error');
  }
}

function bindDynamicButtons() {
  document.querySelectorAll('.send-btn').forEach((button) => {
    button.onclick = () => sendCampaign(button.dataset.campaignId);
  });
}

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();

  el('refreshBtn').addEventListener('click', refresh);
  el('draftBtn').addEventListener('click', generateDraft);
  el('createCampaignBtn').addEventListener('click', createCampaign);
  el('sendLatestBtn').addEventListener('click', () => sendCampaign());
  el('addSegmentBtn')?.addEventListener('click', () => toast('Use the Command Center AI draft to create an audience segment.', 'info'));
  el('addCustomerBtn')?.addEventListener('click', () => toast('Customer ingestion is available through POST /api/customers.', 'info'));

  // Chat
  el('chatSendBtn').addEventListener('click', sendChat);
  el('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  await refresh();
  await generateDraft();

  // Auto-refresh for real-time receipt stream
  setInterval(refresh, 8000);
});
