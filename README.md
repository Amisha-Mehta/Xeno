# Xeno Mini CRM

AI-native mini CRM for reaching shoppers. The product helps a D2C marketer ingest shopper data, ask an AI copilot for campaign strategy, create behavior-based audiences, send personalized communications, and track the full channel lifecycle through async callbacks.

GitHub one-line summary:

> AI-native shopper CRM that segments customers, drafts campaigns, sends through a stubbed channel service, and tracks async delivery/engagement receipts.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

`npm start` runs both services in one process for convenience:

- CRM app/API: `http://localhost:3000`
- Channel stub service: `http://localhost:3001`

You can also run them separately:

```bash
npm run start:channel
npm run start:crm
```

## API connection status

Yes, the APIs are connected.

- The frontend calls the CRM APIs using `fetch`.
- The CRM exposes `POST /api/campaigns/:id/send`.
- When a campaign is sent, the CRM calls the separate channel service at `POST http://localhost:3001/send`.
- The channel service simulates outcomes asynchronously.
- The channel service calls back into the CRM receipt API at `POST /api/receipts`.
- The CRM idempotently updates communication state and recomputes campaign metrics.

Health checks:

- `GET http://localhost:3000/api/health`
- `GET http://localhost:3001/health`

## Product point of view

I chose to build an AI-assisted campaign command center for a consumer brand marketer. The product focuses on the core Xeno loop:

- Ingest customer and order data.
- Decide who to talk to using behavior and attributes.
- Use AI to recommend an audience, channel, send window, and message.
- Send personalized communications.
- Track delivery and engagement through a callback-driven channel loop.

This is intentionally not a sales CRM. There are no pipelines, deals, tickets, or support workflows.

## Architecture

```text
Browser UI
   |
   | fetch
   v
CRM Service :3000
   |-- customers, orders, segments, campaigns
   |-- POST /api/campaigns/:id/send
   |-- POST /api/receipts
   |-- persists state to data/crm-state.json
   |
   | HTTP send request
   v
Channel Stub Service :3001
   |-- simulates delivered, failed, opened, read, clicked
   |-- simulates duplicate and out-of-order receipts
   |-- retries failed callbacks
   |
   | async callback
   v
CRM Receipt API
   |
   v
Campaign metrics dashboard
```

## APIs

- `GET /api/state`: dashboard state, customers, segments, campaigns, communications, receipts.
- `GET /api/health`: CRM health check.
- `POST /api/customers`: ingest a customer.
- `POST /api/orders`: ingest an order.
- `POST /api/ai/draft`: generate an AI audience and campaign draft from a prompt.
- `POST /api/ai/chat`: chat with the campaign strategist AI.
- `POST /api/segments`: create a segment.
- `POST /api/campaigns`: create a campaign.
- `POST /api/campaigns/:id/send`: CRM send API.
- `POST /api/receipts`: CRM receipt callback API.
- `POST /api/admin/reset`: reset demo data.
- `GET http://localhost:3001/health`: channel service health check.
- `POST http://localhost:3001/send`: channel service send endpoint.

## Key files

- `server.js`: starts CRM and channel service together for local demo.
- `crm-server.js`: starts only the CRM service.
- `channel-server.js`: starts only the channel stub service.
- `lib/crm-app.js`: CRM API, receipt ingestion, campaign send logic.
- `lib/channel-app.js`: channel HTTP service.
- `lib/channel.js`: outcome simulation.
- `lib/store.js`: data model, seed data, segmentation, metrics.
- `lib/ai.js`: deterministic AI-style campaign planner.
- `lib/persistence.js`: JSON persistence.
- `public/`: dashboard UI.
- `tests/run-tests.js`: focused behavior tests.

## Improvements already added

- Split CRM and channel into separate services.
- Added persistent JSON storage in `data/crm-state.json`.
- Added health checks.
- Added channel retries.
- Added duplicate receipt simulation.
- Added out-of-order receipt simulation.
- Added idempotent receipt handling.
- Added status ranking so older events do not downgrade communication state.
- Added focused tests for AI draft, segmentation, metrics, idempotency, and out-of-order receipts.
- Polished the UI to feel more elegant, professional, and demo-ready.

## System design tradeoffs

For the take-home scope, JSON persistence keeps the project easy to run and review. At production scale, I would move state to Postgres or MongoDB, send campaign jobs through a queue, store receipts as an append-only event stream, process callbacks with workers, and aggregate metrics asynchronously.

The channel stub is separate over HTTP, but still local. At scale, it would be independently deployed and queue-backed.

The AI planner works without an API key using a deterministic offline engine. If `OPENAI_API_KEY` is present, the app first tries an OpenAI-compatible chat completion call for richer campaign strategy and falls back safely to the offline engine if the request fails.

Optional AI environment variables:

```bash
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

## Tests

```bash
npm test
```

## Demo flow

1. Open `http://localhost:3000`.
2. Generate an AI draft from the default prompt.
3. Create the campaign.
4. Send the latest draft.
5. Open the Receipt Loop tab and watch callbacks update recipient state.
6. Open Campaigns and review sent, delivered, opened, read, clicked, failed, and attributed revenue.

## Deployment note

Render, Railway, or Fly.io are good fits for this project. For the simplest hosted demo, deploy `npm start` and expose the CRM port. For a more production-like deployment, run the CRM and channel service as separate processes with `CHANNEL_URL` and `CRM_URL` environment variables.
