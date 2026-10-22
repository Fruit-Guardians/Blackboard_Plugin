#!/usr/bin/env node
// Install blackboard's packaged skill (the resolved distribution's
// `skills/blackboard/` tree) into a DSH skill root, so DSH sessions get the same
// curated guidance as Claude Code / Codex:
//
//   <projectRoot>/.dsh/skills/blackboard/   (rank 100, default)
//   <dshHome>/skills/blackboard/            (rank 400, --user)
//
// The tree is copied verbatim, `__BLACKBOARD_CLI__` is expanded to the resolved
// CLI, and a short native-tools preamble is inserted (the packaged skill talks
// about the CLI; in DSH the same operations are tools).
//
// Usage: node install-skill.mjs [--user] [--target <dir>] [--cli <path>] [--home <dir>]

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeSearchPath, resolveBlackboardRoot } from '../lib/blackboard-root.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? null : argv[index + 1] ?? '';
};
const user = argv.includes('--user');

/** The distribution holding the packaged skill (env/installed copy/sibling/PATH). */
function distribution() {
  try {
    return resolveBlackboardRoot();
  } catch {
    return null;
  }
}

function projectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Text files we rewrite: expand the CLI placeholder inside them. */
const TEXT = /\.(md|markdown|ya?ml|txt|json)$/i;

function stripAppleDouble(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('._')) rmSync(full, { recursive: true, force: true });
    else if (entry.isDirectory()) stripAppleDouble(full);
  }
}

const PREAMBLE_MARKER = '在 DeepSeek Harness 中';
const PREAMBLE = `> **${PREAMBLE_MARKER}**：同一块黑板由 \`dsh-plugin-blackboard\` 以原生工具提供
> （\`blackboard_brief\` / \`blackboard_add\` / \`blackboard_edit\` / \`blackboard_link\` / \`blackboard_unlink\` /
> \`blackboard_remove\` / \`blackboard_focus\` / \`blackboard_checkpoint\` / \`blackboard_context\` /
> \`blackboard_show\` / \`blackboard_init\`），优先使用工具；下文的 \`blackboard …\` 命令行是等价回退。

`;

function main() {
  const found = distribution();
  if (!found) {
    throw new Error(`没找到 blackboard 分发，无法定位 skills/blackboard/。\n${describeSearchPath()}`);
  }
  const sourceTree = path.join(found.root, 'skills', 'blackboard');
  if (!existsSync(sourceTree)) {
    throw new Error(`packaged skill not found: ${sourceTree}（分发需包含 skills/blackboard/）`);
  }
  const cli = flag('cli') || found.cliPath || 'blackboard';
  const target = flag('target') || process.cwd();
  const home = flag('home') || os.homedir();
  const skillsRoot = user ? path.join(home, '.dsh', 'skills') : path.join(projectRoot(target), '.dsh', 'skills');
  const dest = path.join(skillsRoot, 'blackboard');

  mkdirSync(dest, { recursive: true });
  cpSync(sourceTree, dest, { recursive: true });

  for (const file of walk(dest)) {
    if (!TEXT.test(file)) continue;
    const original = readFileSync(file, 'utf8');
    let next = original.split('__BLACKBOARD_CLI__').join(cli);
    if (path.basename(file) === 'SKILL.md' && !next.includes(PREAMBLE_MARKER)) {
      // Insert right after the YAML frontmatter, i.e. before the first heading.
      const heading = next.indexOf('\n# ');
      next = heading === -1
        ? `${next}\n${PREAMBLE}`
        : `${next.slice(0, heading + 1)}\n${PREAMBLE}${next.slice(heading + 1)}`;
    }
    if (next !== original) writeFileSync(file, next);
  }
  stripAppleDouble(dest);

  console.log(`已安装 skill → ${path.join(dest, 'SKILL.md')}`);
  console.log(`  范围 ${user ? 'user' : 'project'} · CLI ${cli}`);
  console.log('  DSH 会在新会话的技能目录里发现它；改完无需重启，刷新/新开会话即可。');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

try {
  main();
} catch (error) {
  console.error(`install-skill: ${error.message}`);
  process.exit(1);
}
