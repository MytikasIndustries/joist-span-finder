import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newArea,
  planArea,
  planProject,
  takeoffRows,
  projectToQuery,
  projectFromQuery,
  isProjectQuery,
  projectCsv,
  areaLoads,
  areaNotes,
  MAX_LENGTH_FT,
  joistPerFt,
  stiffenerPerFt,
  budgetRange,
  PRICING,
} from '../src/project.js';
import { validateQuote, quoteSummary, productInterest, ghlTags } from '../src/quote.js';
import { evaluate } from '../src/logic.js';

test('a 50 × 20 deck at 40 psf: clear span, with the beam saving offered', () => {
  const p = planArea({ ...newArea('deck', 50, 20), snow: '40' });
  assert.equal(p.status, 'ok');
  assert.equal(p.bays, 1);
  assert.equal(p.widthFt, 20);
  const c = p.chosen;
  assert.equal(c.member, '1000S200-54');
  assert.equal(c.spacing, 16);
  // 50 ft at 16" o.c. = 37.5 spaces, rounded up, plus one = 39 joists; each one 20 ft.
  assert.equal(c.pieces, 39);
  assert.equal(c.joistLf, 780);
  assert.equal(Math.round(c.lb), Math.round(780 * 2.86));
  assert.equal(c.rimLf, 100);
  assert.equal(c.blockingRows, 2);
  assert.equal(c.blocks, 2 * 38);
  assert.ok(p.saving && p.saving.bays === 2 && p.saving.member === '600S200-54');
});

test('decks never use 24" spacing; ceilings never use 12"', () => {
  for (const a of [{ ...newArea('deck', 30, 12), snow: 'unsure' }, { ...newArea('deck', 60, 16), snow: '40' }]) {
    const p = planArea(a);
    assert.ok(p.options.every((o) => o.spacing <= 16));
  }
  assert.ok(planArea(newArea('ceiling', 40, 14)).options.every((o) => o.spacing >= 16));
});

test('a 1,500 sq ft house floor gets a mid-span support when it saves 40% or more', () => {
  const p = planArea(newArea('house', 50, 30));
  assert.equal(p.bays, 2);
  assert.equal(p.continuous, true);
  assert.equal(p.defl, 'L/480');
  assert.ok(p.added.pct >= 40);
  assert.equal(p.chosen.spanIn, 180);
  // Every option really makes 15'-0" in the published table.
  for (const o of p.options) {
    const r = evaluate({ dl: 10, ll: 40, deflection: 'L/480', condition: 'two', spacing: o.spacing, required: 180 });
    assert.ok(r.passing.some((x) => x.member === o.member));
  }
  // Saying "No" to a middle support is respected.
  const clear = planArea({ ...newArea('house', 50, 30), beam: 'none' });
  assert.equal(clear.bays, 1);
  assert.equal(clear.chosen.spanIn, 360);
});

test('options: lightest steel is never heavier than the others', () => {
  for (const a of [newArea('house', 40, 24), newArea('office', 80, 30), newArea('industrial', 40, 18)]) {
    const p = planArea(a);
    const light = p.options.find((o) => o.keys.includes('lightest'));
    for (const o of p.options) assert.ok(light.lb <= o.lb + 1e-9);
    const shallow = p.options.find((o) => o.keys.includes('shallowest'));
    for (const o of p.options) assert.ok(shallow.row.web <= o.row.web);
  }
});

test('nothing longer than 60 ft is cut, and wide areas get beam lines', () => {
  const p = planArea({ ...newArea('house', 90, 70), beam: 'none' });
  assert.equal(p.status, 'ok');
  assert.ok(p.forced);
  assert.ok(p.bays >= 2);
  assert.ok(p.chosen.cutFt <= MAX_LENGTH_FT);
});

test('heavy storage and missing sizes go to our team', () => {
  assert.equal(planArea(newArea('heavy', 40, 20)).status, 'beyond');
  assert.equal(planArea(newArea('house', 0, 20)).status, 'incomplete');
  const custom = { ...newArea('custom', 30, 12), dl: 50, ll: 40 };
  assert.equal(planArea(custom).status, 'beyond');
});

test('deck snow: not sure is sized at 70 psf, which uses the 100 psf table', () => {
  assert.deepEqual(areaLoads({ ...newArea('deck', 20, 12), snow: 'unsure' }), { dl: 10, ll: 70 });
  assert.equal(planArea({ ...newArea('deck', 20, 12), snow: 'unsure' }).loadCase.ll, 100);
  assert.deepEqual(areaLoads({ ...newArea('deck', 20, 12), snow: '50' }), { dl: 10, ll: 50 });
});

test('takeoff rows and project totals add up', () => {
  const areas = [newArea('house', 50, 30), { ...newArea('deck', 20, 12), name: 'Back deck', snow: '40' }];
  const pr = planProject(areas);
  assert.equal(pr.totals.sqft, 1740);
  assert.equal(Math.round(pr.totals.joistLf), Math.round(pr.plans[0].chosen.joistLf + pr.plans[1].chosen.joistLf));
  const rows = takeoffRows(pr.plans[0]);
  assert.equal(rows[0].item, 'Floor joists');
  assert.equal(rows[0].qty, pr.plans[0].chosen.pieces);
  const csv = projectCsv(areas, pr, 'Smith, "Lot 4"');
  assert.match(csv, /^Not for construction\. This tool gives rough estimates/);
  assert.match(csv, /\r\n\r\nJob,Area,Type/);
  assert.match(csv, /"Smith, ""Lot 4""",Back deck,Deck/);
});

test('project links round-trip, reject junk, and old links stay in span mode', () => {
  const pr = { areas: [newArea('house', 50, 30), { ...newArea('deck', 20.5, 12), name: 'Back~deck', stiff: true, opt: 'fewest' }], job: 'Smith', loc: 'Florence, CO' };
  const back = projectFromQuery(projectToQuery(pr));
  assert.equal(back.areas[1].name, 'Back deck');
  assert.equal(back.areas[1].len, 20.5);
  assert.equal(back.areas[1].stiff, true);
  assert.equal(back.areas[1].opt, 'fewest');
  const junk = projectFromQuery('?mode=project&a=bogus~-5~abc~zz');
  assert.equal(junk.areas[0].type, '');
  assert.equal(planArea(junk.areas[0]).status, 'notype');
  assert.equal(projectFromQuery('').areas[0].type, '');
  assert.equal(junk.areas[0].len, 0);
  assert.equal(junk.areas[0].beam, 'auto');
  assert.equal(projectFromQuery('?mode=project&' + 'a=deck~10~10&'.repeat(20)).areas.length, 8);
  assert.equal(isProjectQuery('?use=living&ft=14'), false);
  assert.equal(isProjectQuery('?mode=span&use=house'), false);
  assert.equal(isProjectQuery(''), true);
});

test('a project quote request becomes a sales note with every area and the totals', () => {
  const query = projectToQuery({ areas: [newArea('house', 50, 30), { ...newArea('deck', 50, 20), snow: '40', name: 'Back deck' }, newArea('heavy', 40, 20)], job: 'Smith', loc: '' });
  const v = validateQuote({ name: 'Dana Ruiz', email: 'dana@example.com', role: 'gc', stage: 'bid', timing: '90', eor: 'notyet', supply: 'nonsense', query }).value;
  assert.equal(v.mode, 'project');
  assert.equal(v.supply, '');
  const note = quoteSummary(v, 'https://mytikas-spans.pages.dev');
  assert.match(note, /Stage: Bidding · Material needed: 1 to 3 months · Engineer of record: Not yet/);
  assert.match(note, /1\. House floor, 50 × 30 ft, 1,500 sq ft/);
  assert.match(note, /Joists: 26 × 800S200-54 at 24" o\.c\., cut 30'-0"/);
  assert.match(note, /2\. Back deck: Deck, 50 × 20 ft/);
  assert.match(note, /3\. Heavy storage or equipment, 40 × 20 ft[\s\S]*Needs engineering/);
  assert.match(note, /Total: 3 areas, 3,300 sq ft/);
  assert.match(note, /Open their project: https:\/\/mytikas-spans\.pages\.dev\/\?mode=project&a=/);
  assert.equal(productInterest(v), 'joists (3 areas, 3,300 sq ft)');
  const one = validateQuote({ name: 'D', email: 'd@x.co', query: projectToQuery({ areas: [newArea('deck', 50, 20)], job: '', loc: '' }) }).value;
  assert.equal(productInterest(one), 'deck joists (50 × 20 ft)');
});

test('pricing follows the Oct 19 matrix at the markup we set', () => {
  // At the matrix's own 75% these are Eric's Oct 25 figures to the cent.
  const at = (markup, f) => {
    const keep = PRICING.markup;
    PRICING.markup = markup;
    try { return f(); } finally { PRICING.markup = keep; }
  };
  assert.equal(at(0.75, () => joistPerFt({ web: 12, mil: 54 }).price), 7.2);
  assert.equal(at(0.75, () => joistPerFt({ web: 14, mil: 68 }).price), 10.12);
  assert.equal(at(0.75, () => joistPerFt({ web: 8, mil: 54 }).price), 5.45);
  assert.equal(at(0.75, () => stiffenerPerFt().price), 2.72);
  assert.equal(PRICING.markup, 0.5);
  assert.equal(joistPerFt({ web: 10, mil: 54 }).price, 5.42); // $3.61 raw x 1.5
  assert.deepEqual(budgetRange(6012), { low: 6000, high: 6400 });
});

test("Eric's takeoff rules: rim track named, solid blocking, 4-inch stiffeners, every line priced", () => {
  const p = planArea(newArea('house', 50, 30));
  const rows = takeoffRows(p);
  assert.deepEqual(rows.map((r) => r.item), ['Floor joists', 'Rim track', 'Solid blocking', 'Web stiffeners']);
  assert.equal(rows[1].profile, '800T200-54');
  assert.equal(rows[2].profile, '800S200-54');
  assert.equal(rows[2].length, `2'-0"`);
  assert.equal(rows[3].profile, '400S162-43');
  assert.equal(rows[3].length, '7-1/2"');
  const sum = rows.reduce((n, r) => n + r.cost, 0);
  assert.ok(Math.abs(sum - p.chosen.cost) < 0.01);
  const note = quoteSummary(validateQuote({ name: 'D', email: 'd@x.co', query: projectToQuery({ areas: [newArea('house', 50, 30)], job: '', loc: '' }) }).value, 'https://x');
  assert.match(note, /Rim track: 800T200-54, 100 lf = 100 lf × \$\d+\.\d\d = \$/);
  assert.match(note, /\+ 5% contingency = .*Shown on the page as \$[\d,]+ to \$[\d,]+\./);
  assert.match(note, /coil \$1\.25\/lb, 50% markup, cut and punched\. No delivery or panelizing\./);
});

test('a deck waits for its snow load; old links keep theirs', () => {
  const p = planArea(newArea('deck', 20, 14));
  assert.equal(p.status, 'incomplete');
  assert.equal(p.need, 'snow');
  assert.equal(planArea({ ...newArea('deck', 20, 14), snow: '40' }).chosen.member, '600S200-54');
  assert.equal(projectFromQuery(projectToQuery({ areas: [newArea('deck', 20, 14)], job: '', loc: '' })).areas[0].snow, '');
  assert.equal(projectFromQuery('?mode=project&a=deck~20~14~auto~bogus~house').areas[0].snow, 'unsure');
});

test('point loads travel in the link, the notes, the sales note and the tags', () => {
  const a = { ...newArea('deck', 20, 14), snow: '40', point: true };
  const query = projectToQuery({ areas: [a], job: '', loc: '' });
  assert.equal(projectFromQuery(query).areas[0].point, true);
  assert.equal(projectFromQuery(projectToQuery({ areas: [newArea('house', 20, 14)], job: '', loc: '' })).areas[0].point, false);
  assert.match(areaNotes(a, planArea(a)).join(' '), /Point loads noted/);
  const v = validateQuote({ name: 'D', email: 'd@x.co', role: 'gc', query }).value;
  assert.match(quoteSummary(v, 'https://x'), /POINT LOADS: yes/);
  assert.ok(ghlTags(v).includes('point loads'));
});
