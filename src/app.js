import {
  USES,
  FLOOR_WEIGHTS,
  PROFILES,
  SPACINGS,
  LOAD_CASES,
  evaluate,
  cell,
  ftIn,
  requiredInches,
  stiffenerText,
  fromQuery,
  toQuery,
  selectedRow,
  roughQuantity,
  useLabel,
  escapeHtml,
} from './logic.js';
import { ROLES } from './quote.js';

// The private preview build sets this: it has no real address, so share
// links, printing and quote requests are shown but not live.
const PREVIEW = globalThis.SPAN_FINDER_PREVIEW === true;

const $ = (id) => document.getElementById(id);
const form = $('inputs');
const out = $('results');

let state = fromQuery(location.search);
let current = null; // { result, required, row } from the last render

const fmt = (n) => n.toLocaleString('en-US');

function choiceHtml(name, value, title, detail, psf, checked) {
  const id = `${name}-${value}`;
  return `<label class="choice" for="${id}">
    <input type="radio" name="${name}" id="${id}" value="${value}"${checked ? ' checked' : ''}>
    <span class="name">${title}</span><span class="psf">${psf}</span>
    <span class="detail">${detail}</span>
  </label>`;
}

function renderChoices() {
  $('uses').innerHTML =
    USES.map((u) => choiceHtml('use', u.id, u.label, u.detail, `${u.ll} psf live`, state.use === u.id)).join('') +
    choiceHtml('use', 'custom', 'Enter loads myself', 'For engineers with a load schedule', '', state.use === 'custom');
  $('weights').innerHTML = FLOOR_WEIGHTS.map((w) =>
    choiceHtml('dl', w.dl, w.label, w.detail, `${w.dl} psf dead`, state.dl === w.dl),
  ).join('');
  $('q-role').innerHTML = ROLES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
}

function syncVisibility() {
  const custom = state.use === 'custom';
  $('custom-loads').hidden = !custom;
  $('floor-weight').hidden = custom;
}

// Writes the whole state into the form; used once at load.
function syncForm() {
  syncVisibility();
  const dl = FLOOR_WEIGHTS.some((w) => w.dl === state.dl) ? state.dl : 10;
  for (const r of form.querySelectorAll('input[name="dl"]')) r.checked = Number(r.value) === dl;
  $('dl-custom').value = state.dl;
  $('ll-custom').value = state.ll;
  $('ft').value = state.ft || '';
  $('in').value = state.in || '';
  $(`oc-${state.oc}`).checked = true;
  $(`span-${state.span}`).checked = true;
  $(`defl-${state.defl.slice(2)}`).checked = true;
  $('job').value = state.job;
  $('loc').value = state.loc;
  $('area').value = state.area || '';
}

function readForm() {
  const use = form.querySelector('input[name="use"]:checked')?.value ?? 'living';
  const s = { ...state, use };
  if (use === 'custom') {
    s.dl = Math.max(0, Number($('dl-custom').value) || 0);
    s.ll = Math.max(0, Number($('ll-custom').value) || 0);
  } else {
    s.ll = USES.find((u) => u.id === use).ll;
    s.dl = Number(form.querySelector('input[name="dl"]:checked')?.value ?? 10);
  }
  s.ft = Math.max(0, Number($('ft').value) || 0);
  s.in = Math.max(0, Number($('in').value) || 0);
  s.oc = Number(form.querySelector('input[name="oc"]:checked').value);
  s.span = form.querySelector('input[name="span"]:checked').value;
  s.defl = form.querySelector('input[name="defl"]:checked').value;
  s.job = $('job').value.trim().slice(0, 80);
  s.loc = $('loc').value.trim().slice(0, 80);
  s.area = Math.max(0, Math.round(Number($('area').value) || 0));
  return s;
}

const sizeText = (p) => `${p.web}" web · ${p.gauge} ga (${p.mil} mil)`;
const shortStiff = (code) =>
  stiffenerText(code).replace('Web stiffeners at', 'At').replace('No web stiffeners needed', 'Not needed');
const STIFF_SHORT = { '': 'None', e: 'Ends', i: 'Center', a: 'All' };
const supportsText = () => (state.span === 'two' ? 'Two equal spans' : 'One span');

function meter(span, required, max) {
  const fill = Math.min(100, (span / max) * 100);
  const need = required > 0 ? `<span class="need" style="left:calc(${Math.min(100, (required / max) * 100)}% - 1px)"></span>` : '';
  return `<div class="meter" aria-hidden="true"><span class="fill" style="width:${fill}%"></span>${need}</div>`;
}

function spareText(r) {
  if (r.spare === null) return '';
  if (r.spare === 0) return 'Exactly at its limit';
  return r.spare > 0 ? `${ftIn(r.spare)} to spare` : `${ftIn(-r.spare)} short`;
}

function rowHtml(r, required, max, chosen) {
  const choose =
    r.passes === true
      ? `<button type="button" class="choose" data-member="${r.member}" aria-pressed="${chosen}">${chosen ? 'Chosen' : 'Choose'}</button>`
      : '';
  return `<div class="row${r.passes === false ? ' fails' : ''}${chosen ? ' chosen' : ''}">
    <div class="lead-cell"><span class="member">${r.member}</span><span class="size">${sizeText(r)}</span></div>
    <div class="span-cell"><span class="span">${ftIn(r.span)}</span><span class="spare">${spareText(r)}</span></div>
    <div class="weight-cell"><span class="weight">${r.weight.toFixed(2)} lb/ft</span></div>
    <div class="info-cell"><span class="stiff">${stiffenerText(r.stiffener)}</span>${choose}</div>
    ${meter(r.span, required, max)}
  </div>`;
}

function quantityText(row) {
  const q = roughQuantity(row, state.area, state.oc);
  return q ? `About ${fmt(q.linealFt)} lineal ft · ${fmt(q.lb)} lb` : '';
}

function pickHtml(result, row, required, max) {
  const lightest = row === result.pick;
  const next = result.passing.find((r) => r.spare >= 6 && r.weight > row.weight);
  const tight =
    row.spare < 6 && next
      ? `<p class="notice">This joist is within 6" of its limit. For room to adjust, the next lightest with more margin is ${next.member} (${ftIn(next.span)} allowable, ${next.weight.toFixed(2)} lb/ft).</p>`
      : '';
  const qty = quantityText(row);
  return `<article class="pick">
    <div class="pick-eyebrow">
      <p class="eyebrow">${lightest ? 'Lightest joist that makes it' : 'Your chosen joist'}</p>
      ${lightest ? '' : `<button type="button" class="linkish" data-member="${result.pick.member}">Back to the lightest, ${result.pick.member}</button>`}
    </div>
    <div class="pick-top">
      <div><h3>${row.member}</h3><p class="size">${sizeText(row)} · 2" flange · 50 ksi</p></div>
      <div><p class="big">${ftIn(row.span)}</p><p class="big-label">allowable span</p></div>
    </div>
    ${meter(row.span, required, max)}
    <dl class="facts">
      <div><dt>Your span</dt><dd>${ftIn(required)}</dd></div>
      <div><dt>Spare length</dt><dd>${row.spare === 0 ? 'None' : ftIn(row.spare)}</dd></div>
      <div><dt>Joist weight</dt><dd>${row.weight.toFixed(2)} lb/ft</dd></div>
      <div><dt>Steel per sq ft of floor</dt><dd>${row.perSqFt.toFixed(2)} lb at ${state.oc}" o.c.</dd></div>
      <div><dt>Web stiffeners</dt><dd>${shortStiff(row.stiffener)}</dd></div>
      ${qty ? `<div><dt>Rough quantity, ${fmt(state.area)} sq ft</dt><dd>${qty}</dd></div>` : ''}
    </dl>
    ${tight}
  </article>`;
}

function fullTableHtml(result, required) {
  const lc = result.loadCase;
  const head = SPACINGS.map((s) => `<th>${s}"</th>`).join('');
  const body = PROFILES.map((p) => {
    const cells = ['single', 'two']
      .flatMap((k) =>
        SPACINGS.map((s) => {
          const v = cell(lc, p.member, state.defl, k, s);
          const on = k === state.span && s === state.oc;
          const short = required > 0 && v.span < required;
          const cls = [on ? 'on' : '', short ? 'short' : ''].join(' ').trim();
          return `<td${cls ? ` class="${cls}"` : ''}>${ftIn(v.span)}${v.stiffener ? `<sup>${v.stiffener}</sup>` : ''}</td>`;
        }),
      )
      .join('');
    return `<tr><td>${p.member}</td>${cells}</tr>`;
  }).join('');
  return `<details>
    <summary>Full table: ${lc.dl} psf dead + ${lc.ll} psf live, ${state.defl}</summary>
    <div class="table-scroll"><table>
      <thead>
        <tr><th></th><th colspan="3">One span, spacing o.c.</th><th colspan="3">Two equal spans, spacing o.c.</th></tr>
        <tr><th>Member</th>${head}${head}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="hint">Shaded column is your selection. Web stiffeners: e = end supports, i = center support, a = all supports. ClarkDietrich guide pp. ${lc.pages}.</p>
  </details>`;
}

function basisHtml(lc) {
  return `<p class="basis"><span>${lc.dl} psf dead + ${lc.ll} psf live (${lc.total} psf total)</span><span>${state.defl}</span><span>${supportsText()}</span><span>${state.oc}" o.c.</span></p>`;
}

function roundedHtml(result) {
  const lc = result.loadCase;
  if (result.exact) return '';
  return `<p class="notice">No table matches ${state.dl} psf dead + ${state.ll} psf live exactly, so we use the next heavier one: ${lc.dl} psf dead + ${lc.ll} psf live. Spans are shorter than an exact design would give. ${
    state.dl > 10 && state.ll < 125 ? 'Floors heavier than 10 psf dead load are published only with 125 psf live load. ' : ''
  }For an exact design, ask our engineering team.</p>`;
}

function actionsHtml(row) {
  const parts = [];
  if (row) parts.push('<button type="button" class="button" id="open-sheet">Spec sheet</button>');
  parts.push(`<a class="button quiet" href="#quote">Request a quote</a>`);
  if (!PREVIEW) parts.push('<button type="button" class="button quiet" id="copy-link">Copy link</button>');
  return `<div class="actions">${parts.join('')}<span class="status" id="copy-status" role="status"></span></div>`;
}

function render() {
  const required = requiredInches(state.ft, state.in);
  const result = evaluate({
    dl: state.dl,
    ll: state.ll,
    deflection: state.defl,
    condition: state.span,
    spacing: state.oc,
    required,
  });
  const row = required > 0 && result.loadCase ? selectedRow(result, state.sel) : null;
  if (row && state.sel && row.member !== state.sel) state.sel = '';
  current = { result, required, row };

  const sag = required > 0 ? required / Number(state.defl.slice(2)) : 0;
  $('defl-hint').textContent =
    required > 0
      ? `Live-load sag up to ${sag.toFixed(2)}" at ${ftIn(required)}. L/480 is common under tile and for floors that should feel solid.`
      : 'L/360 is the code minimum for floors. L/480 is common under tile and for floors that should feel solid.';
  $('span-hint').textContent =
    state.span === 'two' ? 'Each span, end support to center support.' : 'Clear span between supports.';

  let body;
  if (!result.loadCase) {
    const top = LOAD_CASES[LOAD_CASES.length - 1];
    body = `<h2 class="headline">These loads are beyond our published tables.</h2>
      <p class="notice">The tables go up to ${top.dl} psf dead load and ${top.ll} psf live load. For heavier floors, request a quote below or call (719) 258-9891 and our engineering team will size the joists.</p>
      ${actionsHtml(null)}`;
  } else {
    const lc = result.loadCase;
    const max = Math.max(...result.rows.map((r) => r.span), required);
    if (required <= 0) {
      const rows = [...result.rows].sort((a, b) => a.weight - b.weight);
      body = `<h2 class="headline">Enter your span to see which joists make it.</h2>
        ${basisHtml(lc)}${roundedHtml(result)}
        <div><div class="list-head"><h3>Allowable spans, lightest first.</h3></div>
        <div class="rows">${rows.map((r) => rowHtml(r, 0, max, false)).join('')}</div></div>`;
    } else if (!row) {
      body = `<h2 class="headline">None of our 2" flange joists make ${ftIn(required)} at these settings.</h2>
        ${basisHtml(lc)}${roundedHtml(result)}
        <p class="notice">Try 12" spacing, or two spans with a center support. Our engineering team can also size a deeper or doubled member: request a quote below or call (719) 258-9891.</p>
        <div><div class="list-head"><h3>Closest options.</h3></div>
        <div class="rows">${result.failing.map((r) => rowHtml(r, required, max, false)).join('')}</div></div>`;
    } else {
      body = `<h2 class="headline">${result.passing.length} of 15 joists make ${ftIn(required)}.</h2>
        ${basisHtml(lc)}${roundedHtml(result)}
        ${pickHtml(result, row, required, max)}
        ${actionsHtml(row)}
        <div><div class="list-head"><h3>All joists that make it, lightest first.</h3><p class="hint">Choose one to put it on the spec sheet and quote.</p></div>
        <div class="rows">${result.passing.map((r) => rowHtml(r, required, max, r === row)).join('')}</div></div>
        ${
          result.failing.length
            ? `<details><summary>${result.failing.length} that fall short</summary><div class="rows">${result.failing.map((r) => rowHtml(r, required, max, false)).join('')}</div></details>`
            : ''
        }`;
    }
    body += fullTableHtml(result, required);
    if (required <= 0 || !row) body += actionsHtml(null);
  }

  out.innerHTML = body;
  $('jump-text').textContent = out.querySelector('.headline').textContent;
  renderQuoteSummary();
  if (!$('sheet-overlay').hidden) renderSheet();
  if (!PREVIEW) {
    try {
      history.replaceState(null, '', toQuery(state));
    } catch {
      // Some embeds refuse URL changes; the page works without it.
    }
  }
}

// ---- Spec sheet -----------------------------------------------------------

function sheetHtml() {
  const { result, required, row } = current;
  const lc = result.loadCase;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const qty = roughQuantity(row, state.area, state.oc);
  const others = result.passing.filter((r) => r !== row);
  const job = [state.job, state.loc].filter(Boolean).map(escapeHtml);
  const link = PREVIEW ? '' : `${location.origin}${location.pathname}${toQuery(state)}`;
  const basis = [
    ['Floor use', useLabel(state)],
    ['Loads', `${state.dl} psf dead + ${state.ll} psf live`],
    ['Table used', `${lc.dl} psf dead + ${lc.ll} psf live (${lc.total} psf total)${result.exact ? '' : ', next heavier published table'}`],
    ['Span', `${ftIn(required)}${state.span === 'two' ? ' each, two equal spans continuous over a center support' : ', one span'}`],
    ['Spacing', `${state.oc}" on center`],
    ['Deflection', `Live load ${state.defl}, total load L/240`],
    ['Bearing', '3-1/2" at every support'],
  ];
  const chosen = [
    ['Allowable span', ftIn(row.span)],
    ['Spare length', row.spare === 0 ? 'None' : ftIn(row.spare)],
    ['Weight', `${row.weight.toFixed(2)} lb/ft · ${row.perSqFt.toFixed(2)} lb per sq ft of floor`],
    ['Web stiffeners', shortStiff(row.stiffener)],
    ...(qty ? [[`Rough quantity, ${fmt(state.area)} sq ft`, `${fmt(qty.linealFt)} lineal ft · ${fmt(qty.lb)} lb (joists only)`]] : []),
  ];
  const dl = (pairs) => pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  return `
    <header class="paper-head">
      <div>
        <p class="eyebrow">Mytikas Steel</p>
        <h2 id="sheet-title">Floor joist spec sheet.</h2>
        ${job.length ? `<p class="paper-job">${job.join(' · ')}</p>` : ''}
      </div>
      <p class="paper-date">${today}</p>
    </header>
    <section class="paper-pick">
      <p class="eyebrow">Specified joist</p>
      <div class="paper-pick-top">
        <div><h3>${row.member}</h3><p>${sizeText(row)} · 2" flange · 5/8" lip · 50 ksi</p></div>
        <p class="paper-big">${ftIn(row.span)}<span>allowable</span></p>
      </div>
      <dl class="paper-facts">${dl(chosen)}</dl>
    </section>
    <section>
      <h4>Design basis</h4>
      <dl class="paper-list">${dl(basis)}</dl>
      ${result.exact ? '' : '<p class="paper-note">No published table matches these loads exactly, so the next heavier table is used. Spans are conservative.</p>'}
    </section>
    ${
      others.length
        ? `<section><h4>Other joists that make this span, lightest first</h4>
          <div class="paper-tables">${[others.slice(0, Math.ceil(others.length / 2)), others.slice(Math.ceil(others.length / 2))]
            .filter((half) => half.length)
            .map(
              (half) => `<div class="table-scroll"><table class="paper-table"><thead><tr><th>Member</th><th>Allowable</th><th>Spare</th><th>lb/ft</th><th>Stiffeners</th></tr></thead>
              <tbody>${half
                .map(
                  (r) =>
                    `<tr><td>${r.member}</td><td>${ftIn(r.span)}</td><td>${r.spare === 0 ? 'None' : ftIn(r.spare)}</td><td>${r.weight.toFixed(2)}</td><td>${STIFF_SHORT[r.stiffener]}</td></tr>`,
                )
                .join('')}</tbody></table></div>`,
            )
            .join('')}</div>
          <p class="paper-note">Web stiffeners: Ends = at end supports, Center = at the center support, All = at all supports.</p></section>`
        : ''
    }
    <section class="paper-notes">
      <h4>Conditions</h4>
      <ul>
        <li>Uniform floor loads only. Concentrated loads, openings and cantilevers need an engineer.</li>
        <li>Top flange continuously braced by sheathing; joists braced against rotation and fastened at every support.</li>
        <li>Bottom-flange bridging at no more than 8 ft on center where sheathing is on the top flange only.</li>
        <li>Web punchouts near a support may need reinforcement.</li>
      </ul>
      <p>Spans from the ClarkDietrich Technical Design Guide (CD-STR-TechGuide, eff. 06/01/24), pp. ${lc.pages}, AISI S100-16 (2020) w/S2-20. Mytikas Steel joists are roll-formed from 50 ksi steel and meet or exceed the ClarkDietrich sections. For preliminary sizing and pricing; the engineer of record is responsible for the final design.</p>
    </section>
    <footer class="paper-foot">
      <span>Mytikas Industries · 1173 SH 120, Florence, CO 81226 · (719) 258-9891 · info@mytikasindustries.com</span>
      ${link ? `<span class="paper-link">${escapeHtml(link)}</span>` : ''}
    </footer>`;
}

function renderSheet() {
  if (!current?.row) {
    closeSheet();
    return;
  }
  $('paper').innerHTML = sheetHtml();
}

let lastFocus = null;
function openSheet() {
  lastFocus = document.activeElement;
  renderSheet();
  $('sheet-overlay').hidden = false;
  document.documentElement.classList.add('sheet-open');
  $('print-status').textContent = PREVIEW ? 'Printing works on the live address.' : '';
  $('print-sheet').hidden = PREVIEW;
  $('close-sheet').focus();
}
function closeSheet() {
  $('sheet-overlay').hidden = true;
  document.documentElement.classList.remove('sheet-open');
  lastFocus?.focus?.();
}

$('print-sheet').addEventListener('click', () => window.print());
$('close-sheet').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sheet-overlay').hidden) closeSheet();
});

// ---- Quote request ----------------------------------------------------------

function renderQuoteSummary() {
  const { result, required, row } = current;
  const bits = [];
  if (row) bits.push(`<strong>${row.member}</strong> at ${ftIn(required)}, ${supportsText().toLowerCase()}, ${state.oc}" o.c.`);
  else if (required > 0) bits.push(`A ${ftIn(required)} span our 2" flange joists don't make. We'll size an alternative.`);
  if (result.loadCase) bits.push(`${state.dl} psf dead + ${state.ll} psf live, ${state.defl}`);
  else bits.push(`${state.dl} psf dead + ${state.ll} psf live`);
  if (state.job || state.loc) bits.push(escapeHtml([state.job, state.loc].filter(Boolean).join(', ')));
  if (row && state.area > 0) bits.push(`${fmt(state.area)} sq ft · ${quantityText(row).replace('About ', 'about ')}`);
  $('quote-summary').innerHTML = `<p class="eyebrow">We'll include</p><ul>${bits.map((b) => `<li>${b}</li>`).join('')}</ul>`;
}

function showFieldErrors(fields = {}) {
  for (const k of ['name', 'email', 'phone']) $(`q-${k}-error`).textContent = fields[k] ?? '';
}

$('quote-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('q-status');
  const data = Object.fromEntries(new FormData(e.target));
  const fields = {};
  if (!data.name.trim()) fields.name = 'Enter your name.';
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(data.email.trim())) fields.email = 'Enter an email address we can reply to.';
  showFieldErrors(fields);
  if (Object.keys(fields).length) {
    status.textContent = '';
    $(fields.name ? 'q-name' : 'q-email').focus();
    return;
  }
  if (PREVIEW) {
    status.textContent = 'Preview only. Quote requests go to our sales team on the live address.';
    return;
  }
  const button = $('q-send');
  button.disabled = true;
  status.textContent = 'Sending…';
  try {
    const res = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, query: toQuery(state) }),
    });
    const reply = await res.json().catch(() => ({}));
    if (res.ok) {
      status.textContent = `Sent. Thank you, ${data.name.trim().split(/\s+/)[0]}. Our team will be in touch.`;
      e.target.reset();
      $('q-role').value = 'gc';
    } else if (reply.error === 'invalid') {
      showFieldErrors(reply.fields);
      status.textContent = 'Check the highlighted fields.';
    } else {
      status.textContent = "We couldn't send this right now. Email info@mytikasindustries.com or call (719) 258-9891.";
    }
  } catch {
    status.textContent = "We couldn't send this right now. Email info@mytikasindustries.com or call (719) 258-9891.";
  } finally {
    button.disabled = false;
  }
});

// ---- Wiring -------------------------------------------------------------------

function onChange() {
  const before = state;
  const next = readForm();
  // Leaving a field fires "change" with nothing new; redrawing then would
  // swallow a click on a button in the results.
  if (next.use === before.use && toQuery(next) === toQuery(before)) return;
  state = next;
  if (state.use === 'custom' && before.use !== 'custom') {
    // Start the engineer's inputs from the loads they were just looking at.
    $('dl-custom').value = before.dl;
    $('ll-custom').value = before.ll;
    state = readForm();
  }
  syncVisibility();
  render();
}

out.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-member]');
  if (pick) {
    state.sel = pick.dataset.member === current.result.pick?.member ? '' : pick.dataset.member;
    render();
    return;
  }
  if (e.target.id === 'open-sheet') openSheet();
  if (e.target.id === 'copy-link') {
    const status = $('copy-status');
    const url = `${location.origin}${location.pathname}${toQuery(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = url;
    }
  }
});

form.addEventListener('input', onChange);
form.addEventListener('change', onChange);
form.addEventListener('submit', (e) => e.preventDefault());

// Hide the phone answer bar once the results themselves are on screen.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => $('jump').classList.toggle('away', entry.isIntersecting)).observe(out);
}

renderChoices();
$('q-role').value = 'gc';
syncForm();
render();
