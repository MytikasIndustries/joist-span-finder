import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuote, quoteSummary, ghlContact } from '../src/quote.js';
import { onRequestPost } from '../functions/api/quote.js';
import { evaluate, fromQuery, toQuery, roughQuantity, selectedRow, escapeHtml } from '../src/logic.js';

const QUERY = '?use=living&dl=10&ft=14&in=0&oc=16&span=single&defl=360&sel=800S200-54&area=1200&job=Smith+residence&loc=Florence%2C+CO';
const GOOD = { name: 'Dana Ruiz', company: 'Ruiz Builders', email: 'Dana@Example.com ', phone: '(719) 555-0100', role: 'gc', notes: 'Need by May', query: QUERY };

test('job details, chosen joist and floor area travel in the link', () => {
  const s = fromQuery(QUERY);
  assert.equal(s.sel, '800S200-54');
  assert.equal(s.area, 1200);
  assert.equal(s.job, 'Smith residence');
  assert.equal(s.loc, 'Florence, CO');
  assert.deepEqual(fromQuery(toQuery(s)), s);
  assert.equal(fromQuery('?sel=999S999-99').sel, '');
  assert.equal(fromQuery(`?job=${'x'.repeat(200)}`).job.length, 80);
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('a chosen joist is used only while it still makes the span', () => {
  const r = evaluate({ dl: 10, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 168 });
  assert.equal(selectedRow(r, '800S200-54').member, '800S200-54');
  assert.equal(selectedRow(r, '').member, '600S200-54');
  const longer = evaluate({ dl: 10, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 240 });
  assert.equal(selectedRow(longer, '800S200-54').member, longer.pick.member);
});

test('rough quantity: lineal feet from spacing, pounds from weight', () => {
  const r = evaluate({ dl: 10, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 168 });
  const row = selectedRow(r, '800S200-54');
  // 1,200 sq ft at 16" o.c. = 900 lineal ft; 900 × 2.47 lb/ft = 2,223 lb.
  assert.deepEqual(roughQuantity(row, 1200, 16), { linealFt: 900, lb: 2223 });
  assert.equal(roughQuantity(row, 0, 16), null);
});

test('quote requests are checked and cleaned', () => {
  const ok = validateQuote(GOOD);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.email, 'dana@example.com');
  const bad = validateQuote({ name: ' ', email: 'nope', phone: 'call me', query: 42 });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['email', 'name', 'phone']);
  assert.equal(bad.value.role, 'other');
  assert.equal(validateQuote({ ...GOOD, notes: 'x'.repeat(5000) }).value.notes.length, 2000);
});

test('the sales note describes exactly what they selected', () => {
  const note = quoteSummary(validateQuote(GOOD).value, 'https://mytikas-spans.pages.dev');
  assert.match(note, /Contact: Dana Ruiz, Ruiz Builders \(General contractor\)/);
  assert.match(note, /Job: Smith residence, Florence, CO/);
  assert.match(note, /Table used: 10 psf dead \+ 40 psf live\n/);
  assert.match(note, /Span: 14'-0", one span, 16" o\.c\., live-load deflection L\/360/);
  assert.match(note, /Joist: 800S200-54 \(8" web, 16 ga, 54 mil, 50 ksi\), allowable 17'-6", 2\.47 lb\/ft/);
  assert.match(note, /about 900 lineal ft and 2,223 lb of joists/);
  assert.match(note, /Notes: Need by May/);
  assert.match(note, /Open their selection: https:\/\/mytikas-spans\.pages\.dev\/\?use=living/);
});

test('the Go High Level contact carries name, company and tags', () => {
  const c = ghlContact(validateQuote(GOOD).value, 'LOC123');
  assert.deepEqual(
    { locationId: c.locationId, firstName: c.firstName, lastName: c.lastName, companyName: c.companyName, email: c.email },
    { locationId: 'LOC123', firstName: 'Dana', lastName: 'Ruiz', companyName: 'Ruiz Builders', email: 'dana@example.com' },
  );
  assert.deepEqual(c.tags, ['joist span finder', 'role: gc']);
});

// ---- the /api/quote endpoint, with Go High Level stubbed out ----

function post(body, headers = {}) {
  return new Request('https://mytikas-spans.pages.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://mytikas-spans.pages.dev', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const ENV = { GHL_API_TOKEN: 'test-token', GHL_LOCATION_ID: 'LOC123' };

async function withFetch(responses, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  const errors = console.error;
  console.error = () => {};
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
    console.error = errors;
  }
}

test('endpoint: creates the contact, then adds the note', async () => {
  const { result, calls } = await withFetch(
    [{ status: 200, body: { contact: { id: 'abc' } } }, { status: 201, body: {} }],
    () => onRequestPost({ request: post(GOOD), env: ENV }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(calls[0].url, 'https://services.leadconnectorhq.com/contacts/upsert');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].init.headers.Version, '2021-07-28');
  assert.equal(JSON.parse(calls[0].init.body).locationId, 'LOC123');
  assert.equal(calls[1].url, 'https://services.leadconnectorhq.com/contacts/abc/notes');
  assert.match(JSON.parse(calls[1].init.body).body, /800S200-54/);
});

test('endpoint: a failed note still counts as sent', async () => {
  const { result } = await withFetch(
    [{ status: 200, body: { contact: { id: 'abc' } } }, { status: 500, body: {} }],
    () => onRequestPost({ request: post(GOOD), env: ENV }),
  );
  assert.equal(result.status, 200);
});

test('endpoint: refuses bad input, other sites, bots and missing setup', async () => {
  const { result: invalid, calls } = await withFetch([], () =>
    onRequestPost({ request: post({ ...GOOD, email: 'x' }), env: ENV }),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).fields.email, 'Enter an email address we can reply to.');
  assert.equal(calls.length, 0);

  const { result: foreign } = await withFetch([], () =>
    onRequestPost({ request: post(GOOD, { Origin: 'https://evil.example' }), env: ENV }),
  );
  assert.equal(foreign.status, 403);

  const { result: notJson } = await withFetch([], () => onRequestPost({ request: post('{oops'), env: ENV }));
  assert.equal(notJson.status, 400);

  const { result: bot, calls: botCalls } = await withFetch([], () =>
    onRequestPost({ request: post({ ...GOOD, website: 'spam.example' }), env: ENV }),
  );
  assert.equal(bot.status, 200);
  assert.equal(botCalls.length, 0);

  const { result: unset } = await withFetch([], () => onRequestPost({ request: post(GOOD), env: {} }));
  assert.equal(unset.status, 503);

  const { result: crmDown } = await withFetch([{ status: 401, body: {} }], () =>
    onRequestPost({ request: post(GOOD), env: ENV }),
  );
  assert.equal(crmDown.status, 502);
});
