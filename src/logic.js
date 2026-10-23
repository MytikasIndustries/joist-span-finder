import { SPAN_TABLES } from './data.js';

// Mytikas Steel 2" flange (S200) joists, 50 ksi. Weights are lb/ft from the
// ClarkDietrich guide, pp. 13–17 (gross properties of the same sections).
export const PROFILES = [
  { member: '600S200-54', web: 6, gauge: 16, mil: 54, weight: 2.09 },
  { member: '600S200-68', web: 6, gauge: 14, mil: 68, weight: 2.6 },
  { member: '600S200-97', web: 6, gauge: 12, mil: 97, weight: 3.63 },
  { member: '800S200-54', web: 8, gauge: 16, mil: 54, weight: 2.47 },
  { member: '800S200-68', web: 8, gauge: 14, mil: 68, weight: 3.09 },
  { member: '800S200-97', web: 8, gauge: 12, mil: 97, weight: 4.32 },
  { member: '1000S200-54', web: 10, gauge: 16, mil: 54, weight: 2.86 },
  { member: '1000S200-68', web: 10, gauge: 14, mil: 68, weight: 3.57 },
  { member: '1000S200-97', web: 10, gauge: 12, mil: 97, weight: 5.02 },
  { member: '1200S200-54', web: 12, gauge: 16, mil: 54, weight: 3.24 },
  { member: '1200S200-68', web: 12, gauge: 14, mil: 68, weight: 4.06 },
  { member: '1200S200-97', web: 12, gauge: 12, mil: 97, weight: 5.71 },
  { member: '1400S200-54', web: 14, gauge: 16, mil: 54, weight: 3.63 },
  { member: '1400S200-68', web: 14, gauge: 14, mil: 68, weight: 4.54 },
  { member: '1400S200-97', web: 14, gauge: 12, mil: 97, weight: 6.4 },
];

export const SPACINGS = [12, 16, 24];
export const DEFLECTIONS = ['L/360', 'L/480'];
export const CONDITIONS = ['single', 'two'];

// Load cases in the order the guide publishes them. Each one is at least as
// heavy as the one before in both dead and live load, so the first case that
// covers the user's loads is the least conservative safe choice.
export const LOAD_CASES = SPAN_TABLES.map((t) => ({
  dl: t.dl,
  ll: t.ll,
  total: t.dl + t.ll,
  pages: t.pages,
}));

// Typical minimum live loads, IBC Table 1607.1.
export const USES = [
  { id: 'living', label: 'Living areas', detail: 'Homes, cabins, apartments', ll: 40 },
  { id: 'sleeping', label: 'Bedrooms and sleeping lofts', detail: 'Sleeping areas only', ll: 30 },
  { id: 'attic', label: 'Attic storage', detail: 'No living space', ll: 20 },
  { id: 'office', label: 'Offices', detail: 'Office floors', ll: 50 },
  { id: 'assembly', label: 'Lobbies, corridors and gathering spaces', detail: 'Restaurants, assembly, public corridors', ll: 100 },
  { id: 'storage', label: 'Light storage and light manufacturing', detail: 'Warehouse and shop floors', ll: 125 },
];

export const FLOOR_WEIGHTS = [
  { dl: 10, label: 'Standard', detail: 'Sheathing, flooring and a ceiling below' },
  { dl: 15, label: 'Heavier finish', detail: 'Tile or stone flooring' },
  { dl: 25, label: 'Topping', detail: 'Poured gypsum or lightweight topping' },
  { dl: 40, label: 'Concrete topping', detail: 'Normal-weight concrete over deck' },
];

export function governingCase(dl, ll) {
  return LOAD_CASES.find((c) => c.dl >= dl && c.ll >= ll) ?? null;
}

function columnIndex(deflection, condition, spacing) {
  const d = DEFLECTIONS.indexOf(deflection);
  const c = CONDITIONS.indexOf(condition);
  const s = SPACINGS.indexOf(spacing);
  if (d < 0 || c < 0 || s < 0) throw new Error(`No column for ${deflection} ${condition} ${spacing}`);
  return d * 6 + c * 3 + s;
}

function parseCell(cell) {
  const code = /[eia]$/.test(cell) ? cell.slice(-1) : '';
  return { span: parseInt(cell, 10), stiffener: code };
}

export function tableFor(loadCase) {
  return SPAN_TABLES.find((t) => t.dl === loadCase.dl && t.ll === loadCase.ll);
}

// One published value: allowable span in inches and web stiffener code.
export function cell(loadCase, member, deflection, condition, spacing) {
  return parseCell(tableFor(loadCase).rows[member][columnIndex(deflection, condition, spacing)]);
}

export function stiffenerText(code) {
  return (
    {
      e: 'Web stiffeners at end supports',
      i: 'Web stiffeners at the center support',
      a: 'Web stiffeners at all supports',
    }[code] ?? 'No web stiffeners needed'
  );
}

// Inches to the framing convention, e.g. 168 -> 14'-0".
export function ftIn(inches) {
  const sign = inches < 0 ? '-' : '';
  const n = Math.abs(Math.round(inches));
  return `${sign}${Math.floor(n / 12)}'-${n % 12}"`;
}

export function requiredInches(feet, inches) {
  const f = Number(feet) || 0;
  const i = Number(inches) || 0;
  return f * 12 + i;
}

/**
 * The whole answer for one set of inputs.
 * inputs: { dl, ll, deflection, condition, spacing, required } (required in inches; 0 = none)
 */
export function evaluate({ dl, ll, deflection, condition, spacing, required }) {
  const loadCase = governingCase(dl, ll);
  if (!loadCase) return { loadCase: null, exact: false, rows: [], passing: [], failing: [], pick: null };
  const exact = loadCase.dl === dl && loadCase.ll === ll;
  const rows = PROFILES.map((p) => {
    const { span, stiffener } = cell(loadCase, p.member, deflection, condition, spacing);
    return {
      ...p,
      span,
      stiffener,
      passes: required > 0 ? span >= required : null,
      spare: required > 0 ? span - required : null,
      // Joist steel per square foot of floor at this spacing.
      perSqFt: p.weight / (spacing / 12),
    };
  });
  const byWeight = (a, b) => a.weight - b.weight || b.span - a.span;
  const passing = required > 0 ? rows.filter((r) => r.passes).sort(byWeight) : [];
  const failing = required > 0 ? rows.filter((r) => !r.passes).sort((a, b) => b.span - a.span) : [];
  return { loadCase, exact, rows, passing, failing, pick: passing[0] ?? null };
}

// Rough joist quantity for a floor area: joist steel only, no rim track,
// blocking, bridging or waste. Lineal feet = area / spacing in feet.
export function roughQuantity(row, areaSqFt, spacing) {
  if (!(areaSqFt > 0)) return null;
  return {
    linealFt: Math.round(areaSqFt / (spacing / 12)),
    lb: Math.round(row.perSqFt * areaSqFt),
  };
}

// The joist a person chose, if it still makes the span; otherwise our pick.
export function selectedRow(result, member) {
  return result.passing.find((r) => r.member === member) ?? result.pick;
}

export function useLabel(s) {
  if (s.use === 'custom') return 'Engineer-entered loads';
  return USES.find((u) => u.id === s.use)?.label ?? '';
}

// Inputs <-> URL query, so a result can be shared as a link.
export const DEFAULTS = {
  use: 'living',
  dl: 10,
  ll: 40,
  ft: 14,
  in: 0,
  oc: 16,
  span: 'single',
  defl: 'L/360',
  sel: '',
  area: 0,
  job: '',
  loc: '',
};

const TEXT_LIMIT = 80;
const cleanText = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, TEXT_LIMIT);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fromQuery(search) {
  const q = new URLSearchParams(search);
  const s = { ...DEFAULTS };
  const use = q.get('use');
  if (use === 'custom' || USES.some((u) => u.id === use)) s.use = use;
  const num = (k, lo, hi) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
  };
  s.dl = num('dl', 0, 500) ?? s.dl;
  s.ll = num('ll', 0, 500) ?? s.ll;
  if (s.use !== 'custom') s.ll = USES.find((u) => u.id === s.use).ll;
  s.ft = num('ft', 0, 100) ?? s.ft;
  s.in = num('in', 0, 11.99) ?? s.in;
  const oc = Number(q.get('oc'));
  if (SPACINGS.includes(oc)) s.oc = oc;
  if (CONDITIONS.includes(q.get('span'))) s.span = q.get('span');
  const defl = q.get('defl');
  if (defl === '360' || defl === '480') s.defl = `L/${defl}`;
  if (PROFILES.some((p) => p.member === q.get('sel'))) s.sel = q.get('sel');
  s.area = Math.round(num('area', 0, 1000000) ?? 0);
  s.job = cleanText(q.get('job'));
  s.loc = cleanText(q.get('loc'));
  return s;
}

export function toQuery(s) {
  const q = new URLSearchParams();
  q.set('use', s.use);
  if (s.use === 'custom') q.set('ll', String(s.ll));
  q.set('dl', String(s.dl));
  q.set('ft', String(s.ft));
  q.set('in', String(s.in));
  q.set('oc', String(s.oc));
  q.set('span', s.span);
  q.set('defl', s.defl.slice(2));
  if (s.sel) q.set('sel', s.sel);
  if (s.area > 0) q.set('area', String(s.area));
  if (s.job) q.set('job', s.job);
  if (s.loc) q.set('loc', s.loc);
  return `?${q}`;
}
