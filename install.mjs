#!/usr/bin/env node
// sy-comet 安装脚本：把 skills/ 下的工作流与依赖 Skill 安装到目标目录。
//
// 用法：
//   node install.mjs --project /path/to/project [--apply]   安装到 <project>/.agents/skills/
//   node install.mjs --global [--apply]                     安装到 ~/.agents/skills/
//   默认 preview（只列出将写入的文件，不落盘）；--apply 才真实写入。
//   --force  覆盖目标目录中内容不一致的同名 Skill（默认拒绝，防止覆盖你的本地修改）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (has('--help') || has('-h')) {
  console.log(`node install.mjs --project <dir> [--apply] [--force]
node install.mjs --global [--apply] [--force]
默认 preview 不写文件；--apply 真实安装；--force 覆盖内容不一致的同名 Skill。`);
  process.exit(0);
}

const projectDir = opt('--project');
const targetRoot = projectDir
  ? path.join(path.resolve(projectDir), '.agents', 'skills')
  : has('--global')
    ? path.join(os.homedir(), '.agents', 'skills')
    : null;
if (!targetRoot) {
  console.error('缺少目标：--project <dir> 或 --global');
  process.exit(1);
}
const apply = has('--apply');
const force = has('--force');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const skills = fs.readdirSync(srcRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcRoot, e.name, 'SKILL.md')))
  .map((e) => e.name);

let copied = 0, skipped = 0;
const conflicts = [];
for (const name of skills) {
  for (const src of walk(path.join(srcRoot, name))) {
    const rel = path.relative(srcRoot, src);
    const dest = path.join(targetRoot, rel);
    if (fs.existsSync(dest)) {
      if (sha(fs.readFileSync(dest)) === sha(fs.readFileSync(src))) { skipped++; continue; }
      if (!force) { conflicts.push(rel); continue; }
    }
    if (apply) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      if (src.endsWith('.mjs') || src.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    }
    copied++;
  }
}

console.log(`${apply ? 'Install' : 'Install preview'} → ${targetRoot}`);
console.log(`skills: ${skills.join(', ')}`);
console.log(`${copied} file(s) ${apply ? 'written' : 'would be written'}, ${skipped} identical skipped.`);
if (conflicts.length) {
  console.log(`conflicts (内容不一致，未覆盖；加 --force 覆盖):`);
  for (const c of conflicts) console.log(`- ${c}`);
}
if (!apply) console.log('No files were written. 加 --apply 真实安装。');
if (conflicts.length) process.exitCode = 1;
