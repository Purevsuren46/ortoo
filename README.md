# ӨРТӨӨ — Mongolian Financial Data API

Asset-Light Orchestration: Own the flow, not the node.

## Quick Start

```bash
npm install
cp .env.example .env
node server.js
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/api/docs` | Full documentation |
| POST | `/api/keys` | Create API key (`{tier: "free"|"pro"}`) |
| GET | `/api/v1/rates` | All bank exchange rates |
| GET | `/api/v1/rates/:currency` | Rates for specific currency |
| GET | `/api/v1/rates/:currency/best` | Best buy/sell rates |
| GET | `/api/v1/official` | Official MongolBank rates |
| GET | `/api/v1/loans/mortgage` | Mortgage rates from all banks |
| GET | `/api/v1/loans/personal` | Personal/salary loan rates |
| GET | `/api/v1/loans/car` | Car loan rates |
| GET | `/api/v1/tax/config` | Current tax configuration |
| POST | `/api/v1/convert` | Currency conversion |
| POST | `/api/v1/loan/mortgage` | Mortgage calculation |
| POST | `/api/v1/loan/personal` | Personal loan calculation |

## Auth

Pass API key via `X-API-Key` header or `api_key` query parameter.

- **Free**: 100 requests/day
- **Pro**: 10,000 requests/day

## Architecture

Built on top of [KhaanRate](https://github.com/Purevsuren46/khaanrate) scrapers:
- `bank-rates.js` — 5 banks, live exchange rates
- `loan-scraper.js` — 6 banks, live loan rates
- `unified.js` — Calculators + formatters
- Cache: 15min rates, 60min loans
