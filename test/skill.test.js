// The skill installer: copy the repository's packaged skill tree into a DSH
// skill root, expand the CLI placeholder, and stay idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALLER = fileURLToPath(new URL('../scripts/install-skill.mjs', import.meta.url));
const tempDir = () => mkdtempSync(path.join(tmpdir(), 'blackboard-skill-'));
const run = (...args) => execFileSync(process.execPath, [INSTALLER, ...args], { encoding: 'utf8' });

const skillFile = (root) => path.join(root, '.dsh', 'skills', 'blackboard', 'SKILL.md');

test('project install copies the packaged tree, expands the CLI, adds the DSH preamble', () => {
  const dir = tempDir();
  const out = run('--target', dir, '--cli', '/usr/bin/node /repo/bin/blackboard.js');

  assert.match(out, /已安装 skill/);
  const skill = skillFile(dir);
  assert.ok(existsSync(skill), 'SKILL.md installed');
  const body = readFileSync(skill, 'utf8');
  assert.match(body, /^---\nname: blackboard/m);
  assert.match(body, /在 DeepSeek Harness 中/);
  assert.ok(!body.includes('__BLACKBOARD_CLI__'), 'CLI placeholder expanded');

  const recording = path.join(dir, '.dsh', 'skills', 'blackboard', 'references', 'recording.md');
  assert.ok(existsSync(recording), 'references copied');
  assert.ok(!readFileSync(recording, 'utf8').includes('__BLACKBOARD_CLI__'));
});

test('re-running is idempotent and strips AppleDouble companions', () => {
  const dir = tempDir();
  run('--target', dir, '--cli', '/cli/blackboard.js');
  writeFileSync(path.join(dir, '.dsh', 'skills', 'blackboard', '._SKILL.md'), 'junk');
  run('--target', dir, '--cli', '/cli/blackboard.js');

  const body = readFileSync(skillFile(dir), 'utf8');
  assert.equal(body.split('在 DeepSeek Harness 中').length - 1, 1, 'one preamble only');
  assert.ok(!existsSync(path.join(dir, '.dsh', 'skills', 'blackboard', '._SKILL.md')));
});

test('user install lands under <home>/.dsh/skills', () => {
  const home = tempDir();
  run('--user', '--home', home, '--cli', 'blackboard');
  assert.ok(existsSync(path.join(home, '.dsh', 'skills', 'blackboard', 'SKILL.md')));
});
