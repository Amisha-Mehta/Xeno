# Xeno Mini CRM

AI-native mini CRM for shopper engagement. It ingests customer and order data, builds behavioral audiences, drafts campaigns from natural language, sends personalized communications through a stubbed channel service, and tracks async receipt callbacks.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Product point of view

The product is a command center for a D2C brand marketer. Instead of asking the user to manually assemble every rule, the AI copilot turns a campaign goal into:

- A suggested shopper segment.
- Channel and send-window recommendations.
- Personalized message copy with merge fields.
- A draft campaign that can be sent immediately.

The first screen is the usable CRM dashboard: revenue, delivery and click rates, AI campaign planner, live campaign radar, audiences, and a callback receipt stream.

## Architecture

- `server.js`: dependency-free Node process that starts two HTTP services: CRM on `3000` and channel stub on `3001`.
- `lib/store.js`: in-memory CRM data model, seed customers, orders, segments, campaign metrics.
- `lib/ai.js`: deterministic AI-style planner that maps marketer intent to audience rules and campaign copy.
- `lib/channel.js`: stubbed channel service that asynchronously emits delivery, open, read, click, failure, and attributed-order receipts.
- `public/`: dashboard UI.

## APIs

- `GET /api/state`: dashboard state, customers, segments, campaigns, communications, receipts.
- `POST /api/customers`: ingest a customer.
- `POST /api/orders`: ingest an order.
- `POST /api/ai/draft`: generate an AI audience and campaign draft from a prompt.
- `POST /api/segments`: create a segment.
- `POST /api/campaigns`: create a campaign.
- `POST /api/campaigns/:id/send`: CRM send API. Creates per-recipient communications and calls the channel service.
- `POST /api/receipts`: CRM receipt callback API. Idempotently updates communication and campaign state.
- `POST http://localhost:3001/send`: channel-service send endpoint. Simulates outcomes and posts callbacks to CRM.

## System design choices

This take-home uses an in-memory store so the product is easy to review and run. At production scale, the same boundaries would move to durable storage and queues:

- CRM API persists campaigns and communications.
- Channel service receives send jobs over HTTP; at larger volume this would be queue backed.
- Receipt callbacks are idempotent using event IDs.
- Out-of-order receipts are handled using status ranking.
- Campaign metrics are derived from communication state and attributed orders.

## Demo flow

1. Open the command center.
2. Generate an AI draft from the default prompt.
3. Create the campaign.
4. Send the latest draft.
5. Switch to Receipt Loop and watch simulated callbacks update per-recipient communication state.
6. Return to Campaigns to see performance metrics.
