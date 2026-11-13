// Cloudflare Pages Function: POST /api/quote
// Turns a quote request from the page into a Go High Level contact with a
// note describing exactly what they selected, plus links to any plans they
// attached. Secrets live in Cloudflare Pages → mytikas-spans → Settings →
// Variables and secrets:
//   GHL_API_TOKEN    Go High Level private integration token
//                    (contacts write; medias write for plans)
//   GHL_LOCATION_ID  the Mytikas sub-account (location) ID
import { validateQuote, quoteSummary, ghlContact, ghlTags, triggerTags, checkFiles, cleanFileName } from '../../src/quote.js';

const GHL = 'https://services.leadconnectorhq.com';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A request is JSON, or multipart with a "payload" JSON part and "files".
async function readRequest(request) {
  const type = request.headers.get('Content-Type') ?? '';
  if (type.startsWith('application/json')) return { input: await request.json(), files: [] };
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => typeof f === 'object' && f !== null && 'size' in f);
    return { input: JSON.parse(String(form.get('payload') ?? '')), files };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  // Only accept requests made by our own page.
  const from = request.headers.get('Origin');
  if (from && from !== origin) return json({ error: 'forbidden' }, 403);

  let read;
  try {
    read = await readRequest(request);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!read) return json({ error: 'bad_request' }, 400);
  const { input, files } = read;
  // Hidden field people never see; bots fill it in. Pretend it worked.
  if (input?.website) return json({ ok: true });

  const checked = validateQuote(input);
  const fileError = checkFiles(files);
  if (!checked.ok || fileError) return json({ error: 'invalid', fields: { ...checked.errors, ...(fileError ? { files: fileError } : {}) } }, 400);
  if (!env.GHL_API_TOKEN || !env.GHL_LOCATION_ID) return json({ error: 'not_configured' }, 503);

  const auth = { Authorization: `Bearer ${env.GHL_API_TOKEN}`, Version: '2021-07-28', Accept: 'application/json' };
  const headers = { ...auth, 'Content-Type': 'application/json' };

  // Plans go to the Go High Level media library; the note links to them.
  const who = checked.value.name.replace(/[^\w .-]/g, '').slice(0, 40);
  const saved = [];
  for (const f of files) {
    const name = cleanFileName(f.name);
    const body = new FormData();
    body.append('file', f, name);
    body.append('name', `${who} - ${name}`);
    try {
      const r = await fetch(`${GHL}/medias/upload-file`, { method: 'POST', headers: auth, body });
      const out = r.ok ? await r.json() : null;
      if (!r.ok) console.error('GHL media upload failed', r.status, (await r.text()).slice(0, 500));
      saved.push({ name, url: out?.url ?? '' });
    } catch (err) {
      console.error('GHL media upload failed', String(err));
      saved.push({ name, url: '' });
    }
  }

  const summary = quoteSummary(checked.value, origin, saved);
  const upsert = await fetch(`${GHL}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify(ghlContact(checked.value, env.GHL_LOCATION_ID, summary)),
  });
  if (!upsert.ok) {
    console.error('GHL upsert failed', upsert.status, (await upsert.text()).slice(0, 500));
    return json({ error: 'crm' }, 502);
  }
  const contactId = (await upsert.json())?.contact?.id;
  if (!contactId) {
    console.error('GHL upsert returned no contact id');
    return json({ ok: true });
  }
  // The contact exists from here on; later failures are logged, not shown to the visitor.
  const call = async (label, path, method, body) => {
    const r = await fetch(`${GHL}${path}`, { method, headers, body: JSON.stringify(body) });
    if (!r.ok) console.error(`GHL ${label} failed`, r.status, (await r.text()).slice(0, 500));
  };
  // Note first, so it is on the contact when the sales alert goes out.
  await call('note', `/contacts/${contactId}/notes`, 'POST', { body: summary });
  await call('remove trigger tags', `/contacts/${contactId}/tags`, 'DELETE', { tags: triggerTags(checked.value, files.length) });
  await call('add tags', `/contacts/${contactId}/tags`, 'POST', { tags: ghlTags(checked.value, files.length) });
  return json({ ok: true, plans: saved.filter((f) => f.url).length });
}
