// Builds one self-contained page (styles, data and script inline) so it can be
// hosted anywhere: Cloudflare Pages, GitHub Pages, or dropped into a website.
//   dist/index.html     the full page for the real address
//   dist/preview.html   the same page as a fragment for the private preview link
//                       (share links are switched off there)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Join the ES modules into one script: drop imports, keep the code.
const stripModule = (src) =>
  src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '').replace(/^export\s+/gm, '');
const script = ['src/data.js', 'src/logic.js', 'src/app.js'].map((p) => stripModule(read(p))).join('\n');

const title = 'Mytikas Joist Span Finder';
const description =
  'Find which Mytikas Steel 2" flange floor joists make your span, by load, spacing, supports and stiffness.';
const head = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${description.replace(/"/g, '&quot;')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&display=swap">
<style>
${read('src/styles.css')}
</style>`;
const body = read('src/body.html');
const run = (share) => `${share ? '' : '<script>window.SPAN_FINDER_SHARE = false;</script>\n'}<script>
(() => {
'use strict';
${script}
})();
</script>`;

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../dist/index.html', import.meta.url),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
${run(true)}
</body>
</html>
`,
);
writeFileSync(new URL('../dist/preview.html', import.meta.url), `${head}\n${body}\n${run(false)}\n`);
console.log('Built dist/index.html and dist/preview.html');
