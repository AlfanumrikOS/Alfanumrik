# MOL Cassettes

Recorded HTTP exchanges (request + response) for deterministic provider tests.
This directory is read by `cassette-helper.ts`. CI runs in playback mode and
will never make a real provider call.

## How playback works

When a vitest test calls `withCassette('my-fixture', async () => { ... })`:

1. The helper reads `cassettes/my-fixture.json` from disk before the inner
   function runs. A missing file fails the test immediately — there is no
   silent fall-through to live HTTP.
2. The helper installs a `globalThis.fetch` interceptor.
3. Each `fetch` call during the test computes a SHA-256 hash of the request
   (method + URL + headers minus auth + body) and asserts it matches the
   cassette's `request_hash`. A mismatch fails the test with a "cassette
   drifted, re-record" error.
4. The interceptor synthesises a `Response` from the recorded `status`,
   `headers`, and `chunks`. SSE responses replay chunk-by-chunk using a
   `ReadableStream`, preserving frame boundaries.
5. The original `fetch` is restored when the inner function resolves or
   throws.

## How recording works

```bash
# Locally only — never in CI.
MOL_CASSETTE_MODE=record npx vitest run path/to/test.ts
```

When `MOL_CASSETTE_MODE=record`:

1. The helper still installs a `fetch` interceptor.
2. Each intercepted call hits the *real* provider with the original
   `globalThis.fetch`.
3. The response is cloned, streaming chunks are captured in order, and the
   cassette is written to `cassettes/<fixturePath>.json`.
4. The live response is returned to the caller so the test still asserts on
   real behaviour during the recording run.

The recorder strips before writing:

- `Authorization`, `x-api-key`, `anthropic-api-key`, `cookie`,
  `set-cookie`, `proxy-authorization` headers.
- Body fields named `token`, `access_token`, `refresh_token`, `api_key`,
  `apikey`, `password`, `email`, `phone`, `phone_number`, `student_id`
  (case-insensitive, recursive).

## When to refresh a cassette

Re-record when *any* of:

- The provider request shape changes (new field, renamed field, header
  added). The hash will drift and tests will fail with a clear message.
- The provider model/version is bumped in `providers/anthropic.ts` or
  `providers/openai.ts` and the recorded response no longer reflects
  current API behaviour.
- The provider releases a breaking SSE format change.

Re-record by running the test locally with `MOL_CASSETTE_MODE=record`,
inspect the diff to verify no secrets leaked, then `git add -f` the new
cassette file.

## CI guard

`cassette-helper.ts` throws synchronously at import time if `CI=true` and
`MOL_CASSETTE_MODE=record`. This makes it structurally impossible to burn
provider tokens during a CI run.

## Streaming responses

SSE responses are recorded as a sequence of decoded UTF-8 chunks in
`response.chunks`, preserving the boundaries the provider emitted. Playback
re-enqueues them one chunk at a time on a `ReadableStream`, so the SSE
parser under test sees the same frame splits it would see in production.

A non-streamed response is recorded with `streamed: false` and a single
chunk containing the full body.

## File layout

```
cassettes/
├── README.md                  ← this file
├── .gitignore                 ← only commit curated fixtures
├── <named-fixture>.json       ← canonical cassettes, checked in
└── fixtures/                  ← gitignored sandbox for local experiments
```

## Cassette JSON schema (version 1)

```jsonc
{
  "version": 1,
  "request_hash": "<sha256 hex>",
  "recorded_at": "2026-05-18T12:34:56.789Z",
  "request": {
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "headers": { "anthropic-version": "2023-06-01", "content-type": "application/json" },
    "body": { "model": "claude-haiku-4-5-20251001", "messages": [ /* ... */ ] }
  },
  "response": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "chunks": ["{\"content\":[{\"type\":\"text\",\"text\":\"Hi.\"}], ...}"],
    "streamed": false
  }
}
```

For streamed responses, `streamed` is `true` and `chunks` contains the raw
SSE frames in emission order:

```jsonc
{
  "response": {
    "status": 200,
    "headers": { "content-type": "text/event-stream" },
    "chunks": [
      "event: message_start\ndata: {\"type\":\"message_start\",...}\n\n",
      "event: content_block_delta\ndata: {\"delta\":{\"text\":\"Hi\"}}\n\n",
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
    ],
    "streamed": true
  }
}
```
