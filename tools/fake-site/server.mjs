#!/usr/bin/env node
// Fake ClearPath website server.
//
// Simulates the ClearPath website leads endpoint (see docs/CONTRACTS.md, "Site
// endpoint contract") so the Helix lead poller can be developed and tested without a
// real site. Zero dependencies: node: builtins only.
//
// Run: npm run fake-site -- --seed 25
// See README.md in this folder for full documentation.

import http from 'node:http';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Fake ClearPath site server

Usage: node tools/fake-site/server.mjs [options]

Options:
  --seed <n>     Start with <n> realistic Utah trade leads (default 0).
  --slow         Delay every response by 5 seconds.
  --fail         Every request returns 500 (wins over --slow).
  --port <n>     Port to listen on (default 4711).
  --token <str>  Bearer token required for GET /api/crm/leads
                 (default: process.env.FAKE_SITE_TOKEN, or "dev-token").
  --help         Print this message and exit.
`);
}

const { values: args } = parseArgs({
  options: {
    seed: { type: 'string' },
    slow: { type: 'boolean', default: false },
    fail: { type: 'boolean', default: false },
    port: { type: 'string', default: '4711' },
    token: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (args.help) {
  printHelp();
  process.exit(0);
}

const PORT = Number(args.port) || 4711;
const TOKEN = args.token ?? process.env.FAKE_SITE_TOKEN ?? 'dev-token';
const SEED_COUNT = args.seed !== undefined ? Math.max(0, Number(args.seed) || 0) : 0;
const SLOW = Boolean(args.slow);
const FAIL = Boolean(args.fail);

// ---------------------------------------------------------------------------
// In-memory lead store, kept sorted by (createdAt, id) ascending at all times so
// paging never has to sort at request time.
// ---------------------------------------------------------------------------

/** @type {{id:string, createdAt:string, name:string|null, email:string|null, phone:string|null, service:string|null, message:string|null, pageUrl:string|null}[]} */
const leads = [];

function leadKeyLess(aCreatedAt, aId, bCreatedAt, bId) {
  if (aCreatedAt !== bCreatedAt) return aCreatedAt < bCreatedAt;
  return aId < bId;
}

// Inserts a lead maintaining the (createdAt, id) ascending sort. New leads are almost
// always the newest (createdAt = now), so scanning back from the tail is the common
// fast path, but this stays correct even if that ever changes.
function insertSorted(lead) {
  let i = leads.length - 1;
  while (i >= 0 && leadKeyLess(lead.createdAt, lead.id, leads[i].createdAt, leads[i].id)) {
    i--;
  }
  leads.splice(i + 1, 0, lead);
}

// ---------------------------------------------------------------------------
// Seed data: invented Utah trade leads. Never real businesses or people.
// ---------------------------------------------------------------------------

const UTAH_CITIES = [
  'Salt Lake City', 'Provo', 'Ogden', 'Sandy', 'West Jordan', 'Orem', 'Layton',
  'South Jordan', 'Lehi', 'Millcreek', 'Draper', 'St. George', 'Riverton', 'Roy',
  'Spanish Fork', 'Pleasant Grove', 'Cottonwood Heights', 'Tooele', 'Herriman', 'Logan',
];

const SERVICES = [
  'Sprinkler repair', 'Lawn care', 'Tree removal', 'Snow removal', 'Paver patio',
  'Gutter cleaning', 'Fence installation', 'Sod installation', 'Irrigation system install',
  'Landscape lighting',
];

const FIRST_NAMES = [
  'Braden', 'Kaitlyn', 'Tyler', 'Madison', 'Jace', 'Brielle', 'Dallin', 'Ashlyn',
  'Porter', 'Sydney', 'Kolton', 'Mikelle', 'Bridger', 'Adalyn', 'Cache', 'Brinley',
  'Rulon', 'Shaylee', 'Jaxon', 'Teigen',
];

const LAST_NAMES = [
  'Nielsen', 'Hansen', 'Christensen', 'Larsen', 'Whitmore', 'Rasmussen', 'Bunker',
  'Openshaw', 'Bagley', 'Merrill', 'Huntsman', 'Kimball', 'Petersen', 'Sorensen',
  'Wilcox', 'Beckstead', 'Fillmore', 'Judd', 'Snarr', 'Christofferson',
];

const DOMAINS = [
  'example-landscaping.com', 'wasatchlawncare.com', 'canyonviewturf.com',
  'redrockyardworks.com', 'timpviewlandscape.com', 'greatbasingroundskeeping.com',
  'alpinehardscapes.com', 'bonnevillelawnandsnow.com',
];

const MESSAGE_BY_SERVICE = {
  'Sprinkler repair': 'A few sprinkler heads in the back yard are not popping up, hoping someone can take a look this week.',
  'Lawn care': 'Looking for someone to do weekly mowing and edging for the rest of the season.',
  'Tree removal': 'We have a dead pine in the front yard that needs to come down before it falls on the fence.',
  'Snow removal': 'Need someone lined up for driveway plowing this winter, about a 40 foot driveway.',
  'Paver patio': 'Want a quote on a paver patio out back, roughly 300 square feet.',
  'Gutter cleaning': 'Gutters overflowed during the last storm, need them cleaned out before it gets colder.',
  'Fence installation': 'Looking to replace about 80 feet of chain link with vinyl fencing.',
  'Sod installation': 'Backyard is mostly dirt right now, want sod put in before it gets too hot.',
  'Irrigation system install': 'New build with no sprinkler system yet, need a full irrigation setup quoted.',
  'Landscape lighting': 'Want some path lighting added along the front walkway.',
};

function pick(arr, i) {
  return arr[i % arr.length];
}

function randomPhone(rng) {
  const areaCode = pick(['801', '385', '435'], Math.floor(rng() * 3));
  // 555 exchange is the reserved fictional range, never a real subscriber number.
  const last = String(100 + Math.floor(rng() * 900));
  return `(${areaCode}) 555-0${last}`;
}

// Small deterministic-ish PRNG seeded from index so re-running --seed with the same
// count is stable; not cryptographic, just for varied fake data.
function makeRng(seedIndex) {
  let state = (seedIndex + 1) * 2654435761 % 2 ** 32;
  return function rng() {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function buildSeedLead(index) {
  const rng = makeRng(index);
  const first = pick(FIRST_NAMES, Math.floor(rng() * FIRST_NAMES.length));
  const last = pick(LAST_NAMES, Math.floor(rng() * LAST_NAMES.length));
  const service = pick(SERVICES, Math.floor(rng() * SERVICES.length));
  const domain = pick(DOMAINS, Math.floor(rng() * DOMAINS.length));
  const city = pick(UTAH_CITIES, Math.floor(rng() * UTAH_CITIES.length));
  const name = `${first} ${last}`;
  const email = `${first}.${last}`.toLowerCase() + '@example.com';
  return {
    id: crypto.randomUUID(),
    // createdAt is assigned by the caller once the timestamp schedule is built.
    createdAt: null,
    name,
    email,
    phone: randomPhone(rng),
    service,
    message: `${MESSAGE_BY_SERVICE[service]} (${city})`,
    pageUrl: `https://${domain}/contact`,
  };
}

function seedLeads(count) {
  if (count <= 0) return;

  const now = Date.now();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const start = now - fourteenDaysMs;

  // Spread timestamps evenly across the past ~14 days, ascending.
  const timestamps = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? now : start + Math.floor((i * fourteenDaysMs) / (count - 1));
    timestamps.push(t);
  }

  // Force one tie: two adjacent leads share the exact same createdAt with different
  // ids, so cursor tie-break handling ((createdAt, id) ordering) gets exercised.
  // Lowering timestamps[k] to timestamps[k-1] keeps the array non-decreasing because
  // the interpolation above is strictly increasing, so timestamps[k+1] (unchanged)
  // is still greater than the new, smaller timestamps[k].
  if (count >= 2) {
    const k = Math.floor(count / 2);
    timestamps[k] = timestamps[k - 1];
  }

  for (let i = 0; i < count; i++) {
    const lead = buildSeedLead(i);
    lead.createdAt = new Date(timestamps[i]).toISOString();
    leads.push(lead);
  }

  // The timestamps are ascending by construction, but the forced tie pair shares
  // one and their random uuids decide that pair's order. Sort on the full
  // (createdAt, id) key so the array matches the order the cursor walks; without
  // this the tied pair can sit the wrong way round and paging skips one of them.
  leads.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

seedLeads(SEED_COUNT);

// ---------------------------------------------------------------------------
// Auth: constant-time bearer token comparison.
// ---------------------------------------------------------------------------

// Comparing tokens directly with === leaks timing information proportional to the
// number of matching leading bytes. Hashing both sides to fixed-length (32 byte)
// SHA-256 digests and comparing those with crypto.timingSafeEqual removes that
// leak, and guarantees the two buffers are always equal length so timingSafeEqual
// never throws.
function constantTimeTokenEqual(presented, expected) {
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Rate limiting: 60 requests per minute per presented token, sliding window, in
// memory. Keyed on the SHA-256 hash of the presented token (not the raw token, so
// tokens never sit in memory in plaintext) rather than on IP or on "is this
// request authorized" -- every request that carries a Bearer token counts against
// that token's window, including requests where the token turns out to be wrong.
// A request with no Authorization header at all has no token to key on and is
// simply rejected with 401 without touching the rate limiter.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
/** @type {Map<string, number[]>} */
const rateLimitWindows = new Map();

// Returns { limited: boolean, retryAfterSeconds: number }. Always records the
// request (pushes "now") before checking, so the request that trips the limit is
// itself counted -- request 61 within a minute is the first one rejected.
function checkRateLimit(tokenKey) {
  const now = Date.now();
  let times = rateLimitWindows.get(tokenKey) || [];
  times = times.filter((t) => now - t < RATE_WINDOW_MS);
  times.push(now);
  rateLimitWindows.set(tokenKey, times);
  if (times.length > RATE_LIMIT) {
    const oldest = times[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

// ---------------------------------------------------------------------------
// Cursor encoding: base64url("<createdAt ISO>|<id>").
// ---------------------------------------------------------------------------

function encodeCursor(createdAt, id) {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

// Decodes a cursor into { createdAt, id }, or returns null if it is not exactly
// two pipe-separated parts with a parseable ISO date in the first part.
function decodeCursor(raw) {
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split('|');
  if (parts.length !== 2) return null;
  const [createdAt, id] = parts;
  if (!id) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return { createdAt, id };
}

// Cursor tie rule: leads are ordered by (createdAt, id) ascending, and "after" means
// strictly after that position in that ordering -- (createdAt > X) OR (createdAt = X
// AND id > Y). Because createdAt is always produced by toISOString() (a fixed-width,
// zero-padded, UTC format), plain string comparison is equivalent to chronological
// comparison, so no Date parsing is needed at filter time.
function isAfterCursor(lead, cursor) {
  if (!cursor) return true;
  if (lead.createdAt !== cursor.createdAt) return lead.createdAt > cursor.createdAt;
  return lead.id > cursor.id;
}

// ---------------------------------------------------------------------------
// HTTP plumbing.
// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(json);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_BODY_BYTES = 64 * 1024;

// Reads the request body, rejecting with a TOO_LARGE-coded error as soon as more
// than maxBytes have arrived, so we never buffer an unbounded payload.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('Payload too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function projectLead(lead) {
  // Explicit field list: never let extra internal fields leak onto the wire.
  return {
    id: lead.id,
    createdAt: lead.createdAt,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    service: lead.service,
    message: lead.message,
    pageUrl: lead.pageUrl,
  };
}

function parseLimit(raw) {
  // Absent, empty, non-numeric, zero or negative all fall back to the default
  // rather than clamping, so a caller that sends ?limit= gets a useful page
  // instead of a page of one.
  if (raw === null || raw.trim() === '') return 100;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.trunc(n) < 1) return 100;
  return Math.min(200, Math.trunc(n));
}

async function handleGetLeads(req, res, url) {
  const authHeader = req.headers['authorization'];
  const match = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/) : null;

  if (!match) {
    // Missing header or malformed scheme -- nothing to key the rate limiter on.
    send(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    return;
  }

  const presented = match[1];
  const rateKey = sha256Hex(presented);
  const { limited, retryAfterSeconds } = checkRateLimit(rateKey);
  if (limited) {
    send(res, 429, { error: 'Rate limited' }, { 'Retry-After': String(retryAfterSeconds) });
    return;
  }

  if (!constantTimeTokenEqual(presented, TOKEN)) {
    send(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    return;
  }

  const limit = parseLimit(url.searchParams.get('limit'));

  // The poller omits `after` entirely on its first call and sends an empty one
  // in some hand-written curl; both mean "from the beginning", not "bad cursor"
  // (docs/CONTRACTS.md, clarifications).
  let cursor = null;
  const rawAfter = url.searchParams.get('after');
  if (rawAfter !== null && rawAfter !== '') {
    cursor = decodeCursor(rawAfter);
    if (!cursor) {
      send(res, 400, { error: 'Bad cursor' });
      return;
    }
  }

  const filtered = leads.filter((lead) => isAfterCursor(lead, cursor));
  const page = filtered.slice(0, limit);
  const nextCursor = page.length < limit ? null : encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id);

  send(res, 200, { leads: page.map(projectLead), nextCursor });
}

async function handlePostLead(req, res) {
  let body;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err && err.code === 'TOO_LARGE') {
      send(res, 413, { error: 'Payload too large' });
    } else {
      send(res, 400, { error: 'Bad request' });
    }
    return;
  }

  let parsed;
  try {
    parsed = body.length ? JSON.parse(body.toString('utf8')) : {};
  } catch {
    send(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    send(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
    send(res, 400, { error: 'name is required' });
    return;
  }

  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: parsed.name,
    email: typeof parsed.email === 'string' ? parsed.email : null,
    phone: typeof parsed.phone === 'string' ? parsed.phone : null,
    service: typeof parsed.service === 'string' ? parsed.service : null,
    message: typeof parsed.message === 'string' ? parsed.message : null,
    pageUrl: typeof parsed.pageUrl === 'string' ? parsed.pageUrl : null,
  };
  insertSorted(lead);

  send(res, 201, { ok: true, id: lead.id });
}

const server = http.createServer(async (req, res) => {
  try {
    if (FAIL) {
      // --fail wins over --slow: immediate failure, no delay.
      send(res, 500, { error: 'Simulated failure' });
      return;
    }
    if (SLOW) {
      await delay(5000);
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/crm/leads') {
      await handleGetLeads(req, res, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/leads') {
      await handlePostLead(req, res);
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch {
    // A throw after the response has started cannot be answered; drop the
    // socket rather than crashing the process on "headers already sent".
    if (res.headersSent) {
      res.destroy();
      return;
    }
    send(res, 500, { error: 'Internal error' });
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[fake-site] port ${PORT} is already in use. Stop whatever is on it, or pass --port <n>.`,
    );
    process.exit(1);
  }
  throw err;
});

// Loopback only: this is a development stub and has no business being
// reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  const flagsActive = [
    SEED_COUNT > 0 ? `seed=${SEED_COUNT}` : null,
    SLOW ? 'slow' : null,
    FAIL ? 'fail' : null,
  ].filter(Boolean);
  console.log(
    `[fake-site] listening on http://127.0.0.1:${PORT} | token="${TOKEN}" | leads=${leads.length} | flags=[${flagsActive.join(', ') || 'none'}]`,
  );
});

process.on('SIGINT', () => {
  console.log('\n[fake-site] shutting down');
  server.close(() => process.exit(0));
  // Force exit if close hangs (e.g. a keep-alive connection lingering).
  setTimeout(() => process.exit(0), 1000).unref();
});
