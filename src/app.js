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
} from './logic.js';

// The preview build (no real address yet) sets this to false.
const SHARE_ENABLED = globalThis.SPAN_FINDER_SHARE !== false;

const $ = (id) => document.getElementById(id);
const form = $('inputs');
const out = $('results');

let state = fromQuery(location.search);

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
  return s;
}

function sizeText(p) {
  return `${p.web}" web · ${p.gauge} ga (${p.mil} mil)`;
}

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

function rowHtml(r, required, max) {
  return `<div class="row${r.passes === false ? ' fails' : ''}">
    <div class="lead-cell"><span class="member">${r.member}</span><span class="size">${sizeText(r)}</span></div>
    <div class="span-cell"><span class="span">${ftIn(r.span)}</span><span class="spare">${spareText(r)}</span></div>
    <div class="weight-cell"><span class="weight">${r.weight.toFixed(2)} lb/ft</span></div>
    <div class="info-cell"><span class="stiff">${stiffenerText(r.stiffener)}</span></div>
    ${meter(r.span, required, max)}
  </div>`;
}

function pickHtml(result, required, max) {
  const p = result.pick;
  const next = result.passing.find((r) => r.spare >= 6 && r !== p);
  const tight =
    p.spare < 6 && next
      ? `<p class="notice">This joist is within 6" of its limit. For room to adjust, the next lightest with more margin is ${next.member} (${ftIn(next.span)} allowable, ${next.weight.toFixed(2)} lb/ft).</p>`
      : '';
  return `<article class="pick">
    <p class="eyebrow">Lightest joist that makes it</p>
    <div class="pick-top">
      <div><h3>${p.member}</h3><p class="size">${sizeText(p)} · 2" flange · 50 ksi</p></div>
      <div><p class="big">${ftIn(p.span)}</p><p class="big-label">allowable span</p></div>
    </div>
    ${meter(p.span, required, max)}
    <dl class="facts">
      <div><dt>Your span</dt><dd>${ftIn(required)}</dd></div>
      <div><dt>Spare length</dt><dd>${p.spare === 0 ? 'None' : ftIn(p.spare)}</dd></div>
      <div><dt>Joist weight</dt><dd>${p.weight.toFixed(2)} lb/ft</dd></div>
      <div><dt>Steel per sq ft of floor</dt><dd>${p.perSqFt.toFixed(2)} lb at ${state.oc}" o.c.</dd></div>
      <div><dt>Web stiffeners</dt><dd>${stiffenerText(p.stiffener).replace('Web stiffeners at', 'At').replace('No web stiffeners needed', 'Not needed')}</dd></div>
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

  const sag = required > 0 ? required / Number(state.defl.slice(2)) : 0;
  $('defl-hint').textContent =
    required > 0
      ? `Live-load sag up to ${sag.toFixed(2)}" at ${ftIn(required)}. L/480 is common under tile and for floors that should feel solid.`
      : 'L/360 is the code minimum for floors. L/480 is common under tile and for floors that should feel solid.';
  $('span-hint').textContent =
    state.span === 'two' ? 'Each span, end support to center support.' : 'Clear span between supports.';

  if (!result.loadCase) {
    const top = LOAD_CASES[LOAD_CASES.length - 1];
    out.innerHTML = `<h2 class="headline">These loads are beyond our published tables.</h2>
      <p class="notice">The tables go up to ${top.dl} psf dead load and ${top.ll} psf live load. For heavier floors, call us at (719) 258-9891 or email info@mytikasindustries.com and our engineering team will size the joists.</p>`;
    return;
  }

  const lc = result.loadCase;
  const max = Math.max(...result.rows.map((r) => r.span), required);
  const basis = `<p class="basis"><span>${lc.dl} psf dead + ${lc.ll} psf live (${lc.total} psf total)</span><span>${state.defl}</span><span>${state.span === 'two' ? 'Two equal spans' : 'One span'}</span><span>${state.oc}" o.c.</span></p>`;
  const rounded = result.exact
    ? ''
    : `<p class="notice">No table matches ${state.dl} psf dead + ${state.ll} psf live exactly, so we use the next heavier one: ${lc.dl} psf dead + ${lc.ll} psf live. Spans are shorter than an exact design would give. ${state.dl > 10 && state.ll < 125 ? 'Floors heavier than 10 psf dead load are published only with 125 psf live load. ' : ''}For an exact design, ask our engineering team.</p>`;

  let body;
  if (required <= 0) {
    const rows = [...result.rows].sort((a, b) => a.weight - b.weight);
    body = `<h2 class="headline">Enter your span to see which joists make it.</h2>
      ${basis}${rounded}
      <div><div class="list-head"><h3>Allowable spans, lightest first.</h3></div>
      <div class="rows">${rows.map((r) => rowHtml(r, 0, max)).join('')}</div></div>`;
  } else if (!result.pick) {
    body = `<h2 class="headline">None of our 2" flange joists make ${ftIn(required)} at these settings.</h2>
      ${basis}${rounded}
      <p class="notice">Try 12" spacing, or two spans with a center support. Our engineering team can also size a deeper or doubled member: (719) 258-9891.</p>
      <div><div class="list-head"><h3>Closest options.</h3></div>
      <div class="rows">${result.failing.map((r) => rowHtml(r, required, max)).join('')}</div></div>`;
  } else {
    const n = result.passing.length;
    body = `<h2 class="headline">${n} of 15 joists make ${ftIn(required)}.</h2>
      ${basis}${rounded}
      ${pickHtml(result, required, max)}
      <div><div class="list-head"><h3>All joists that make it, lightest first.</h3></div>
      <div class="rows">${result.passing.map((r) => rowHtml(r, required, max)).join('')}</div></div>
      ${
        result.failing.length
          ? `<details><summary>${result.failing.length} that fall short</summary><div class="rows">${result.failing.map((r) => rowHtml(r, required, max)).join('')}</div></details>`
          : ''
      }`;
  }

  const share = SHARE_ENABLED
    ? `<div class="actions"><button type="button" class="button" id="copy-link">Copy link to these results</button><span class="status" id="copy-status" role="status"></span></div>`
    : '';
  out.innerHTML = body + fullTableHtml(result, required) + share;
  $('jump-text').textContent = out.querySelector('.headline').textContent;
}

// Hide the phone answer bar once the results themselves are on screen.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => $('jump').classList.toggle('away', entry.isIntersecting)).observe(out);
}

function shareUrl() {
  return `${location.origin}${location.pathname}${toQuery(state)}`;
}

function onChange() {
  const before = state;
  state = readForm();
  if (state.use === 'custom' && before.use !== 'custom') {
    // Start the engineer's inputs from the loads they were just looking at.
    $('dl-custom').value = before.dl;
    $('ll-custom').value = before.ll;
    state = readForm();
  }
  syncVisibility();
  render();
  if (SHARE_ENABLED) {
    try {
      history.replaceState(null, '', toQuery(state));
    } catch {
      // Some embeds refuse URL changes; the page works without it.
    }
  }
}

out.addEventListener('click', async (e) => {
  if (e.target.id !== 'copy-link') return;
  const status = $('copy-status');
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied.';
  } catch {
    status.textContent = url;
  }
});

form.addEventListener('input', onChange);
form.addEventListener('change', onChange);
form.addEventListener('submit', (e) => e.preventDefault());

renderChoices();
syncForm();
render();
