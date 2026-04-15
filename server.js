// 🏗️ ӨРТӨӨ — Mongolian Financial Data API Server
// Asset-Light Orchestration: Own the flow, not the node

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Data Layer — Reuse KhaanRate scrapers ──────────────────────
const { fetchAll, buildOfficial, CURRENCIES } = require('../khaanrate/bank-rates');
const { fetchAllLiveLoanRates } = require('../khaanrate/loan-scraper');
const taxConfig = require('../khaanrate/tax-config.json');
const U = require('../khaanrate/unified');

// ─── Cache ───────────────────────────────────────────────────────
let ratesCache = { data: null, ts: 0, ttl: 15 * 60 * 1000 };
let loanCache = { data: null, ts: 0, ttl: 60 * 60 * 1000 };

async function getRates() {
  if (ratesCache.data && Date.now() - ratesCache.ts < ratesCache.ttl) return ratesCache.data;
  const banks = await fetchAll();
  const official = buildOfficial(banks);
  ratesCache = { data: { banks, official }, ts: Date.now(), ttl: 15 * 60 * 1000 };
  return ratesCache.data;
}

async function getLoans() {
  if (loanCache.data && Date.now() - loanCache.ts < loanCache.ttl) return loanCache.data;
  const rates = await fetchAllLiveLoanRates();
  loanCache = { data: rates, ts: Date.now(), ttl: 60 * 60 * 1000 };
  return loanCache.data;
}

// ─── API Key Middleware ───────────────────────────────────────────
const apiKeys = new Map(); // key -> { tier, requests, resetDate }

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'ort_';
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'API key required. Get one at /api/docs' });

  const info = apiKeys.get(key);
  if (!info) return res.status(401).json({ error: 'Invalid API key' });

  // Daily reset
  const today = new Date().toISOString().slice(0, 10);
  if (info.resetDate !== today) { info.requests = 0; info.resetDate = today; }

  const limit = info.tier === 'pro' ? parseInt(process.env.PRO_LIMIT || 10000) : parseInt(process.env.FREE_LIMIT || 100);
  if (info.requests >= limit) return res.status(429).json({ error: 'Rate limit exceeded', limit, used: info.requests, tier: info.tier });

  info.requests++;
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', limit - info.requests);
  next();
}

// ─── PUBLIC ROUTES ───────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ name: 'ӨРТӨӨ API', version: '1.0.0', status: 'live', docs: '/api/docs' });
});

// API Documentation
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'ӨРТӨӨ — Mongolian Financial Data API',
    version: '1.0.0',
    baseUrl: '/api/v1',
    auth: 'Pass API key via X-API-Key header or api_key query param',
    endpoints: {
      'GET /api/v1/rates': 'All bank exchange rates',
      'GET /api/v1/rates/:currency': 'Rates for specific currency (usd,cny,eur,rub,jpy,krw,gbp)',
      'GET /api/v1/rates/:currency/best': 'Best buy/sell rates for currency',
      'GET /api/v1/official': 'Official MongolBank rates',
      'GET /api/v1/loans/mortgage': 'Mortgage rates from all banks',
      'GET /api/v1/loans/personal': 'Personal/salary loan rates',
      'GET /api/v1/loans/car': 'Car loan rates',
      'GET /api/v1/tax/config': 'Current tax configuration',
      'GET /api/v1/tax/car': 'Car import tax calculator (?price=&currency=&cc=&year=&country=)',
      'POST /api/v1/convert': 'Currency conversion ({ amount, from, to })',
      'POST /api/v1/loan/mortgage': 'Mortgage calculation ({ propertyPrice, downPct, years })',
      'POST /api/v1/loan/personal': 'Personal loan calculation ({ amount, months, salary })',
    },
    tiers: { free: `${process.env.FREE_LIMIT || 100} req/day`, pro: `${process.env.PRO_LIMIT || 10000} req/day` },
    getApiKey: 'POST /api/keys { tier: "free"|"pro" }',
  });
});

// ─── API KEY MANAGEMENT ──────────────────────────────────────────

app.post('/api/keys', (req, res) => {
  const tier = req.body.tier || 'free';
  if (!['free', 'pro'].includes(tier)) return res.status(400).json({ error: 'tier must be "free" or "pro"' });
  const key = generateKey();
  apiKeys.set(key, { tier, requests: 0, resetDate: new Date().toISOString().slice(0, 10), created: new Date().toISOString() });
  res.status(201).json({ key, tier, limits: { free: process.env.FREE_LIMIT || 100, pro: process.env.PRO_LIMIT || 10000 } });
});

// ─── PROTECTED ROUTES ────────────────────────────────────────────

// All exchange rates
app.get('/api/v1/rates', authMiddleware, async (req, res) => {
  try {
    const { banks, official } = await getRates();
    const result = {
      updated: new Date(ratesCache.ts).toISOString(),
      official: {},
      banks: banks.map(b => ({
        name: b.name,
        mn: b.mn,
        rates: Object.fromEntries(
          Object.entries(b.rates).map(([c, r]) => [c.toUpperCase(), { buy: r.buy, sell: r.sell }])
        )
      }))
    };
    for (const [c, v] of Object.entries(official || {})) result.official[c.toUpperCase()] = v;
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rates for specific currency
app.get('/api/v1/rates/:currency', authMiddleware, async (req, res) => {
  try {
    const cur = req.params.currency.toLowerCase();
    if (!CURRENCIES.includes(cur)) return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
    const { banks, official } = await getRates();
    const result = {
      currency: cur.toUpperCase(),
      official: official?.[cur] || null,
      updated: new Date(ratesCache.ts).toISOString(),
      banks: banks.filter(b => b.rates[cur]).map(b => ({
        name: b.name, mn: b.mn,
        buy: b.rates[cur].buy, sell: b.rates[cur].sell,
        spread: b.rates[cur].sell - b.rates[cur].buy
      })).sort((a, b) => a.sell - b.sell)
    };
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Best rates for currency
app.get('/api/v1/rates/:currency/best', authMiddleware, async (req, res) => {
  try {
    const cur = req.params.currency.toLowerCase();
    const { banks, official } = await getRates();
    const withRates = banks.filter(b => b.rates[cur]);
    const cheapest = [...withRates].sort((a, b) => a.rates[cur].sell - b.rates[cur].sell)[0];
    const bestBuy = [...withRates].sort((a, b) => b.rates[cur].buy - a.rates[cur].buy)[0];
    res.json({
      currency: cur.toUpperCase(),
      official: official?.[cur] || null,
      cheapest_sell: cheapest ? { bank: cheapest.name, mn: cheapest.mn, rate: cheapest.rates[cur].sell } : null,
      best_buy: bestBuy ? { bank: bestBuy.name, mn: bestBuy.mn, rate: bestBuy.rates[cur].buy } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Official rates
app.get('/api/v1/official', authMiddleware, async (req, res) => {
  try {
    const { official } = await getRates();
    res.json({ official, updated: new Date(ratesCache.ts).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── LOAN RATES ──────────────────────────────────────────────────

app.get('/api/v1/loans/mortgage', authMiddleware, async (req, res) => {
  try {
    const rates = await getLoans();
    res.json({ category: 'mortgage', rates: rates.mortgage, updated: new Date(loanCache.ts).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/loans/personal', authMiddleware, async (req, res) => {
  try {
    const rates = await getLoans();
    res.json({ category: 'personal', rates: rates.personal, updated: new Date(loanCache.ts).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/loans/car', authMiddleware, async (req, res) => {
  try {
    const rates = await getLoans();
    res.json({ category: 'car', rates: rates.car, updated: new Date(loanCache.ts).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      propertyPrice: parseFloat(propertyPrice),
      downPct: parseFloat(downPct) || 30,
      years: parseFloat(years) || 20,
      salary: salary ? parseFloat(salary) : null,
      currency: currency || 'mnt'
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/loan/personal', authMiddleware, async (req, res) => {
  try {
    const { amount, months, salary } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });
    const result = await U.calculatePersonalLoan({
      amount: parseFloat(amount),
      months: parseInt(months) || 12,
      salary: parseFloat(salary) || 2000000
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3401;
app.listen(PORT, () => {
  console.log(`🏗️ ӨРТӨӨ API running on :${PORT}`);
  console.log(`📖 Docs: http://localhost:${PORT}/api/docs`);

  // Auto-generate a free key for testing
  const testKey = generateKey();
  apiKeys.set(testKey, { tier: 'free', requests: 0, resetDate: new Date().toISOString().slice(0, 10), created: new Date().toISOString() });
  console.log(`🔑 Test API key: ${testKey}`);
});
