import {
  evaluate,
  fromQuery,
  toQuery,
  requiredInches,
  selectedRow,
  roughQuantity,
  stiffenerText,
  useLabel,
  ftIn,
} from './logic.js';

export const ROLES = [
  ['gc', 'General contractor'],
  ['framer', 'Framing contractor'],
  ['engineer', 'Engineer'],
  ['architect', 'Architect or designer'],
  ['owner', 'Owner or developer'],
  ['other', 'Other'],
];

const LIMITS = { name: 100, company: 120, email: 160, phone: 30, notes: 2000 };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

const text = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

/**
 * Checks a quote request from the page. The span selection arrives as the
 * same query string a share link uses, so it is re-read and re-checked here
 * rather than trusting any numbers the browser sends.
 */
export function validateQuote(input) {
  const errors = {};
  const v = {
    name: text(input?.name, LIMITS.name),
    company: text(input?.company, LIMITS.company),
    email: text(input?.email, LIMITS.email).toLowerCase(),
    phone: text(input?.phone, LIMITS.phone),
    role: ROLES.some(([id]) => id === input?.role) ? input.role : 'other',
    notes: text(input?.notes, LIMITS.notes),
    state: fromQuery(typeof input?.query === 'string' ? input.query.slice(0, 600) : ''),
  };
  if (!v.name) errors.name = 'Enter your name.';
  if (!EMAIL.test(v.email)) errors.email = 'Enter an email address we can reply to.';
  if (v.phone && !/^[0-9+().\-\s x]{7,}$/i.test(v.phone)) errors.phone = 'Enter a phone number, or leave it blank.';
  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

// Plain-text summary for the sales team, built from the checked selection.
export function quoteSummary(v, origin) {
  const s = v.state;
  const required = requiredInches(s.ft, s.in);
  const result = evaluate({ dl: s.dl, ll: s.ll, deflection: s.defl, condition: s.span, spacing: s.oc, required });
  const role = ROLES.find(([id]) => id === v.role)[1];
  const lines = ['Quote request from the joist span finder', ''];
  lines.push(`Contact: ${v.name}${v.company ? `, ${v.company}` : ''} (${role})`);
  lines.push(`Email: ${v.email}${v.phone ? ` · Phone: ${v.phone}` : ''}`);
  if (s.job || s.loc) lines.push(`Job: ${[s.job, s.loc].filter(Boolean).join(', ')}`);
  lines.push('');
  if (!result.loadCase) {
    lines.push(`Loads: ${s.dl} psf dead + ${s.ll} psf live, beyond the published tables. Needs engineering.`);
  } else {
    const lc = result.loadCase;
    lines.push(`Floor: ${useLabel(s)}, ${s.dl} psf dead + ${s.ll} psf live`);
    lines.push(`Table used: ${lc.dl} psf dead + ${lc.ll} psf live${result.exact ? '' : ' (next heavier table)'}`);
    lines.push(
      `Span: ${required > 0 ? ftIn(required) : 'not given'}, ${s.span === 'two' ? 'two equal spans' : 'one span'}, ${s.oc}" o.c., live-load deflection ${s.defl}`,
    );
    const row = required > 0 ? selectedRow(result, s.sel) : null;
    if (row) {
      lines.push(`Joist: ${row.member} (${row.web}" web, ${row.gauge} ga, ${row.mil} mil, 50 ksi), allowable ${ftIn(row.span)}, ${row.weight.toFixed(2)} lb/ft`);
      lines.push(stiffenerText(row.stiffener));
      const q = roughQuantity(row, s.area, s.oc);
      if (q) lines.push(`Floor area: ${s.area.toLocaleString('en-US')} sq ft, about ${q.linealFt.toLocaleString('en-US')} lineal ft and ${q.lb.toLocaleString('en-US')} lb of joists (rough, joists only)`);
    } else if (required > 0) {
      lines.push('No 2" flange joist makes this span at these settings. Needs engineering.');
    }
  }
  if (v.notes) lines.push('', `Notes: ${v.notes}`);
  lines.push('', `Open their selection: ${origin}/${toQuery(s)}`);
  return lines.join('\n');
}

// Go High Level contact upsert body (API v2).
export function ghlContact(v, locationId) {
  const [firstName, ...rest] = v.name.split(/\s+/);
  return {
    locationId,
    firstName,
    lastName: rest.join(' '),
    name: v.name,
    email: v.email,
    ...(v.phone ? { phone: v.phone } : {}),
    ...(v.company ? { companyName: v.company } : {}),
    source: 'Joist span finder',
    tags: ['joist span finder', `role: ${v.role}`],
  };
}
