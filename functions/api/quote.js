// Cloudflare Pages Function: POST /api/quote
// Turns a quote request from the page into a Go High Level contact with a
// note describing exactly what they selected. Secrets live in Cloudflare Pages
// → mytikas-spans → Settings → Variables and secrets:
//   GHL_API_TOKEN    Go High Level private integration token (contacts write)
//   GHL_LOCATION_ID  the Mytikas sub-account (location) ID
import { validateQuote, quoteSummary, ghlContact } from '../../src/quote.js';

const GHL = 'https://services.leadconnectorhq.com';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  // Only accept requests made by our own page.
  const from = request.headers.get('Origin');
  if (from && from !== origin) return json({ error: 'forbidden' }, 403);
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return json({ error: 'bad_request' }, 400);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  // Hidden field people never see; bots fill it in. Pretend it worked.
  if (input?.website) return json({ ok: true });

  const checked = validateQuote(input);
  if (!checked.ok) return json({ error: 'invalid', fields: checked.errors }, 400);
  if (!env.GHL_API_TOKEN || !env.GHL_LOCATION_ID) return json({ error: 'not_configured' }, 503);

  const headers = {
    Authorization: `Bearer ${env.GHL_API_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const upsert = await fetch(`${GHL}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify(ghlContact(checked.value, env.GHL_LOCATION_ID)),
  });
  if (!upsert.ok) {
    console.error('GHL upsert failed', upsert.status, (await upsert.text()).slice(0, 500));
    return json({ error: 'crm' }, 502);
  }
  const contactId = (await upsert.json())?.contact?.id;
  if (contactId) {
    const note = await fetch(`${GHL}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: quoteSummary(checked.value, origin) }),
    });
    // The contact exists either way; a missing note is logged, not shown to the visitor.
    if (!note.ok) console.error('GHL note failed', note.status, (await note.text()).slice(0, 500));
  }
  return json({ ok: true });
}
