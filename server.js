// 🏗️ ӨРТӨӨ v2 — Mongolian Financial Data API Server
// Persistent keys, Webhooks, Business loans

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── Data Layer ──────────────────────────────────────────────────
const { fetchAll, buildOfficial, CURRENCIES } = require('../khaanrate/bank-rates');
const { fetchAllLiveLoanRates } = require('../khaanrate/loan-scraper');
const taxConfig = require('../khaanrate/tax-config.json');
const U = require('../khaanrate/unified');
const store = require('./store');

// ─── Cache ───────────────────────────────────────────────────────
let ratesCache = { data: null, ts: 0, ttl: 15 * 60 * 1000 };
let loanCache = { data: null, ts: 0, ttl: 60 * 60 * 1000 };
let lastRateSnapshot = null; // for webhook change detection

async function getRates() {
  if (ratesCache.data && Date.now() - ratesCache.ts < ratesCache.ttl) return ratesCache.data;
  const banks = await fetchAll();
  const official = buildOfficial(banks);
  const newData = { banks, official };
  
  // Webhook: detect rate changes
  if (lastRateSnapshot) {
    const oldUsd = lastRateSnapshot.official?.usd;
    const newUsd = official?.usd;
    if (oldUsd && newUsd && Math.abs(newUsd - oldUsd) > 1) {
      fireWebhooks('rate_change', { currency: 'USD', old: oldUsd, new: newUsd, change: newUsd - oldUsd });
    }
  }
  lastRateSnapshot = { official };
  
  ratesCache = { data: newData, ts: Date.now(), ttl: 15 * 60 * 1000 };
  return ratesCache.data;
}

async function getLoans() {
  if (loanCache.data && Date.now() - loanCache.ts < loanCache.ttl) return loanCache.data;
  const rates = await fetchAllLiveLoanRates();
  loanCache = { data: rates, ts: Date.now(), ttl: 60 * 60 * 1000 };
  return loanCache.data;
}

// ─── Webhook Dispatcher ──────────────────────────────────────────
async function fireWebhooks(event, payload) {
  const hooks = store.getWebhooks(event);
  for (const hook of hooks) {
    try {
      const res = await axios.post(hook.url, { event, timestamp: new Date().toISOString(), data: payload }, { timeout: 5000 });
      store.logWebhook(hook.key, event, payload, res.status);
    } catch (e) {
      store.logWebhook(hook.key, event, payload, e.response?.status || 0);
    }
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'API key required. Get one at /api/keys' });

  const info = store.getKey(key);
  if (!info) return res.status(401).json({ error: 'Invalid API key' });

  const today = new Date().toISOString().slice(0, 10);
  if (info.resetDate !== today) { info.requests = 0; info.resetDate = today; }

  const limit = info.tier === 'pro' ? parseInt(process.env.PRO_LIMIT || 10000) : parseInt(process.env.FREE_LIMIT || 100);
  if (info.requests >= limit) return res.status(429).json({ error: 'Rate limit exceeded', limit, used: info.requests, tier: info.tier });

  store.incrementRequest(key);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - info.requests - 1));
  next();
}

// ─── PUBLIC ROUTES ───────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/api/health', (req, res) => {
  res.json({ name: 'ӨРТӨӨ API', version: '2.0.0', status: 'live', uptime: process.uptime(), docs: '/api/docs' });
});

app.get('/api/docs', (req, res) => {
  res.json({
    name: 'ӨРТӨӨ — Mongolian Financial Data API',
    version: '2.0.0',
    baseUrl: '/api/v1',
    auth: 'X-API-Key header or api_key query param',
    endpoints: {
      'GET /api/v1/rates': 'All bank exchange rates',
      'GET /api/v1/rates/:currency': 'Rates for specific currency (usd,cny,eur,rub,jpy,krw,gbp)',
      'GET /api/v1/rates/:currency/best': 'Best buy/sell rates',
      'GET /api/v1/official': 'Official MongolBank rates',
      'GET /api/v1/loans/mortgage': 'Mortgage rates',
      'GET /api/v1/loans/personal': 'Personal/salary loan rates',
      'GET /api/v1/loans/car': 'Car loan rates',
      'GET /api/v1/loans/business': 'Business loan rates',
      'GET /api/v1/tax/config': 'Tax configuration',
      'POST /api/v1/convert': 'Currency conversion ({amount, from, to})',
      'POST /api/v1/loan/mortgage': 'Mortgage calculation ({propertyPrice, downPct, years})',
      'POST /api/v1/loan/personal': 'Personal loan calculation ({amount, months, salary})',
      'POST /api/v1/loan/business': 'Business loan calculation ({amount, months})',
      'POST /api/v1/webhook': 'Register webhook ({url}) — Pro only',
    },
    tiers: { free: `${process.env.FREE_LIMIT || 100} req/day`, pro: `${process.env.PRO_LIMIT || 10000} req/day` },
    getApiKey: 'POST /api/keys { tier, name, email }',
  });
});

// ─── API KEY MANAGEMENT ──────────────────────────────────────────

app.post('/api/keys', (req, res) => {
  const tier = req.body.tier || 'free';
  if (!['free', 'pro'].includes(tier)) return res.status(400).json({ error: 'tier must be "free" or "pro"' });
  const result = store.createKey(tier, { name: req.body.name, email: req.body.email });
  res.status(201).json({ ...result, limits: { free: process.env.FREE_LIMIT || 100, pro: process.env.PRO_LIMIT || 10000 } });
});

app.get('/api/keys', (req, res) => {
  res.json({ keys: store.listKeys() });
});

app.delete('/api/keys/:key', (req, res) => {
  const ok = store.deleteKey(req.params.key);
  ok ? res.json({ deleted: true }) : res.status(404).json({ error: 'Key not found' });
});

// ─── PROTECTED ROUTES ────────────────────────────────────────────

app.get('/api/v1/rates', authMiddleware, async (req, res) => {
  try {
    const { banks, official } = await getRates();
    res.json({
      updated: new Date(ratesCache.ts).toISOString(),
      official: Object.fromEntries(Object.entries(official || {}).map(([c, v]) => [c.toUpperCase(), v])),
      banks: banks.map(b => ({
        name: b.name, mn: b.mn,
        rates: Object.fromEntries(Object.entries(b.rates).map(([c, r]) => [c.toUpperCase(), { buy: r.buy, sell: r.sell }]))
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/rates/:currency', authMiddleware, async (req, res) => {
  try {
    const cur = req.params.currency.toLowerCase();
    if (!CURRENCIES.includes(cur)) return res.status(400).json({ error: `Currency: ${CURRENCIES.join(', ')}` });
    const { banks, official } = await getRates();
    res.json({
      currency: cur.toUpperCase(), official: official?.[cur] || null,
      updated: new Date(ratesCache.ts).toISOString(),
      banks: banks.filter(b => b.rates[cur]).map(b => ({
        name: b.name, mn: b.mn, buy: b.rates[cur].buy, sell: b.rates[cur].sell, spread: b.rates[cur].sell - b.rates[cur].buy
      })).sort((a, b) => a.sell - b.sell)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/rates/:currency/best', authMiddleware, async (req, res) => {
  try {
    const cur = req.params.currency.toLowerCase();
    const { banks, official } = await getRates();
    const withRates = banks.filter(b => b.rates[cur]);
    const cheapest = [...withRates].sort((a, b) => a.rates[cur].sell - b.rates[cur].sell)[0];
    const bestBuy = [...withRates].sort((a, b) => b.rates[cur].buy - a.rates[cur].buy)[0];
    res.json({
      currency: cur.toUpperCase(), official: official?.[cur] || null,
      cheapest_sell: cheapest ? { bank: cheapest.name, mn: cheapest.mn, rate: cheapest.rates[cur].sell } : null,
      best_buy: bestBuy ? { bank: bestBuy.name, mn: bestBuy.mn, rate: bestBuy.rates[cur].buy } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/official', authMiddleware, async (req, res) => {
  try {
    const { official } = await getRates();
    res.json({ official, updated: new Date(ratesCache.ts).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── LOAN RATES ──────────────────────────────────────────────────

app.get('/api/v1/loans/mortgage', authMiddleware, async (req, res) => {
  const rates = await getLoans();
  res.json({ category: 'mortgage', rates: rates.mortgage, updated: new Date(loanCache.ts).toISOString() });
});

app.get('/api/v1/loans/personal', authMiddleware, async (req, res) => {
  const rates = await getLoans();
  res.json({ category: 'personal', rates: rates.personal, updated: new Date(loanCache.ts).toISOString() });
});

app.get('/api/v1/loans/car', authMiddleware, async (req, res) => {
  const rates = await getLoans();
  res.json({ category: 'car', rates: rates.car, updated: new Date(loanCache.ts).toISOString() });
});

app.get('/api/v1/loans/business', authMiddleware, async (req, res) => {
  const rates = await getLoans();
  res.json({ category: 'business', rates: rates.business, updated: new Date(loanCache.ts).toISOString() });
});

// ─── TAX CONFIG ──────────────────────────────────────────────────

app.get('/api/v1/tax/config', authMiddleware, (req, res) => {
  res.json(taxConfig);
});

// ─── CALCULATORS ─────────────────────────────────────────────────

app.post('/api/v1/convert', authMiddleware, async (req, res) => {
  try {
    const { amount, from, to } = req.body;
    if (!amount || !from) return res.status(400).json({ error: 'amount and from are required' });
    const result = await U.convertCurrency(parseFloat(amount), from.toLowerCase(), (to || '').toLowerCase() || null);
    if (!result) return res.status(400).json({ error: 'Conversion failed' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/loan/mortgage', authMiddleware, async (req, res) => {
  try {
    const { propertyPrice, downPct, years, salary, currency } = req.body;
    if (!propertyPrice) return res.status(400).json({ error: 'propertyPrice is required' });
    const result = await U.calculateMortgage({
      propertyPrice: parseFloat(propertyPrice), downPct: parseFloat(downPct) || 30,
      years: parseFloat(years) || 20, salary: salary ? parseFloat(salary) : null, currency: currency || 'mnt'
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/loan/personal', authMiddleware, async (req, res) => {
  try {
    const { amount, months, salary } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });
    const result = await U.calculatePersonalLoan({
      amount: parseFloat(amount), months: parseInt(months) || 12, salary: parseFloat(salary) || 2000000
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/loan/business', authMiddleware, (req, res) => {
  try {
    const { amount, months } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });
    const result = U.calculateBusinessLoan({ amount: parseFloat(amount), months: parseInt(months) || 36 });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── WEBHOOK (Pro only) ──────────────────────────────────────────

app.post('/api/v1/webhook', authMiddleware, (req, res) => {
  const key = req.headers['x-api-key'] || req.query.api_key;
  const info = store.getKey(key);
  if (info.tier !== 'pro') return res.status(403).json({ error: 'Webhooks require Pro tier' });
  if (!req.body.url) return res.status(400).json({ error: 'url is required' });
  store.addWebhook(key, req.body.url);
  res.json({ registered: true, url: req.body.url, events: ['rate_change'] });
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3401;
app.listen(PORT, () => {
  console.log(`🏗️ ӨРТӨӨ API v2 running on :${PORT}`);
  console.log(`📖 Docs: http://localhost:${PORT}/api/docs`);
  console.log(`🔑 Create key: POST /api/keys {"tier":"free"}`);
});
