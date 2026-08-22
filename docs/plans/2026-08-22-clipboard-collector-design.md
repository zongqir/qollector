# Qollect Clipboard Collector Design

## Goal

Provide a small self-hosted ingestion service for daily AI analysis of clipboard text. The collector is intentionally separate from Qollect and does not implement AI, a database, a client-side retry queue, or a query API.

## Data policy

- Only text-like events are accepted.
- Images, files, binary formats, and other non-text types are rejected.
- New events are appended to a date-partitioned JSONL file.
- Text longer than the configured limit is stored as a preview, with original length, SHA-256, and a truncation flag.
- Old files are removed according to the configured retention period.

## Deployment

The repository provides a standalone Go service, Dockerfile, two Docker Compose modes, and an environment example. The default Compose file runs only the collector on localhost so an existing reverse proxy can be reused. The standalone Compose file adds Caddy and owns ports 80/443 for servers without an existing reverse proxy. Both modes persist `/data` through a host-mounted volume. Registry images can be published later without changing the HTTP contract.

## API

- `GET /healthz` is unauthenticated.
- `POST /v1/clipboard-events` requires `Authorization: Bearer <token>`.
- The request contains event ID, capture time, content type, content, and optional source application.

## Non-goals

No historical backfill, durable upload queue, AI invocation, user management, web UI, or database is included in the first version.

## Desktop client behavior

- Collector configuration is stored through Qollect's encrypted config store.
- Only new `text` and `link` items are uploaded; images and files are skipped.
- Upload runs in a background task and never blocks clipboard capture or the UI.
- The local database records successful item IDs only. Startup and periodic scans retry only unuploaded items from the last 24 hours; older failures are ignored.
- Settings provides endpoint, token, enable/disable, a connectivity test, and an explicit privacy notice.
