# fake-site

A zero-dependency Node HTTP server that simulates the ClearPath website leads
endpoint, so the Helix lead poller can be developed and tested without a real
ClearPath site running.

It implements exactly the "Site endpoint contract (ClearPath templates)" section of
`docs/CONTRACTS.md`, plus a `POST /api/leads` endpoint mirroring a ClearPath quote
form, so a developer can add leads with curl.

Zero dependencies: only `node:http`, `node:crypto`, and `node:util` (for
`parseArgs`). Requires Node 20+ (ESM).

## Running it

```
npm run fake-site -- --seed 25
```

That runs `node tools/fake-site/server.mjs --seed 25`. Anything after `--` in the
npm script is passed straight to the server as CLI flags.

## Flags

| Flag            | Default                                     | Meaning |
|-----------------|----------------------------------------------|---------|
| `--seed <n>`    | `0`                                          | Start with `<n>` invented Utah trade leads (see "Seed data" below). |
| `--slow`        | off                                          | Delay every response by 5 seconds, to test poller timeout handling. |
| `--fail`        | off                                          | Every request returns `500 { "error": "Simulated failure" }`, to test poller error handling. Wins over `--slow` if both are given. |
| `--port <n>`    | `4711`                                       | Port to listen on. |
| `--token <str>` | `process.env.FAKE_SITE_TOKEN`, else `"dev-token"` | Bearer token required by `GET /api/crm/leads`. |
| `--help`        | —                                            | Print usage and exit. |

On startup the server logs one line with the port, the token in use, the current
lead count, and which flags are active, e.g.:

```
[fake-site] listening on http://127.0.0.1:4711 | token="dev-token" | leads=25 | flags=[seed=25]
```

## Endpoints

### `GET /api/crm/leads?after=<cursor>&limit=<n>`

Requires `Authorization: Bearer <token>`.

```
curl -s -H 'Authorization: Bearer dev-token' 'http://127.0.0.1:4711/api/crm/leads?limit=10'
```

- Missing or malformed `Authorization` header, or the wrong token, returns
  `401 { "error": "Unauthorized" }` with a `WWW-Authenticate: Bearer` header.
- The token comparison is constant-time: both the presented token and the expected
  token are SHA-256 hashed with `node:crypto`, and the two 32-byte digests are
  compared with `crypto.timingSafeEqual` (always equal length, so it never throws).
  This avoids leaking how many leading characters of the token were correct via
  response timing.
- `after` is optional. Omitted entirely (what the Helix poller does on its
  first call) or sent empty, it means "from the beginning"; only a cursor that
  is present and unreadable is a `400`.
- `limit` defaults to 100 and is capped at 200. An absent, empty, non-numeric,
  zero or negative `limit` falls back to the default of 100.
- Leads are kept ordered by `(createdAt, id)` ascending at all times (the
  in-memory list is inserted in sorted position, so requests never sort).
- A `200` response body is exactly:

  ```json
  { "leads": [ { "id": "...", "createdAt": "...", "name": "...", "email": "...", "phone": "...", "service": "...", "message": "...", "pageUrl": "..." } ], "nextCursor": "..." }
  ```

  `id` is a string, `createdAt` is an ISO 8601 string, and the other six fields
  may be `null`. No other fields ever appear on a lead.

### Cursor

`after` is an opaque cursor: `base64url("<createdAt ISO>|<id>")`. It is resolved
as "strictly after that position in `(createdAt, id)` order":

```
(createdAt > X) OR (createdAt = X AND id > Y)
```

This is what makes paging stable when two leads share the exact same `createdAt`:
the tie is broken by `id`, not dropped or duplicated. The seed data (see below)
always includes at least one such tie so this path gets exercised.

`nextCursor` in the response is the cursor of the last lead returned, or `null`
when fewer than `limit` leads were returned (i.e. the caller has caught up and
there is nothing more to page through).

An `after` value that does not base64url-decode into exactly two
pipe-separated parts, with the first part a parseable ISO date, returns
`400 { "error": "Bad cursor" }`.

To page through everything:

```
curl -s -H 'Authorization: Bearer dev-token' 'http://127.0.0.1:4711/api/crm/leads?limit=10' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["nextCursor"])'
# then:
curl -s -H 'Authorization: Bearer dev-token' 'http://127.0.0.1:4711/api/crm/leads?limit=10&after=<cursor from above>'
```

### Rate limiting

60 requests per minute per token, sliding window, tracked in memory (it resets
if the process restarts).

The limiter is keyed on the SHA-256 hash of the *presented* token, not on the
caller's IP and not on whether the token turned out to be correct. That means a
request with a wrong-but-present token still counts against that token's
window and can itself trigger `401`s that count toward `429`s -- this is a
deliberate choice so that hammering the endpoint with bad tokens cannot be used
as a way to dodge the limiter. A request with no `Authorization` header at all
has no token to key on, so it is simply rejected with `401` and never touches
the rate limiter.

Going over the limit returns `429 { "error": "Rate limited" }` with a
`Retry-After` header (seconds until the oldest request in the current window
ages out).

```
for i in $(seq 1 61); do
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer some-fresh-token' 'http://127.0.0.1:4711/api/crm/leads?limit=1'
done
```

With a token that has made no other requests in the last minute, the first 60
calls return `200`/`401` (depending on whether the token is correct) and the
61st returns `429`.

### `POST /api/leads`

No auth -- this is the public quote form endpoint.

```
curl -s -X POST http://127.0.0.1:4711/api/leads \
  -H 'Content-Type: application/json' \
  -d '{"name":"Jordan Test","email":"jordan@example.com","phone":"(801) 555-0199","service":"Lawn care","message":"Curl test lead","pageUrl":"https://example-landscaping.com/contact"}'
```

Accepts the same JSON shape a ClearPath quote form sends: `{ name, email,
phone, service, message, pageUrl }`. Any subset is accepted; `name` is the
only required field. Appends a new lead with a fresh id and `createdAt` set to
now, and responds `201 { "ok": true, "id": "<id>" }`.

- A body over 64 KB returns `413 { "error": "Payload too large" }`.
- A non-JSON (or non-object) body returns `400 { "error": "Invalid JSON" }`.
- A missing or blank `name` returns `400 { "error": "name is required" }`.

### Anything else

`404 { "error": "Not found" }`. Every response, on every endpoint, has
`Content-Type: application/json; charset=utf-8`.

## Seed data

`--seed <n>` generates `<n>` invented Utah trade-business leads: fictional
names, Utah cities, trade services (sprinkler repair, lawn care, tree removal,
snow removal, paver patio, etc.), realistic `(801)/(385)/(435) 555-01xx` phone
numbers (the 555 exchange is the standard reserved fictional range), and
short homeowner-style messages. None of it refers to a real business or
person. `createdAt` values are spread backwards over the past ~14 days in
ascending order, and one pair of adjacent seed leads is always given the exact
same `createdAt` (with different ids) so the cursor's tie-break rule gets
exercised whenever you seed 2 or more leads.

## Signals for poller testing

- `--slow` adds a 5 second delay to every response, for testing the poller's
  timeout handling.
- `--fail` makes every request return `500 { "error": "Simulated failure" }`,
  for testing the poller's error handling. If both `--slow` and `--fail` are
  given, `--fail` wins (no delay, immediate failure).

## Shutting down

`Ctrl-C` (`SIGINT`) closes the server cleanly.

## Notes

The server binds loopback only (`127.0.0.1`), so nothing on the network can
reach it. If port 4711 is already taken it says so and exits 1 rather than
throwing a stack trace; pass `--port <n>` to move it.
