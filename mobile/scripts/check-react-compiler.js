/**
 * Fails if the React Compiler silently skips a component.
 *
 * `reactCompiler: true` is on (app.json), and a lot of this app's code
 * assumes the memoization it provides — most visibly the Room feed, where
 * FlatList's `strictMode` only helps if `renderItem` keeps its identity.
 * But a component the compiler can't handle is simply left uncompiled:
 * Metro still logs "React Compiler enabled", and lint and typecheck both
 * pass. Nothing reports it, which is how 26 of 85 files drifted into being
 * skipped before anyone noticed (see decision-log, 2026-09-17).
 *
 * So this runs the compiler over `src` the way Metro would and treats a
 * skipped component as a build failure. Run it with `npm run check:compiler`.
 *
 * BASELINE is empty, and the whole app compiles. It exists for the case
 * where a component genuinely can't be written the way the compiler needs;
 * it's a ratchet, not a dumping ground, since a file listed here that no
 * longer skips is *also* an error, so the list can only shrink. Don't add
 * to it to make a build pass — fix the component. The rewrites the
 * compiler needs (no `try/finally`, no conditionals or `throw` inside a
 * `try`, no react-hooks eslint-disable, `.get()`/`.set()` on Reanimated
 * shared values, no reading a ref during render, and no passing a
 * ref-capturing closure to a hook that runs during render) are written up
 * in decision-log, 2026-09-17 and 2026-09-20.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(PROJECT_ROOT, 'src');

// Files whose components the compiler still can't handle. Must only shrink.
const BASELINE = [];

const babel = require('@babel/core');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(t|j)sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const skipsByFile = new Map();
let compiled = 0;

const logger = {
  logEvent(filename, event) {
    if (event.kind === 'CompileSuccess') {
      compiled += 1;
      return;
    }
    if (event.kind !== 'CompileError') return;
    const rel = path.relative(SRC, filename).split(path.sep).join('/');
    const reason = event.detail?.options?.reason ?? event.detail?.reason ?? 'unknown reason';
    const line = event.detail?.options?.loc?.start?.line ?? event.fnLoc?.start?.line ?? '?';
    if (!skipsByFile.has(rel)) skipsByFile.set(rel, []);
    skipsByFile.get(rel).push(`L${line}: ${reason}`);
  },
};

for (const file of sourceFiles(SRC)) {
  babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    // Types stripped the way Metro's own preset does, so the compiler sees
    // the same code it sees in a real build.
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
    plugins: [[require.resolve('babel-plugin-react-compiler'), { logger }]],
  });
}

const skipped = [...skipsByFile.keys()].sort();
const unexpected = skipped.filter((f) => !BASELINE.includes(f));
const fixed = BASELINE.filter((f) => !skipped.includes(f));

console.log(`React Compiler: ${compiled} components compiled, ${skipped.length} file(s) with skips.`);

if (unexpected.length > 0) {
  console.error('\nThese components are NOT being compiled, and are not in the baseline:\n');
  for (const file of unexpected) {
    console.error(`  src/${file}`);
    for (const reason of skipsByFile.get(file)) console.error(`      ${reason}`);
  }
  console.error('\nFix the component rather than adding it to BASELINE — see this file’s comment.');
}

if (fixed.length > 0) {
  console.error('\nThese files compile now but are still listed in BASELINE — remove them:\n');
  for (const file of fixed) console.error(`  src/${file}`);
}

if (unexpected.length > 0 || fixed.length > 0) process.exit(1);

if (skipped.length > 0) {
  console.log(`${skipped.length} known file(s) still skipped (in BASELINE).`);
}
