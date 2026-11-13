import { ftIn, escapeHtml } from './logic.js';
import {
  PROJECT_TYPES,
  SNOW,
  BEAMS,
  OPTION_LABELS,
  MAX_AREAS,
  projectType,
  newArea,
  areaTitle,
  sizeLabel,
  areaStiff,
  planArea,
  planProject,
  areaNotes,
  takeoffRows,
  projectCsv,
  projectToQuery,
  projectFromQuery,
} from './project.js';
import { n0 } from './quote.js';

// Project mode on the page. Only functions and state live here; app.js calls
// initProject() once the page is ready.

let proj = null; // { areas, job, loc }
let projPlans = null; // planProject(proj.areas)

const q$ = (sel, root = document) => root.querySelector(sel);

function segHtml(name, items, value, field, i) {
  return `<div class="segmented">${items
    .map(
      ([v, label, small]) => `<label><input type="radio" name="${name}" value="${v}" data-i="${i}" data-field="${field}"${String(value) === String(v) ? ' checked' : ''}><span>${label}${small ? `<small>${small}</small>` : ''}</span></label>`,
    )
    .join('')}</div>`;
}

function areaFormHtml(a, i) {
  const t = projectType(a.type);
  const types = PROJECT_TYPES.map(
    (x) => `<label class="choice" for="type-${i}-${x.id}">
      <input type="radio" name="type-${i}" id="type-${i}-${x.id}" value="${x.id}" data-i="${i}" data-field="type"${a.type === x.id ? ' checked' : ''}>
      <span class="name">${x.label}</span><span class="psf">${x.id === 'custom' ? '' : x.id === 'deck' ? '40 psf + snow' : `${x.ll} psf live`}</span>
      <span class="detail">${x.detail}</span>
    </label>`,
  ).join('');
  const deck =
    t.id === 'deck'
      ? `<fieldset><legend>Ground snow load</legend>
          ${segHtml(`snow-${i}`, SNOW.map((s) => [s.id, s.label]), a.snow, 'snow', i)}
          <p class="hint">Your building department sets it. Decks are sized for the greater of 40 psf or the snow load.</p></fieldset>
        <fieldset><legend>The deck is</legend>
          ${segHtml(`attach-${i}`, [['house', 'Attached', 'to the house'], ['free', 'Freestanding', 'on its own beams']], a.attach, 'attach', i)}</fieldset>`
      : '';
  const custom =
    t.id === 'custom'
      ? `<fieldset><legend>Your loads</legend><div class="pair">
          <div class="field"><label for="dl-${i}">Dead load</label><div class="box"><input id="dl-${i}" type="number" inputmode="decimal" min="0" step="1" value="${a.dl}" data-i="${i}" data-field="dl"><span class="unit">psf</span></div></div>
          <div class="field"><label for="ll-${i}">Live load</label><div class="box"><input id="ll-${i}" type="number" inputmode="decimal" min="0" step="1" value="${a.ll}" data-i="${i}" data-field="ll"><span class="unit">psf</span></div></div>
        </div><p class="hint">Loads between our tables use the next heavier table.</p></fieldset>`
      : '';
  return `<div class="area-inputs">
    <fieldset><legend>What are you building?</legend><div class="choices">${types}</div></fieldset>
    ${custom}
    <fieldset><legend>Size</legend>
      <div class="pair">
        <div class="field"><label for="len-${i}">Length</label><div class="box"><input id="len-${i}" type="number" inputmode="decimal" min="0" max="1000" step="0.5" placeholder="0" value="${a.len || ''}" data-i="${i}" data-field="len"><span class="unit">ft</span></div></div>
        <div class="field"><label for="wid-${i}">Width</label><div class="box"><input id="wid-${i}" type="number" inputmode="decimal" min="0" max="1000" step="0.5" placeholder="0" value="${a.wid || ''}" data-i="${i}" data-field="wid"><span class="unit">ft</span></div></div>
      </div>
      <p class="hint">Outside dimensions. Joists span the shorter side.</p></fieldset>
    <fieldset><legend>A beam or bearing wall in the middle?</legend>
      ${segHtml(`beam-${i}`, BEAMS.map((b) => [b.id, b.label]), a.beam, 'beam', i)}
      <p class="hint">${BEAMS.find((b) => b.id === a.beam).detail}.</p></fieldset>
    ${deck}
    <fieldset><legend>Floor stiffness</legend>
      ${segHtml(`stiff-${i}`, [['0', 'Standard', 'L/360'], ['1', 'Stiffer, less bounce', 'L/480']], areaStiff(a) ? 1 : 0, 'stiff', i)}</fieldset>
    <fieldset><legend>Area name <span class="optional">optional</span></legend>
      <div class="field"><div class="box"><input type="text" maxlength="40" autocomplete="off" placeholder="${escapeHtml(areaTitle({ ...a, name: '' }, i))}" value="${escapeHtml(a.name)}" data-i="${i}" data-field="name" aria-label="Area name"></div></div></fieldset>
  </div>`;
}

// Plan view: rim track on the long sides, joists across, beam lines dashed.
function planSvg(a, p) {
  const c = p.chosen;
  const W = 560;
  const pad = { l: 50, r: 12, t: a.type === 'deck' && a.attach === 'house' ? 30 : 12, b: 34 };
  const x0 = pad.l;
  const y0 = pad.t;
  // Keep the true proportions; cap the height for near-square areas.
  let w = W - pad.l - pad.r;
  let h = (w * p.widthFt) / p.lengthFt;
  if (h > 300) {
    h = 300;
    w = (h * p.lengthFt) / p.widthFt;
  }
  h = Math.max(h, 60);
  const H = h;
  const lines = c.row ? Math.floor((p.lengthFt * 12) / c.spacing) + 1 : 0;
  const every = Math.max(1, Math.ceil(lines / 90));
  let joists = '';
  for (let k = 0; k < lines; k += every) {
    const x = x0 + (w * (k * c.spacing)) / (p.lengthFt * 12);
    joists += `<line class="j" x1="${x.toFixed(1)}" y1="${y0}" x2="${x.toFixed(1)}" y2="${y0 + h}"/>`;
  }
  let beams = '';
  for (let k = 1; k < p.bays; k++) {
    const y = y0 + (h * k) / p.bays;
    beams += `<line class="b" x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}"/>`;
  }
  const house =
    a.type === 'deck' && a.attach === 'house'
      ? `<text class="lbl" x="${x0}" y="${y0 - 9}">House · ledger</text><line class="house" x1="${x0}" y1="${y0 - 3}" x2="${x0 + w}" y2="${y0 - 3}"/>`
      : '';
  return `<svg class="plan" viewBox="0 0 ${W} ${H + pad.t + pad.b}" role="img" aria-label="Plan: ${lines} joists at ${c.spacing} inches on center${p.bays > 1 ? `, ${p.bays - 1} beam line${p.bays > 2 ? 's' : ''}` : ''}">
    ${house}
    <rect class="out" x="${x0}" y="${y0}" width="${w}" height="${h}"/>
    ${joists}${beams}
    <line class="rim" x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0}"/><line class="rim" x1="${x0}" y1="${y0 + h}" x2="${x0 + w}" y2="${y0 + h}"/>
    <text class="dim" x="${x0 + w / 2}" y="${y0 + h + 20}" text-anchor="middle">${ftIn(Math.round(p.lengthFt * 12))}</text>
    <text class="dim" x="${x0 - 10}" y="${y0 + h / 2}" text-anchor="middle" transform="rotate(-90 ${x0 - 10} ${y0 + h / 2})">${ftIn(Math.round(p.widthFt * 12))}</text>
  </svg>`;
}

function optionsHtml(p, i) {
  return `<div class="options" role="radiogroup" aria-label="Ways to frame it">${p.options
    .map((o) => {
      const on = o === p.chosen;
      return `<button type="button" class="option${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-i="${i}" data-opt="${o.keys[0]}">
        <span class="opt-tag">${o.keys.map((k) => OPTION_LABELS[k]).join(' · ')}</span>
        <span class="opt-member">${o.member}</span>
        <span class="opt-line">${o.spacing}" o.c. · ${o.pieces} pcs</span>
        <span class="opt-line">${n0(o.lb)} lb of joists</span>
      </button>`;
    })
    .join('')}</div>`;
}

function layoutText(p) {
  const c = p.chosen;
  if (p.bays === 1) return `One ${ftIn(c.spanIn)} span`;
  if (p.continuous) return `Two ${ftIn(c.spanIn)} spans, continuous over a mid-span support`;
  return `${p.bays} spans of ${ftIn(c.spanIn)} on ${p.bays - 1} beam lines`;
}

function takeoffHtml(p) {
  const rows = takeoffRows(p);
  return `<div class="table-scroll"><table class="takeoff">
    <thead><tr><th>Item</th><th>Profile</th><th>Qty</th><th>Cut length</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.item}</td><td>${r.profile}</td><td>${n0(r.qty)} ${r.unit === 'pcs' ? 'pcs' : 'lf'}</td><td>${r.length || '—'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2">Joist steel</td><td colspan="2">${n0(p.chosen.lb)} lb</td></tr></tfoot>
  </table></div>`;
}

function areaResultHtml(a, i, p) {
  const title = escapeHtml(areaTitle(a, i));
  const head = `<div class="area-head"><p class="eyebrow">${title}${p.lengthFt > 0 && p.widthFt > 0 ? ` · ${sizeLabel(a)} · ${n0(p.sqft)} sq ft` : ''}</p>${
    proj.areas.length > 1 ? `<button type="button" class="linkish" data-remove="${i}">Remove this area</button>` : ''
  }</div>`;
  if (p.status === 'incomplete') return `${head}<h3 class="area-headline">Enter the length and width.</h3>`;
  if (p.status === 'beyond')
    return `${head}<h3 class="area-headline">We size this one with you.</h3>
      <p class="notice">${a.type === 'heavy' ? 'Heavy storage and equipment loads' : `${p.loads.dl} psf dead + ${p.loads.ll} psf live`} go beyond our published tables. Send the request below and our engineering team will size the framing.</p>`;
  if (p.status === 'nofit')
    return `${head}<h3 class="area-headline">None of our 2" flange joists make this, even with beam lines.</h3>
      <p class="notice">Send the request below and our engineering team will size a deeper or doubled member.</p>`;
  const c = p.chosen;
  const notes = areaNotes(a, p);
  return `${head}
    <h3 class="area-headline">${c.pieces} × <span class="nw">${c.member}</span> at <span class="nw">${c.spacing}" o.c.</span></h3>
    <p class="basis"><span>${layoutText(p)}</span><span>${p.loads.dl} + ${p.loads.ll} psf</span><span>${p.defl}</span></p>
    ${planSvg(a, p)}
    ${optionsHtml(p, i)}
    ${takeoffHtml(p)}
    ${notes.length ? `<ul class="area-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}`;
}

function renderAreas() {
  q$('#areas').innerHTML = proj.areas
    .map((a, i) => `<article class="area" id="area-${i}"><form class="area-form" novalidate>${areaFormHtml(a, i)}</form><section class="area-result" id="area-result-${i}" aria-live="polite"></section></article>`)
    .join('');
  q$('#add-area').hidden = proj.areas.length >= MAX_AREAS;
  renderProjectResults();
}

function renderProjectResults() {
  projPlans = planProject(proj.areas);
  proj.areas.forEach((a, i) => {
    q$(`#area-result-${i}`).innerHTML = areaResultHtml(a, i, projPlans.plans[i]);
  });
  const t = projPlans.totals;
  q$('#project-totals').innerHTML = `<dl class="totals">
      <div><dt>Areas</dt><dd>${t.areas}</dd></div>
      <div><dt>Floor area</dt><dd>${n0(t.sqft)} sq ft</dd></div>
      <div><dt>Joists</dt><dd>${n0(t.pieces)} pcs · ${n0(t.joistLf)} lineal ft</dd></div>
      <div><dt>Joist steel</dt><dd>${n0(t.lb)} lb</dd></div>
    </dl>
    ${t.needsUs ? `<p class="hint">${t.needsUs} area${t.needsUs > 1 ? 's go' : ' goes'} to our engineering team; not in these totals.</p>` : ''}`;
  q$('#jump-text').textContent = t.lb > 0 ? `${n0(t.pieces)} joists · ${n0(t.lb)} lb` : 'Your project';
  renderQuoteSummary();
  if (!q$('#sheet-overlay').hidden) renderSheet();
  saveProjectUrl();
}

function saveProjectUrl() {
  if (PREVIEW || mode !== 'project') return;
  try {
    history.replaceState(null, '', projectToQuery(proj));
  } catch {
    // Some embeds refuse URL changes; the page works without it.
  }
}

function onProjectInput(e) {
  const el = e.target.closest('[data-field]');
  if (!el) return;
  const i = Number(el.dataset.i);
  const a = proj.areas[i];
  const f = el.dataset.field;
  if (f === 'type') {
    a.type = el.value;
    a.stiff = null;
    a.opt = '';
    // Redraw this area's questions: decks and custom loads ask more.
    q$(`#area-${i} .area-form`).innerHTML = areaFormHtml(a, i);
  } else if (f === 'len' || f === 'wid') {
    a[f] = Math.max(0, Math.min(1000, Number(el.value) || 0));
  } else if (f === 'dl' || f === 'll') {
    a[f] = Math.max(0, Math.min(500, Number(el.value) || 0));
  } else if (f === 'stiff') {
    a.stiff = el.value === '1';
  } else if (f === 'name') {
    a.name = el.value.replace(/~/g, ' ').slice(0, 40);
  } else {
    a[f] = el.value;
    if (f === 'beam') q$(`#area-${i} .area-form`).innerHTML = areaFormHtml(a, i);
  }
  if (f === 'beam' || f === 'len' || f === 'wid' || f === 'snow' || f === 'stiff') a.opt = '';
  renderProjectResults();
}

function onProjectClick(e) {
  const opt = e.target.closest('[data-opt]');
  if (opt) {
    proj.areas[Number(opt.dataset.i)].opt = opt.dataset.opt;
    renderProjectResults();
    return;
  }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    proj.areas.splice(Number(rm.dataset.remove), 1);
    renderAreas();
  }
}

function addArea() {
  if (proj.areas.length >= MAX_AREAS) return;
  const last = proj.areas[proj.areas.length - 1];
  // A second floor usually matches the first.
  proj.areas.push(last && last.type === 'house' ? { ...newArea('house', last.len, last.wid) } : newArea('deck', 0, 0));
  renderAreas();
  q$(`#area-${proj.areas.length - 1}`).scrollIntoView({ block: 'start' });
}

function downloadCsv() {
  const csv = projectCsv(proj.areas, projPlans, proj.job);
  const name = `Mytikas joist takeoff${proj.job ? ` - ${proj.job.replace(/[^\w .-]/g, '')}` : ''}.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Project summary sheet -------------------------------------------------

function projectSheetHtml() {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const job = [proj.job, proj.loc].filter(Boolean).map(escapeHtml);
  const link = PREVIEW ? '' : `${location.origin}${location.pathname}${projectToQuery(proj)}`;
  const t = projPlans.totals;
  const blocks = projPlans.plans
    .map((p, i) => {
      const a = proj.areas[i];
      const head = `<h4>${a.name ? `${escapeHtml(a.name)} · ` : ''}${projectType(a.type).label}${p.lengthFt > 0 && p.widthFt > 0 ? ` · ${sizeLabel(a)}` : ''}</h4>`;
      if (p.status !== 'ok') return `<section class="paper-area">${head}<p>${p.status === 'incomplete' ? 'Size not given.' : 'Sized by our engineering team.'}</p></section>`;
      const c = p.chosen;
      return `<section class="paper-area">${head}
        <p class="paper-area-line"><strong>${c.pieces} × ${c.member} at ${c.spacing}" o.c.</strong> · ${layoutText(p)} · ${p.loads.dl} + ${p.loads.ll} psf, ${p.defl}${p.exact ? '' : ` (table ${p.loadCase.dl}/${p.loadCase.ll})`}</p>
        <table class="paper-table"><thead><tr><th>Item</th><th>Profile</th><th>Qty</th><th>Cut length</th></tr></thead>
        <tbody>${takeoffRows(p)
          .map((r) => `<tr><td>${r.item}</td><td>${r.profile}</td><td>${n0(r.qty)} ${r.unit === 'pcs' ? 'pcs' : 'lf'}</td><td>${r.length || '—'}</td></tr>`)
          .join('')}</tbody></table>
        ${areaNotes(a, p).length ? `<ul class="paper-area-notes">${areaNotes(a, p).map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      </section>`;
    })
    .join('');
  return `
    <header class="paper-head">
      <div>
        <p class="eyebrow">Mytikas Steel</p>
        <h2 id="sheet-title">Joist takeoff.</h2>
        ${job.length ? `<p class="paper-job">${job.join(' · ')}</p>` : ''}
      </div>
      <p class="paper-date">${today}</p>
    </header>
    <section class="paper-pick">
      <p class="eyebrow">Project</p>
      <dl class="paper-facts">
        <div><dt>Areas</dt><dd>${t.areas}</dd></div>
        <div><dt>Floor area</dt><dd>${n0(t.sqft)} sq ft</dd></div>
        <div><dt>Joists</dt><dd>${n0(t.pieces)} pcs</dd></div>
        <div><dt>Joist length</dt><dd>${n0(t.joistLf)} lineal ft</dd></div>
        <div><dt>Joist steel</dt><dd>${n0(t.lb)} lb</dd></div>
      </dl>
    </section>
    ${blocks}
    <section class="paper-notes">
      <h4>Conditions</h4>
      <ul>
        <li>Uniform loads only. Concentrated loads, openings and cantilevers need an engineer.</li>
        <li>Top flange braced by sheathing; joists braced and fastened at every support; 3-1/2" bearing.</li>
        <li>Bottom-flange bridging at no more than 8 ft on center. Beams, posts and connections are not included.</li>
        <li>Joists are cut to length, up to 60 ft. Quantities are for pricing; confirm against your plans.</li>
      </ul>
      <p>Spans from the ClarkDietrich Technical Design Guide (CD-STR-TechGuide, eff. 06/01/24), AISI S100-16 (2020) w/S2-20. Mytikas Steel joists are roll-formed from 50 ksi steel and meet or exceed the ClarkDietrich sections. For preliminary sizing and pricing; the engineer of record is responsible for the final design.</p>
    </section>
    <footer class="paper-foot">
      <span>Mytikas Industries · 1173 SH 120, Florence, CO 81226 · (719) 258-9891 · info@mytikasindustries.com</span>
      ${link ? `<span class="paper-link">${escapeHtml(link)}</span>` : ''}
    </footer>`;
}

function projectQuoteSummaryHtml() {
  const bits = projPlans.plans.map((p, i) => {
    const a = proj.areas[i];
    const name = escapeHtml(areaTitle(a, i));
    if (p.status === 'ok') return `<strong>${name}</strong>, ${sizeLabel(a)}: ${p.chosen.pieces} × ${p.chosen.member} at ${p.chosen.spacing}" o.c.`;
    if (p.status === 'incomplete') return `<strong>${name}</strong>: size not given yet`;
    return `<strong>${name}</strong>${p.lengthFt ? `, ${sizeLabel(a)}` : ''}: our engineering team sizes it`;
  });
  const t = projPlans.totals;
  if (t.lb > 0) bits.push(`About ${n0(t.joistLf)} lineal ft and ${n0(t.lb)} lb of joists in all`);
  if (proj.job || proj.loc) bits.push(escapeHtml([proj.job, proj.loc].filter(Boolean).join(', ')));
  return `<p class="eyebrow">We'll include</p><ul>${bits.map((b) => `<li>${b}</li>`).join('')}</ul>`;
}

function initProject() {
  proj = projectFromQuery(location.search);
  q$('#p-job').value = proj.job;
  q$('#p-loc').value = proj.loc;
  const view = q$('#project-view');
  view.addEventListener('input', (e) => {
    if (e.target.id === 'p-job' || e.target.id === 'p-loc') {
      proj[e.target.id === 'p-job' ? 'job' : 'loc'] = e.target.value.replace(/~/g, ' ').trim().slice(0, 80);
      renderQuoteSummary();
      saveProjectUrl();
      return;
    }
    // Number fields update as you type; radios arrive as "change".
    if (e.target.type === 'number' || e.target.type === 'text') onProjectInput(e);
  });
  view.addEventListener('change', (e) => {
    if (e.target.type === 'radio') onProjectInput(e);
  });
  view.addEventListener('click', onProjectClick);
  view.addEventListener('submit', (e) => e.preventDefault());
  q$('#add-area').addEventListener('click', addArea);
  q$('#p-csv').addEventListener('click', downloadCsv);
  q$('#p-sheet').addEventListener('click', openSheet);
  q$('#p-copy').hidden = PREVIEW;
  q$('#p-copy').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}${projectToQuery(proj)}`;
    try {
      await navigator.clipboard.writeText(url);
      q$('#p-status').textContent = 'Link copied.';
    } catch {
      q$('#p-status').textContent = url;
    }
  });
  renderAreas();
}
