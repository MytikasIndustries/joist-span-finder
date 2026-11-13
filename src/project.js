import { evaluate, governingCase, ftIn } from './logic.js';

// Project mode: a GC describes each area (a deck, a floor, a ceiling) by its
// size and supports; we lay out the joists, offer three ways to frame it and
// count what goes on the truck. Joists span the short direction.

export const MAX_LENGTH_FT = 60; // longest joist we roll and ship
export const MAX_AREAS = 8;

export const PROJECT_TYPES = [
  { id: 'deck', label: 'Deck', detail: 'Attached to a house or freestanding', dl: 10, ll: 40, spacings: [12, 16], stiff: false, noun: 'deck joists' },
  { id: 'house', label: 'House floor', detail: 'First or second floor of a home or cabin', dl: 10, ll: 40, spacings: [12, 16, 24], stiff: true, noun: 'house floor joists' },
  { id: 'ceiling', label: 'Ceiling or attic', detail: 'Attic with limited storage', dl: 10, ll: 20, spacings: [16, 24], stiff: false, noun: 'ceiling joists' },
  { id: 'office', label: 'Office floor', detail: 'Multi-story, with partitions and corridors', dl: 10, ll: 100, spacings: [12, 16, 24], stiff: false, noun: 'office floor joists' },
  { id: 'industrial', label: 'Light industrial or mezzanine', detail: 'Light storage and light manufacturing', dl: 10, ll: 125, spacings: [12, 16, 24], stiff: false, noun: 'mezzanine floor joists' },
  { id: 'heavy', label: 'Heavy storage or equipment', detail: 'We size these with you', dl: 10, ll: 250, spacings: [12, 16, 24], stiff: false, noun: 'heavy-duty floor framing' },
  { id: 'custom', label: 'Enter my own loads', detail: 'For engineers with a load schedule', dl: 10, ll: 40, spacings: [12, 16, 24], stiff: false, noun: 'floor joists' },
];

// Ground snow load for decks. The 2021 IRC deck tables add 50, 60 and 70 psf
// snow cases; a deck is sized for the greater of 40 psf live or the snow load.
export const SNOW = [
  { id: '40', label: '40 psf or less', ll: 40 },
  { id: '50', label: '50 psf', ll: 50 },
  { id: '70', label: '60 to 70 psf', ll: 70 },
  { id: 'unsure', label: 'Not sure', ll: 70 },
];

export const BEAMS = [
  { id: 'auto', label: 'Not sure', detail: 'We suggest one if it helps' },
  { id: 'one', label: 'Yes', detail: 'A beam or bearing wall at mid-span' },
  { id: 'none', label: 'No', detail: 'Clear span, wall to wall' },
];

export const OPTION_LABELS = {
  lightest: 'Lightest steel',
  shallowest: 'Shallowest joist',
  fewest: 'Fewest pieces',
};

export const projectType = (id) => PROJECT_TYPES.find((t) => t.id === id) ?? PROJECT_TYPES[1];

export function newArea(type = 'house', len = 0, wid = 0) {
  return { type, name: '', len, wid, beam: 'auto', snow: 'unsure', attach: 'house', stiff: null, dl: 10, ll: 40, opt: '' };
}

export function areaTitle(a, i) {
  return a.name || `${projectType(a.type).label}${i === undefined ? '' : ` ${i + 1}`}`;
}

const dimText = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)}`;
export const sizeLabel = (a) => `${dimText(Math.max(a.len, a.wid))} × ${dimText(Math.min(a.len, a.wid))} ft`;

export function areaLoads(a) {
  const t = projectType(a.type);
  if (t.id === 'custom') return { dl: a.dl, ll: a.ll };
  if (t.id === 'deck') return { dl: t.dl, ll: (SNOW.find((s) => s.id === a.snow) ?? SNOW[3]).ll };
  return { dl: t.dl, ll: t.ll };
}

export const areaStiff = (a) => (a.stiff === null || a.stiff === undefined ? projectType(a.type).stiff : a.stiff);

// Counts for one way of framing an area.
function takeoff({ row, spacing, lengthFt, widthFt, bays, continuous, stiffener }) {
  const lines = Math.floor((lengthFt * 12) / spacing) + 1;
  const onePiece = bays === 1 || continuous;
  const pieces = onePiece ? lines : lines * bays;
  const cutFt = onePiece ? widthFt : widthFt / bays;
  const joistLf = pieces * cutFt;
  const bayFt = widthFt / bays;
  const bridgingRows = Math.max(0, Math.ceil(bayFt / 8) - 1);
  // Web stiffeners: e = both ends, i = center support, a = all supports.
  const perPiece = continuous ? { e: 2, i: 1, a: 3 }[stiffener] ?? 0 : { e: 2, a: 2 }[stiffener] ?? 0;
  return {
    lines,
    pieces,
    cutFt,
    joistLf,
    lb: joistLf * row.weight,
    rimLf: 2 * lengthFt,
    bridgingRows,
    bridgingLf: bridgingRows * bays * lengthFt,
    stiffeners: perPiece * pieces,
  };
}

// Every joist and spacing that makes the span with this many bays.
function framings({ loads, defl, spacings, lengthFt, widthFt, bays }) {
  if (bays === 1 && widthFt > MAX_LENGTH_FT) return [];
  const continuous = bays === 2 && widthFt <= MAX_LENGTH_FT;
  const condition = continuous ? 'two' : 'single';
  const spanIn = (widthFt * 12) / bays;
  const out = [];
  for (const spacing of spacings) {
    const r = evaluate({ dl: loads.dl, ll: loads.ll, deflection: defl, condition, spacing, required: spanIn });
    for (const row of r.passing) {
      out.push({
        member: row.member,
        row,
        spacing,
        condition,
        spanIn,
        allowIn: row.span,
        stiffener: row.stiffener,
        ...takeoff({ row, spacing, lengthFt, widthFt, bays, continuous, stiffener: row.stiffener }),
      });
    }
  }
  return out;
}

function pickOptions(cands) {
  if (!cands.length) return [];
  const byLb = (a, b) => a.lb - b.lb || a.row.web - b.row.web || b.spacing - a.spacing;
  const lightest = [...cands].sort(byLb)[0];
  const shallowest = [...cands].sort((a, b) => a.row.web - b.row.web || a.lb - b.lb)[0];
  const widest = Math.max(...cands.map((c) => c.spacing));
  const fewest = cands.filter((c) => c.spacing === widest).sort(byLb)[0];
  const options = [];
  for (const [key, c] of [['lightest', lightest], ['shallowest', shallowest], ['fewest', fewest]]) {
    const same = options.find((o) => o.member === c.member && o.spacing === c.spacing);
    if (same) same.keys.push(key);
    else options.push({ ...c, keys: [key] });
  }
  return options;
}

/**
 * Lays out one area. Returns null-ish fields when the size is missing.
 */
export function planArea(a) {
  const t = projectType(a.type);
  const lengthFt = Math.max(a.len, a.wid);
  const widthFt = Math.min(a.len, a.wid);
  const base = { type: t, lengthFt, widthFt, sqft: lengthFt * widthFt, loads: areaLoads(a), defl: areaStiff(a) ? 'L/480' : 'L/360' };
  if (!(lengthFt > 0 && widthFt > 0)) return { ...base, status: 'incomplete' };
  const loadCase = governingCase(base.loads.dl, base.loads.ll);
  if (!loadCase || t.id === 'heavy') return { ...base, status: 'beyond' };
  const exact = loadCase.dl === base.loads.dl && loadCase.ll === base.loads.ll;
  const tryBays = (bays) => {
    const options = pickOptions(framings({ ...base, spacings: t.spacings, bays }));
    return options.length ? { bays, continuous: bays === 2 && widthFt <= MAX_LENGTH_FT, options } : null;
  };
  const wanted = { none: [1], one: [2], auto: [1, 2, 3, 4] }[a.beam] ?? [1, 2, 3, 4];
  let layout = null;
  for (const n of wanted) if ((layout = tryBays(n))) break;
  let forced = false;
  if (!layout && a.beam !== 'auto') {
    for (const n of [1, 2, 3, 4]) if ((layout = tryBays(n))) break;
    forced = Boolean(layout);
  }
  if (!layout) return { ...base, status: 'nofit', loadCase, exact };
  const lightestLb = (l) => l.options.find((o) => o.keys.includes('lightest')).lb;
  // When we choose the supports: add a beam line if it cuts the joist steel
  // by 40% or more; otherwise just say what one would save.
  let saving = null;
  let added = null;
  if ((a.beam === 'auto' || forced) && layout.bays < 4) {
    const more = tryBays(layout.bays + 1);
    if (more) {
      const pct = Math.round((1 - lightestLb(more) / lightestLb(layout)) * 100);
      if (a.beam === 'auto' && pct >= 40) {
        added = { pct, fewerBays: layout.bays, member: layout.options[0].member };
        layout = more;
      } else if (pct >= 15) {
        saving = { bays: more.bays, member: more.options[0].member, pct };
      }
    }
  }
  const chosen = layout.options.find((o) => o.keys.includes(a.opt)) ?? layout.options[0];
  return { ...base, status: 'ok', loadCase, exact, forced, saving, added, ...layout, chosen };
}

export function planProject(areas) {
  const plans = areas.map(planArea);
  const ok = plans.filter((p) => p.status === 'ok');
  const sum = (f) => ok.reduce((n, p) => n + f(p.chosen), 0);
  return {
    plans,
    totals: {
      areas: areas.length,
      sqft: plans.reduce((n, p) => n + (p.sqft || 0), 0),
      joistLf: sum((c) => c.joistLf),
      lb: sum((c) => c.lb),
      pieces: sum((c) => c.pieces),
      rimLf: sum((c) => c.rimLf),
      bridgingLf: sum((c) => c.bridgingLf),
      stiffeners: sum((c) => c.stiffeners),
      needsUs: plans.filter((p) => p.status === 'beyond' || p.status === 'nofit').length,
    },
  };
}

// Plain-English notes for one area.
export function areaNotes(a, p) {
  const notes = [];
  if (p.status !== 'ok') return notes;
  if (p.forced) notes.push(`No joist makes ${dimText(p.widthFt)} ft with the supports you chose, so this layout adds beam lines.`);
  if (p.added) notes.push(`We added ${p.bays === 2 ? 'the mid-span support' : 'a beam line'} because it cuts the joist steel by about ${p.added.pct}%. If you need a clear span, answer No to the middle support.`);
  if (p.bays > 1) {
    const lines = p.bays - 1;
    notes.push(`Needs ${lines === 1 ? 'a beam or bearing wall at mid-span' : `${lines} beam lines or bearing walls, evenly spaced`}. Beams and posts are not in this takeoff.`);
  }
  if (p.saving) notes.push(`With ${p.saving.bays === 2 ? 'a beam at mid-span' : `${p.saving.bays - 1} beam lines`}, ${p.saving.member} would do it with about ${p.saving.pct}% less joist steel (beam not included).`);
  if (!p.exact) notes.push(`No table matches ${p.loads.dl} psf dead + ${p.loads.ll} psf live exactly, so we use the next heavier one (${p.loadCase.dl} + ${p.loadCase.ll}). Spans are on the safe side.`);
  if (a.type === 'deck') {
    notes.push(
      a.snow === 'unsure'
        ? 'Snow load not known, so we sized for 70 psf. Your building department sets it; above 70 psf, enter your own loads.'
        : 'Sized for the greater of 40 psf live load and your ground snow load.',
    );
    notes.push(a.attach === 'house' ? 'Attached at the house: one rim track is the ledger. The ledger connection is designed by others.' : 'Freestanding: beams and posts on both long sides are not in this takeoff.');
    notes.push('Joist spacing is limited to 16" or less, as most deck boards require.');
  }
  if (a.type === 'ceiling') notes.push('Sized from our floor-joist tables, which are stricter than ceiling tables.');
  if (a.type === 'office') notes.push('Sized for 100 psf: 50 psf office load, 15 psf for movable partitions, and corridors above the first floor.');
  return notes;
}

// One row per item on the truck, for the takeoff table and the CSV.
export function takeoffRows(p) {
  if (p.status !== 'ok') return [];
  const c = p.chosen;
  const web = c.row.web;
  const rows = [
    { item: 'Floor joists', profile: c.member, qty: c.pieces, unit: 'pcs', length: ftIn(Math.round(c.cutFt * 12)), lf: c.joistLf },
    { item: 'Rim track', profile: `${web}" track, ${c.row.mil} mil`, qty: Math.round(c.rimLf), unit: 'lineal ft', length: '', lf: c.rimLf },
  ];
  if (c.bridgingLf > 0) rows.push({ item: 'Bottom-flange bridging', profile: `${c.bridgingRows} row${c.bridgingRows > 1 ? 's' : ''} per bay`, qty: Math.round(c.bridgingLf), unit: 'lineal ft', length: '', lf: c.bridgingLf });
  if (c.stiffeners > 0) rows.push({ item: 'Web stiffeners', profile: `${web}" web`, qty: c.stiffeners, unit: 'pcs', length: '', lf: 0 });
  return rows;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function projectCsv(areas, project, job = '') {
  const lines = [['Job', 'Area', 'Type', 'Size', 'Item', 'Profile', 'Quantity', 'Unit', 'Cut length', 'Joist spacing', 'Weight (lb)']];
  project.plans.forEach((p, i) => {
    const a = areas[i];
    const head = [job, areaTitle(a, i), projectType(a.type).label, p.lengthFt ? sizeLabel(a) : ''];
    if (p.status !== 'ok') {
      lines.push([...head, p.status === 'incomplete' ? 'Size needed' : 'Sized by our engineering team', '', '', '', '', '', '']);
      return;
    }
    for (const r of takeoffRows(p)) {
      lines.push([...head, r.item, r.profile, r.qty, r.unit, r.length, `${p.chosen.spacing}" o.c.`, r.item === 'Floor joists' ? Math.round(p.chosen.lb) : '']);
    }
  });
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
}

// ---- Share links ------------------------------------------------------------

const FIELD = '~';
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const feet = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 10) / 10 : 0;
};
const psf = (v, fallback) => {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n >= 0 && n <= 500 ? n : fallback;
};
const cleanName = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f~]/g, ' ')
    .trim()
    .slice(0, 40);

export function encodeArea(a) {
  return [a.type, a.len, a.wid, a.beam, a.snow, a.attach, a.stiff === null ? '' : a.stiff ? 1 : 0, a.dl, a.ll, a.opt, cleanName(a.name)].join(FIELD);
}

export function decodeArea(s) {
  const [type, len, wid, beam, snow, attach, stiff, dl, ll, opt, name] = String(s).split(FIELD);
  const a = newArea(oneOf(type, PROJECT_TYPES.map((t) => t.id), 'house'), feet(len), feet(wid));
  a.beam = oneOf(beam, BEAMS.map((b) => b.id), 'auto');
  a.snow = oneOf(snow, SNOW.map((x) => x.id), 'unsure');
  a.attach = oneOf(attach, ['house', 'free'], 'house');
  a.stiff = stiff === '1' ? true : stiff === '0' ? false : null;
  a.dl = psf(dl, 10);
  a.ll = psf(ll, 40);
  a.opt = oneOf(opt, Object.keys(OPTION_LABELS), '');
  a.name = cleanName(name);
  return a;
}

export function projectFromQuery(search) {
  const q = new URLSearchParams(search);
  const areas = q.getAll('a').slice(0, MAX_AREAS).map(decodeArea);
  return {
    areas: areas.length ? areas : [newArea('house', 50, 30)],
    job: cleanName(q.get('job')).slice(0, 80),
    loc: cleanName(q.get('loc')).slice(0, 80),
  };
}

export function projectToQuery(p) {
  const q = new URLSearchParams();
  q.set('mode', 'project');
  for (const a of p.areas.slice(0, MAX_AREAS)) q.append('a', encodeArea(a));
  if (p.job) q.set('job', p.job);
  if (p.loc) q.set('loc', p.loc);
  return `?${q}`;
}

// Span links (and every link made before project mode) carry ?use=.
export function isProjectQuery(search) {
  const q = new URLSearchParams(search);
  if (q.get('mode')) return q.get('mode') !== 'span';
  return !q.has('use');
}
