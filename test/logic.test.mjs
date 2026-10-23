import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROFILES,
  LOAD_CASES,
  SPACINGS,
  DEFLECTIONS,
  CONDITIONS,
  cell,
  evaluate,
  ftIn,
  fromQuery,
  toQuery,
  governingCase,
  requiredInches,
} from '../src/logic.js';
import { SPAN_TABLES } from '../src/data.js';

test('all 1,620 published values are present', () => {
  assert.equal(LOAD_CASES.length, 9);
  let n = 0;
  for (const c of LOAD_CASES)
    for (const p of PROFILES)
      for (const d of DEFLECTIONS)
        for (const k of CONDITIONS)
          for (const s of SPACINGS) {
            const v = cell(c, p.member, d, k, s);
            assert.ok(v.span > 0, `${c.dl}/${c.ll} ${p.member} ${d} ${k} ${s}`);
            n++;
          }
  assert.equal(n, 1620);
  assert.deepEqual(
    LOAD_CASES.map((c) => `${c.dl}/${c.ll}`),
    ['10/20', '10/30', '10/40', '10/50', '10/100', '10/125', '15/125', '25/125', '40/125'],
  );
  for (const t of SPAN_TABLES) assert.deepEqual(Object.keys(t.rows), PROFILES.map((p) => p.member));
});

test("matches every row of the workbook's All Data tab we have", () => {
  const rows = readFileSync(new URL('../data/check/all-data-rows.tsv', import.meta.url), 'utf8')
    .trim()
    .split('\n');
  assert.ok(rows.length > 300);
  for (const row of rows) {
    const [dl, ll, d, k, s, member, inches, code] = row.split('\t');
    const condition = k === 'Single span' ? 'single' : 'two';
    const v = cell({ dl: +dl, ll: +ll }, member, d, condition, +s);
    assert.equal(v.span, +inches, row);
    assert.equal(v.stiffener, code ?? '', row);
  }
});

test("reproduces Eric's Span Lookup example exactly", () => {
  // 10 psf DL / 40 psf LL, L/360, single span, 16" o.c., 14'-0" required.
  const expected = {
    '600S200-54': [168, ''],
    '600S200-68': [180, ''],
    '600S200-97': [200, ''],
    '800S200-54': [210, ''],
    '800S200-68': [226, ''],
    '800S200-97': [251, ''],
    '1000S200-54': [248, ''],
    '1000S200-68': [268, ''],
    '1000S200-97': [301, ''],
    '1200S200-54': [277, 'e'],
    '1200S200-68': [309, ''],
    '1200S200-97': [350, ''],
    '1400S200-54': [294, 'e'],
    '1400S200-68': [348, ''],
    '1400S200-97': [395, ''],
  };
  const r = evaluate({ dl: 10, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 168 });
  assert.equal(r.exact, true);
  assert.equal(r.passing.length, 15);
  for (const row of r.rows) {
    assert.deepEqual([row.span, row.stiffener], expected[row.member], row.member);
    assert.equal(row.spare, expected[row.member][0] - 168);
  }
  assert.equal(r.pick.member, '600S200-54');
});

test('loads between tables round up to the next heavier published table', () => {
  assert.deepEqual(governingCase(10, 40), LOAD_CASES[2]);
  assert.equal(governingCase(8, 35).ll, 40);
  assert.deepEqual([governingCase(15, 40).dl, governingCase(15, 40).ll], [15, 125]);
  assert.deepEqual([governingCase(10, 60).dl, governingCase(10, 60).ll], [10, 100]);
  assert.deepEqual([governingCase(30, 50).dl, governingCase(30, 50).ll], [40, 125]);
  assert.equal(governingCase(41, 10), null);
  assert.equal(governingCase(10, 126), null);
  const r = evaluate({ dl: 15, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 168 });
  assert.equal(r.exact, false);
  assert.equal(r.loadCase.ll, 125);
});

test('a heavier case never allows a longer span (rounding up is always safe)', () => {
  for (let i = 1; i < LOAD_CASES.length; i++)
    for (const p of PROFILES)
      for (const d of DEFLECTIONS)
        for (const k of CONDITIONS)
          for (const s of SPACINGS) {
            const lighter = cell(LOAD_CASES[i - 1], p.member, d, k, s).span;
            const heavier = cell(LOAD_CASES[i], p.member, d, k, s).span;
            assert.ok(heavier <= lighter, `${p.member} ${d} ${k} ${s}: ${LOAD_CASES[i].dl}/${LOAD_CASES[i].ll}`);
          }
});

test('ranks passing joists lightest first and failing ones by span', () => {
  const r = evaluate({ dl: 10, ll: 100, deflection: 'L/480', condition: 'two', spacing: 24, required: 15 * 12 });
  for (let i = 1; i < r.passing.length; i++) assert.ok(r.passing[i - 1].weight <= r.passing[i].weight);
  for (let i = 1; i < r.failing.length; i++) assert.ok(r.failing[i - 1].span >= r.failing[i].span);
  assert.equal(r.passing.length + r.failing.length, 15);
  assert.ok(r.passing.every((x) => x.span >= 180) && r.failing.every((x) => x.span < 180));
});

test('no required span lists everything without pass/fail', () => {
  const r = evaluate({ dl: 10, ll: 40, deflection: 'L/360', condition: 'single', spacing: 16, required: 0 });
  assert.equal(r.rows.length, 15);
  assert.equal(r.pick, null);
  assert.ok(r.rows.every((x) => x.passes === null));
});

test('formats spans the way framers write them', () => {
  assert.equal(ftIn(168), `14'-0"`);
  assert.equal(ftIn(395), `32'-11"`);
  assert.equal(ftIn(-14), `-1'-2"`);
  assert.equal(requiredInches('14', ''), 168);
  assert.equal(requiredInches(12, 6), 150);
});

test('share links round-trip and reject junk', () => {
  const s = { use: 'custom', dl: 25, ll: 80, ft: 18, in: 6, oc: 24, span: 'two', defl: 'L/480', sel: '', area: 0, job: '', loc: '' };
  assert.deepEqual(fromQuery(toQuery(s)), s);
  const office = fromQuery('?use=office&ll=999&oc=19&span=x&defl=240');
  assert.equal(office.ll, 50);
  assert.equal(office.oc, 16);
  assert.equal(office.span, 'single');
  assert.equal(office.defl, 'L/360');
});
