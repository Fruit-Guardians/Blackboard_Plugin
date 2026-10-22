// The distribution resolver: the plugin's only link to the blackboard CLI + lib.
//
// Nothing here drives a real board, and nothing depends on where this file is
// installed. The point is the contract that makes the package standalone: it
// finds a distribution by explicit configuration, an installed copy, a sibling
// checkout or PATH — and it never reaches outside its own directory for code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PLUGIN_ROOT, SOURCES, resolveBlackboard, resolveBlackboardRoot,
} from '../lib/blackboard-root.js';
import { FALLBACK_VOCABULARY, loadVocabulary } from '../lib/board-lib.js';
import { buildBoardSnapshot } from '../lib/snapshot.js';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'blackboard-root-'));

/** A distribution stub: only the files the resolver and the loader stat. */
function fakeDistribution() {
  const root = tempDir();
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  mkdirSync(path.join(root, 'lib'), { recursive: true });
  writeFileSync(path.join(root, 'bin', 'blackboard.js'), '#!/usr/bin/env node\n');
  return root;
}

const cliOf = (root) => path.join(root, 'bin', 'blackboard.js');
const nowhere = () => path.join(tempDir(), 'nowhere');

test('a sibling checkout next to the plugin is a distribution (dev layout)', () => {
  // The blackboard repo keeps this plugin in <blackboard>/dsh-plugin, so the
  // parent directory is a distribution. A standalone clone has to be configured.
  const parent = tempDir();
  const plugin = path.join(parent, 'dsh-plugin');
  mkdirSync(path.join(parent, 'bin'), { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(parent, 'bin', 'blackboard.js'), '#!/usr/bin/env node\n');

  const found = resolveBlackboard(undefined, { env: {}, pluginRoot: plugin });
  assert.equal(found.source, SOURCES.SIBLING);
  assert.equal(found.root, parent);
  assert.equal(found.command, process.execPath);
  assert.deepEqual(found.prefix, [path.join(parent, 'bin', 'blackboard.js')]);
});

test('an explicit cliPath wins; a broken one throws instead of falling back', () => {
  const root = fakeDistribution();
  const found = resolveBlackboard(cliOf(root), { env: {} });
  assert.equal(found.source, SOURCES.CONFIG);
  assert.equal(found.root, root);
  assert.deepEqual(found.prefix, [cliOf(root)]);
  assert.throws(() => resolveBlackboard('/nope/blackboard.js', { env: {} }), /cliPath does not exist/);
});

test('BLACKBOARD_CLI and BLACKBOARD_ROOT are honoured, config ahead of both', () => {
  const viaCli = fakeDistribution();
  const viaRoot = fakeDistribution();
  assert.equal(resolveBlackboard(undefined, { env: { BLACKBOARD_CLI: cliOf(viaCli) } }).root, viaCli);
  assert.equal(resolveBlackboard(undefined, { env: { BLACKBOARD_ROOT: viaRoot } }).root, viaRoot);
  const both = resolveBlackboard(cliOf(viaCli), { env: { BLACKBOARD_ROOT: viaRoot } });
  assert.equal(both.root, viaCli);
});

test('a configured but broken environment fails loudly', () => {
  assert.throws(
    () => resolveBlackboard(undefined, { env: { BLACKBOARD_CLI: '/nope/blackboard.js' } }),
    /BLACKBOARD_CLI does not exist/,
  );
  assert.throws(
    () => resolveBlackboard(undefined, { env: { BLACKBOARD_ROOT: tempDir() } }),
    /not a blackboard distribution/,
  );
});

test('an installed copy under node_modules/blackboard is found', () => {
  const plugin = tempDir();
  const installed = path.join(plugin, 'node_modules', 'blackboard');
  mkdirSync(path.join(installed, 'bin'), { recursive: true });
  writeFileSync(path.join(installed, 'bin', 'blackboard.js'), '#!/usr/bin/env node\n');
  const found = resolveBlackboard(undefined, { env: {}, pluginRoot: plugin });
  assert.equal(found.source, SOURCES.NODE_MODULES);
  assert.equal(found.root, installed);
});

test('the project launcher shim on PATH yields the distribution it points at', () => {
  const root = fakeDistribution();
  const bin = tempDir();
  writeFileSync(
    path.join(bin, 'blackboard'),
    `#!/bin/sh\nexec "/usr/bin/node" "${cliOf(root)}" "$@"\n`,
    { mode: 0o755 },
  );
  const found = resolveBlackboard(undefined, { env: { PATH: bin }, pluginRoot: nowhere() });
  assert.equal(found.source, SOURCES.PATH);
  assert.equal(found.root, root);
  assert.equal(found.cliPath, cliOf(root));
});

test('nothing anywhere resolves to null rather than a bogus command', () => {
  const isolated = { env: {}, pluginRoot: nowhere() };
  assert.equal(resolveBlackboard(undefined, isolated), null);
  assert.equal(resolveBlackboardRoot(undefined, isolated), null);
});

test('resolveBlackboardRoot reports the CLI, root and source', () => {
  const root = fakeDistribution();
  const found = resolveBlackboardRoot(cliOf(root), { env: {} });
  assert.deepEqual(Object.keys(found).sort(), ['cliPath', 'root', 'source']);
  assert.equal(found.root, root);
});

test('the vocabulary is imported from the distribution, never vendored', async () => {
  const root = fakeDistribution();
  writeFileSync(
    path.join(root, 'lib', 'model.js'),
    "export const NODE_TYPES = ['probe-type'];\nexport const EDGE_KINDS = ['probe-edge'];\n",
  );
  writeFileSync(path.join(root, 'lib', 'store.js'), 'export const findRoot = () => null;\n');

  const vocabulary = await loadVocabulary(root);
  assert.deepEqual(vocabulary.NODE_TYPES, ['probe-type']);
  assert.deepEqual(vocabulary.EDGE_KINDS, ['probe-edge']);
  // A field the distribution does not export falls back instead of vanishing.
  assert.deepEqual(vocabulary.SEVERITIES, FALLBACK_VOCABULARY.SEVERITIES);
});

test('an unreachable distribution falls back to the frozen vocabulary', async () => {
  const fallback = await loadVocabulary(nowhere());
  assert.deepEqual(fallback.NODE_TYPES, FALLBACK_VOCABULARY.NODE_TYPES);
  assert.deepEqual(fallback.CONFIDENCE_LEVELS, FALLBACK_VOCABULARY.CONFIDENCE_LEVELS);
});

test('a missing distribution fails the snapshot request, never the process', async () => {
  const result = await buildBoardSnapshot(tempDir(), nowhere());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-distribution');
  assert.match(result.message, /blackboard/);
});

test('shipped code never climbs out of the plugin directory for a module', () => {
  // The regression guard for this whole refactor: a `../../lib` import or a
  // parent `../bin/blackboard.js` target would break a standalone install. It
  // has to catch the shapes a regression actually takes, not just the spelling
  // that was removed, so it reads relative literals AND the
  // path.resolve/join('..', ...) chains and fs/`require` calls.
  const offenders = [];

  /**
   * How far each reference in a file travels up from the base it starts at.
   * `base` is the number of levels that base sits below the plugin root: 0 for
   * PLUGIN_ROOT, otherwise the file's own directory.
   */
  const climbEvents = (text, depth) => {
    // Whole-line comments only: an inline `//` can be part of a literal.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const events = [];
    // Relative specifiers, wherever they appear as a literal: `from`, `import(`,
    // `require(`, `import.meta.resolve(...)`, or an fs call taking a path.
    for (const match of code.matchAll(/['"`]((?:\.\.\/)+)([^'"`]*)/g)) {
      events.push({ climb: match[1].length / 3, base: depth, target: match[2] });
    }
    // path.resolve/path.join chains: every standalone '..' segment is one level.
    for (const match of code.matchAll(/path\.(?:resolve|join)\(([^)]*)\)/g)) {
      const args = match[1];
      const dots = (args.match(/['"]\.\.['"]/g) || []).length;
      if (!dots) continue;
      const literals = (args.split(/['"]\.\.['"]/).pop() || '').match(/['"]([^'"]+)['"]/g) || [];
      const base = /PLUGIN_ROOT/.test(args) ? 0 : depth;
      events.push({ climb: dots, base, target: literals.map((part) => part.slice(1, -1)).join('/') });
    }
    return events;
  };

  const check = (full) => {
    if (!/\.(m?js)$/.test(path.basename(full))) return;
    const rel = path.relative(PLUGIN_ROOT, full);
    const dir = path.dirname(rel);
    // A file may climb at most to the plugin root and still be reaching its own
    // code; one level beyond that is the parent checkout.
    const depth = dir === '.' ? 0 : dir.split(path.sep).length;
    const escapes = climbEvents(readFileSync(full, 'utf8'), depth)
      .filter((event) => event.climb > event.base)
      .filter((event) => event.target.startsWith('lib/') || event.target.startsWith('bin/'));
    if (escapes.length) offenders.push(`${rel} -> ${escapes.map((event) => event.target).join(', ')}`);
  };

  const scan = (target) => {
    if (statSync(target).isFile()) {
      check(target);
      return;
    }
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('._')) continue;
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) scan(full);
      else check(full);
    }
  };
  for (const entry of ['index.js', 'lib', 'scripts']) scan(path.join(PLUGIN_ROOT, entry));
  assert.deepEqual(offenders, []);
});
