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
  // parent `../bin/blackboard.js` spawn target would break a standalone install.
  const offenders = [];
  const check = (full) => {
    if (!/\.(m?js)$/.test(path.basename(full))) return;
    const rel = path.relative(PLUGIN_ROOT, full);
    const dir = path.dirname(rel);
    // A file may climb at most as many levels as it sits below the plugin root
    // and still be importing our own code; one level more is the parent checkout.
    const depth = dir === '.' ? 0 : dir.split(path.sep).length;
    const text = readFileSync(full, 'utf8');
    const escapes = [
      new RegExp(`from\\s+['"](?:\\.\\.\\/){${depth + 1},}lib\\/`),
      new RegExp(`import\\(\\s*['"](?:\\.\\.\\/){${depth + 1},}lib\\/`),
      new RegExp(`['"](?:\\.\\.\\/){${depth + 1},}bin\\/blackboard\\.js['"]`),
    ];
    if (escapes.some((pattern) => pattern.test(text))) offenders.push(rel);
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
