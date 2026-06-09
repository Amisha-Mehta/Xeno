const fs = require('fs');
const path = require('path');
const { createSeedState } = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'crm-state.json');

function serializeState(state) {
  return {
    ...state,
    seenReceiptIds: Array.from(state.seenReceiptIds || [])
  };
}

function hydrateState(raw) {
  return {
    ...raw,
    seenReceiptIds: new Set(raw.seenReceiptIds || [])
  };
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = createSeedState();
    saveState(seeded);
    return seeded;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return hydrateState(raw);
  } catch (error) {
    const seeded = createSeedState();
    saveState(seeded);
    return seeded;
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(serializeState(state), null, 2));
}

function resetState() {
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

module.exports = {
  DATA_FILE,
  loadState,
  saveState,
  resetState
};
