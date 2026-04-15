// 🗄️ ӨРТӨӨ — Persistent API Key Store (JSON file)
const fs = require('fs');
const path = require('path');
const STORE_PATH = path.join(__dirname, 'data', 'api-keys.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { keys: {}, webhooks: [] };
  }
}

function save(store) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function generateKey() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let k = 'ort_';
  for (let i = 0; i < 32; i++) k += c[Math.floor(Math.random() * c.length)];
  return k;
}

module.exports = {
  createKey(tier = 'free', meta = {}) {
    const store = load();
    const key = generateKey();
    store.keys[key] = {
      tier, requests: 0,
      resetDate: new Date().toISOString().slice(0, 10),
      created: new Date().toISOString(),
      ...meta
    };
    save(store);
    return { key, tier };
  },

  getKey(key) {
    const store = load();
    return store.keys[key] || null;
  },

  incrementRequest(key) {
    const store = load();
    if (!store.keys[key]) return null;
    const info = store.keys[key];
    const today = new Date().toISOString().slice(0, 10);
    if (info.resetDate !== today) { info.requests = 0; info.resetDate = today; }
    info.requests++;
    save(store);
    return info;
  },

  listKeys() {
    const store = load();
    return Object.entries(store.keys).map(([key, info]) => ({
      key: key.slice(0, 8) + '...', tier: info.tier, requests: info.requests,
      resetDate: info.resetDate, created: info.created, name: info.name
    }));
  },

  deleteKey(key) {
    const store = load();
    if (!store.keys[key]) return false;
    delete store.keys[key];
    save(store);
    return true;
  },

  addWebhook(key, url) {
    const store = load();
    if (!store.keys[key]) return null;
    store.keys[key].webhook_url = url;
    save(store);
    return true;
  },

  getWebhooks(event) {
    const store = load();
    return Object.entries(store.keys)
      .filter(([, info]) => info.webhook_url && info.tier === 'pro')
      .map(([key, info]) => ({ key, url: info.webhook_url }));
  },

  logWebhook(apiKeyId, event, payload, status) {
    const store = load();
    if (!store.webhooks) store.webhooks = [];
    store.webhooks.push({ apiKeyId, event, payload, status, sentAt: new Date().toISOString() });
    if (store.webhooks.length > 1000) store.webhooks = store.webhooks.slice(-500);
    save(store);
  }
};
