let appState = null;
let latestDraft = null;
let latestCampaignId = null;

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

function el(id) {
  return document.getElementById(id);
}

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
            <span>${campaign.status}</span>
            <span>${campaign.audienceSize || metrics.sent || 0} shoppers</span>
            <span>${money.format(metrics.revenueAttributed || 0)} attributed</span>
          </div>
        </div>
        ${campaign.status === 'draft' ? `<button class="primary send-btn" data-campaign-id="${campaign.id}">Send</button>` : '<span class="status-pill">Tracked</span>'}
      </div>
      ${compact ? '' : `<p class="subtle">${campaign.aiSummary || campaign.subject || 'Personalized campaign'}</p>`}
      <div class="progress-grid">${cells}</div>
    </article>
  `;
}

function renderCampaigns() {
  const campaigns = appState.campaigns;
  el('campaignRadar').innerHTML = campaigns.slice(0, 3).map((campaign) => renderCampaignCard(campaign, true)).join('');
  el('campaignList').innerHTML = campaigns.map((campaign) => renderCampaignCard(campaign)).join('');
}

function renderSegments() {
  el('segmentsList').innerHTML = appState.segments.map((segment) => `
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
}

function renderCustomers() {
  el('customersTable').innerHTML = appState.customers.map((customer) => `
    <tr>
      <td><strong>${customer.name}</strong><div class="subtle">${customer.city} · ${customer.segmentTags.join(', ')}</div></td>
      <td>${customer.preferredChannel}<div class="subtle">${customer.optedIn ? 'opted in' : 'opted out'}</div></td>
      <td>${money.format(customer.metrics.totalSpend)}<div class="subtle">${customer.metrics.orderCount} orders</div></td>
      <td>${customer.metrics.lastOrder ? customer.metrics.lastOrder.product : 'No orders'}<div class="subtle">${customer.metrics.daysSinceLastOrder} days ago</div></td>
    </tr>
  `).join('');
}

function renderReceipts() {
  el('receiptStream').innerHTML = appState.receipts.slice(0, 24).map((receipt) => `
    <div class="receipt-row">
      <div>
        <strong class="state-${receipt.type}">${receipt.type}</strong>
        <div class="subtle">${receipt.channel || 'crm'} · ${receipt.communicationId}</div>
      </div>
      <span class="subtle">${fmtDate(receipt.timestamp)}</span>
    </div>
  `).join('');

  el('communicationStream').innerHTML = appState.communications.slice(0, 24).map((communication) => {
    const customer = appState.customers.find((item) => item.id === communication.customerId);
    return `
      <div class="communication-row">
        <div>
          <strong>${customer ? customer.name : communication.customerId}</strong>
          <div class="subtle">${communication.message.slice(0, 86)}${communication.message.length > 86 ? '...' : ''}</div>
        </div>
        <span class="chip state-${communication.status}">${communication.status}</span>
      </div>
    `;
  }).join('');
}

function renderDraft(draft) {
  const topSpenders = draft.summary.topSpenders
    .map((item) => `<span>${item.name}: ${money.format(item.spend)}</span>`)
    .join('');
  el('draftOutput').innerHTML = `
    <article class="draft-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Suggested segment</p>
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
      <p class="subtle">${draft.message.rationale.join(' ')}</p>
      <div class="draft-message">${draft.message.body}</div>
      <div class="campaign-meta">${topSpenders || '<span>No matching shoppers yet</span>'}</div>
    </article>
  `;
}

async function refresh() {
  appState = await api('/api/state');
  renderMetrics();
  renderCampaigns();
  renderSegments();
  renderCustomers();
  renderReceipts();
  bindDynamicButtons();
}

async function generateDraft() {
  latestDraft = await api('/api/ai/draft', {
    method: 'POST',
    body: { prompt: el('promptInput').value }
  });
  renderDraft(latestDraft);
}

async function createCampaign() {
  if (!latestDraft) {
    await generateDraft();
  }
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
      offer: latestDraft.recommendation.recommendedOffer,
      aiSummary: latestDraft.message.rationale.join(' ')
    }
  });
  latestCampaignId = campaignResponse.campaign.id;
  await refresh();
}

async function sendCampaign(campaignId) {
  const id = campaignId || latestCampaignId || appState.campaigns.find((campaign) => campaign.status === 'draft')?.id;
  if (!id) {
    await createCampaign();
    return sendCampaign(latestCampaignId);
  }
  await api(`/api/campaigns/${id}/send`, { method: 'POST' });
  await refresh();
  setTimeout(refresh, 1600);
  setTimeout(refresh, 3600);
  setTimeout(refresh, 7000);
  setTimeout(refresh, 9500);
}

function bindDynamicButtons() {
  document.querySelectorAll('.send-btn').forEach((button) => {
    button.onclick = () => sendCampaign(button.dataset.campaignId);
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
  el('sendLatestBtn').addEventListener('click', () => sendCampaign());
  await refresh();
  await generateDraft();
  setInterval(refresh, 6000);
});
