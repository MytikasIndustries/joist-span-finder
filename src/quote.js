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
import {
  planProject,
  projectFromQuery,
  projectToQuery,
  isProjectQuery,
  areaTitle,
  sizeLabel,
  areaNotes,
  takeoffRows,
  projectType,
} from './project.js';

// What the sales team asks on the first call, asked up front.
export const STAGES = [
  ['budget', 'Budgeting'],
  ['bid', 'Bidding'],
  ['awarded', 'Awarded'],
  ['order', 'Ready to order'],
];
export const TIMING = [
  ['30', 'Within 30 days'],
  ['90', '1 to 3 months'],
  ['later', 'More than 3 months out'],
  ['unsure', 'Not sure yet'],
];
export const EOR = [
  ['yes', 'Yes'],
  ['notyet', 'Not yet'],
];
export const SUPPLY = [
  ['cut', 'Joists cut to length'],
  ['panels', 'Panelized, ready to erect'],
  ['unsure', 'Not sure'],
];
// Plans and drawings a contractor attaches. Go High Level's media library
// takes files up to 25 MB.
export const FILE_RULES = { max: 5, maxBytes: 25 * 1024 * 1024, exts: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'dwg', 'dxf'] };
export const fileExt = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) ?? [])[1] ?? '';
export function checkFiles(files) {
  if (files.length > FILE_RULES.max) return `Attach up to ${FILE_RULES.max} files.`;
  for (const f of files) {
    if (!FILE_RULES.exts.includes(fileExt(f.name))) return `${f.name}: use PDF, DWG, DXF or a photo.`;
    if (f.size > FILE_RULES.maxBytes) return `${f.name} is over 25 MB. Email it to info@mytikasindustries.com instead.`;
    if (!(f.size > 0)) return `${f.name} is empty.`;
  }
  return '';
}
export const cleanFileName = (name) =>
  String(name)
    .replace(/[\u0000-\u001f\u007f/\\]/g, ' ')
    .trim()
    .slice(-120) || 'plans';

function planLines(files) {
  if (!files.length) return [];
  return ['', 'Plans:', ...files.map((f) => (f.url ? `   ${f.name}: ${f.url}` : `   ${f.name}: could not be saved; ask them to email it.`))];
}

const pickFrom = (list, v) => (list.some(([id]) => id === v) ? v : '');
const labelOf = (list, v) => list.find(([id]) => id === v)?.[1] ?? '';
const n0 = (n) => Math.round(n).toLocaleString('en-US');

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
    stage: pickFrom(STAGES, input?.stage),
    timing: pickFrom(TIMING, input?.timing),
    eor: pickFrom(EOR, input?.eor),
    supply: pickFrom(SUPPLY, input?.supply),
  };
  const query = typeof input?.query === 'string' ? input.query.slice(0, 3000) : '';
  v.mode = isProjectQuery(query) ? 'project' : 'span';
  if (v.mode === 'project') v.project = projectFromQuery(query);
  else v.state = fromQuery(query);
  if (!v.name) errors.name = 'Enter your name.';
  if (!EMAIL.test(v.email)) errors.email = 'Enter an email address we can reply to.';
  if (v.phone && !/^[0-9+().\-\s x]{7,}$/i.test(v.phone)) errors.phone = 'Enter a phone number, or leave it blank.';
  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

// Plain-text summary for the sales team, built from the checked selection.
function headerLines(v, job, loc) {
  const role = ROLES.find(([id]) => id === v.role)[1];
  const lines = [`Quote request from the joist span finder${v.mode === 'project' ? ' (project)' : ''}`, ''];
  lines.push(`Contact: ${v.name}${v.company ? `, ${v.company}` : ''} (${role})`);
  lines.push(`Email: ${v.email}${v.phone ? ` · Phone: ${v.phone}` : ''}`);
  if (job || loc) lines.push(`Job: ${[job, loc].filter(Boolean).join(', ')}`);
  const about = [
    v.stage && `Stage: ${labelOf(STAGES, v.stage)}`,
    v.timing && `Material needed: ${labelOf(TIMING, v.timing)}`,
    v.eor && `Engineer of record: ${labelOf(EOR, v.eor)}`,
    v.supply && `Supply: ${labelOf(SUPPLY, v.supply)}`,
  ].filter(Boolean);
  if (about.length) lines.push(about.join(' · '));
  lines.push('');
  return lines;
}

function projectSummary(v, origin, files) {
  const pr = v.project;
  const { plans, totals } = planProject(pr.areas);
  const lines = headerLines(v, pr.job, pr.loc);
  // Plans only, nothing entered in the tool: the takeoff is ours to do.
  if (files.length && pr.areas.every((a) => !a.type)) {
    lines.push('Sent plans for a takeoff; nothing entered in the tool.');
    lines.push(...planLines(files));
    if (v.notes) lines.push('', `Notes: ${v.notes}`);
    return lines.join('\n');
  }
  plans.forEach((p, i) => {
    const a = pr.areas[i];
    const t = projectType(a.type);
    lines.push(`${i + 1}. ${a.name ? `${a.name}: ` : ''}${a.type ? t.label : 'Type not chosen'}${p.lengthFt ? `, ${sizeLabel(a)}, ${n0(p.sqft)} sq ft` : ''}`);
    if (p.status === 'incomplete' || p.status === 'notype') lines.push('   Not finished.');
    else if (p.status === 'beyond') lines.push(`   ${p.loads.dl} psf dead + ${p.loads.ll} psf live: beyond the published tables. Needs engineering.`);
    else if (p.status === 'nofit') lines.push('   No 2" flange joist makes this with up to three beam lines. Needs engineering.');
    else {
      const c = p.chosen;
      lines.push(`   Loads: ${p.loads.dl} + ${p.loads.ll} psf, ${p.defl}; table ${p.loadCase.dl}/${p.loadCase.ll}${p.exact ? '' : ' (next heavier)'}`);
      lines.push(
        `   Layout: ${p.bays === 1 ? `one ${ftIn(c.spanIn)} span` : p.continuous ? `two ${ftIn(c.spanIn)} spans, continuous over a mid-span support` : `${p.bays} spans of ${ftIn(c.spanIn)} on ${p.bays - 1} beam lines`}`,
      );
      lines.push(`   Joists: ${c.pieces} × ${c.member} at ${c.spacing}" o.c., cut ${ftIn(Math.round(c.cutFt * 12))} (${n0(c.joistLf)} lineal ft, ${n0(c.lb)} lb)`);
      const rest = takeoffRows(p)
        .slice(1)
        .map((r) => `${r.item} ${n0(r.qty)} ${r.unit === 'pcs' ? 'pcs' : 'lf'}`);
      if (rest.length) lines.push(`   ${rest.join(' · ')}`);
      if (a.type === 'deck') lines.push(`   Deck: ${a.attach === 'house' ? 'attached to the house' : 'freestanding'}, snow ${a.snow === 'unsure' ? 'not known (sized at 70)' : `${a.snow === '70' ? '60 to 70' : a.snow} psf`}`);
      if (p.bays > 1) lines.push(`   Needs ${p.bays - 1} beam line${p.bays > 2 ? 's' : ''} (not in takeoff)${p.added ? ', added by the tool' : ''}`);
    }
  });
  lines.push('', `Total: ${totals.areas} area${totals.areas > 1 ? 's' : ''}, ${n0(totals.sqft)} sq ft, about ${n0(totals.joistLf)} lineal ft and ${n0(totals.lb)} lb of joists`);
  if (totals.needsUs) lines.push(`${totals.needsUs} area${totals.needsUs > 1 ? 's need' : ' needs'} our engineering team.`);
  lines.push(...planLines(files));
  if (v.notes) lines.push('', `Notes: ${v.notes}`);
  lines.push('', `Open their project: ${origin}/${projectToQuery(pr)}`);
  return lines.join('\n');
}

export function quoteSummary(v, origin, files = []) {
  if (v.mode === 'project') return projectSummary(v, origin, files);
  const s = v.state;
  const required = requiredInches(s.ft, s.in);
  const result = evaluate({ dl: s.dl, ll: s.ll, deflection: s.defl, condition: s.span, spacing: s.oc, required });
  const lines = headerLines(v, s.job, s.loc);
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
  lines.push(...planLines(files));
  if (v.notes) lines.push('', `Notes: ${v.notes}`);
  lines.push('', `Open their selection: ${origin}/${toQuery(s)}`);
  return lines.join('\n');
}

// Go High Level custom fields the website hand-off already fills (same ids).
export const GHL_FIELDS = {
  inquiryType: 'CCSAphpOyklZePnmX6lz', // contact.web_inquiry_type
  productInterest: 'h7pI7eRmEMcdAtKPtggG', // contact.web_product_interest
  submissionDetails: 'DK4ut46iQGDQVjmnIERz', // contact.web_submission_details
};

// Tags that start the CRM workflows. `web-lead` starts the 60-minute response
// clock (owner Adam, card in Sales / New, alerts) and the source tag;
// `web-joist` starts the span finder's own reply. They are removed and added
// again on every request so a returning contact runs the workflows again,
// the same way the website hand-off does it.
// Plans sent with nothing entered in the tool get `web-plans` instead: the
// span finder reply talks about spans they entered, so it would not fit.
export const GHL_TRIGGER_TAGS = ['web-lead', 'web-joist'];
export const plansOnly = (v, fileCount) => fileCount > 0 && v.mode === 'project' && v.project.areas.every((a) => !a.type);
export const triggerTags = (v, fileCount = 0) => (plansOnly(v, fileCount) ? ['web-lead', 'web-plans'] : GHL_TRIGGER_TAGS);

// Every tag the contact should carry after a quote request.
export function ghlTags(v, fileCount = 0) {
  return [...triggerTags(v, fileCount), 'joist span finder', `role: ${v.role}`, ...(fileCount > 0 ? ['plans attached'] : [])];
}

// What they selected, in a few words, for the "Web product interest" field.
// Written as a plural noun so it reads right in the reply's subject and body:
// "Your deck joists (50 × 20 ft) request reached us".
export function productInterest(v) {
  if (v.mode === 'project') {
    const areas = v.project.areas;
    const sqft = areas.reduce((n, a) => n + a.len * a.wid, 0);
    if (areas.length === 1) {
      const a = areas[0];
      if (!a.type) return 'Mytikas Steel joists';
      return a.len > 0 && a.wid > 0 ? `${projectType(a.type).noun} (${sizeLabel(a)})` : projectType(a.type).noun;
    }
    return `joists (${areas.length} areas${sqft > 0 ? `, ${n0(sqft)} sq ft` : ''})`;
  }
  const s = v.state;
  const required = requiredInches(s.ft, s.in);
  if (required <= 0) return 'Mytikas Steel floor joists';
  const result = evaluate({ dl: s.dl, ll: s.ll, deflection: s.defl, condition: s.span, spacing: s.oc, required });
  const row = result.loadCase ? selectedRow(result, s.sel) : null;
  return row ? `${row.member} floor joists` : 'Mytikas Steel floor joists';
}

// Go High Level contact upsert body (API v2). No tags here: an upsert replaces
// the tags a returning contact already has, so tags are added in a separate call.
export function ghlContact(v, locationId, summary = '') {
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
    customFields: [
      { id: GHL_FIELDS.inquiryType, field_value: 'Joist span finder' },
      { id: GHL_FIELDS.productInterest, field_value: productInterest(v) },
      ...(summary ? [{ id: GHL_FIELDS.submissionDetails, field_value: summary }] : []),
    ],
  };
}
