#!/usr/bin/env node
// sy-comet 安装/更新脚本：把 skills/ 下的工作流与依赖 Skill 安装到目标目录。
//
// 用法：
//   node install.mjs --project /path/to/project [--apply]   安装到 <project>/.agents/skills/
//   node install.mjs --global [--apply]                     安装到 ~/.agents/skills/
//   node install.mjs --project <dir> --update [--apply]     更新已安装的 sy-comet
//   默认 preview（只列出将写入的文件，不落盘）；--apply 才真实写入。
//   --force  覆盖内容不一致的同名 Skill（默认拒绝，防止覆盖你的本地修改）。
//
// 更新语义（--update）：以目标目录的 .sy-comet-manifest.json 为基线——
//   目标文件与基线一致 → 视为旧版本，安全覆盖为新版；
//   目标文件与基线不一致 → 视为本地修改，跳过并列为冲突（--force 才覆盖）；
//   基线中存在但新包已删除的文件 → 未修改则清除，修改过则保留并提示。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.0';
const MANIFEST = '.sy-comet-manifest.json';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (has('--help') || has('-h')) {
  console.log(`node install.mjs --project <dir> [--apply] [--force]
node install.mjs --global [--apply] [--force]
node install.mjs --project <dir> --update [--apply] [--force]
默认 preview 不写文件；--apply 真实写入；--update 按安装清单区分旧版本与本地修改；--force 覆盖冲突。`);
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
const update = has('--update');

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

// 新包全部文件：相对路径 → 源路径
const pkgFiles = new Map();
for (const name of skills) {
  for (const src of walk(path.join(srcRoot, name))) {
    pkgFiles.set(path.relative(srcRoot, src), src);
  }
}

const manifestPath = path.join(targetRoot, MANIFEST);
let oldManifest = null;
if (update) {
  if (!fs.existsSync(manifestPath)) {
    console.error(`未找到 ${MANIFEST}，无法区分旧版本与本地修改；先用 --apply 安装，或加 --force 全量覆盖。`);
    process.exit(1);
  }
  oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

const newManifest = { version: VERSION, installedAt: new Date().toISOString(), files: {} };
let written = 0, skipped = 0, pruned = 0;
const conflicts = [], kept = [];

for (const [rel, src] of pkgFiles) {
  const dest = path.join(targetRoot, rel);
  const srcHash = sha(fs.readFileSync(src));
  if (fs.existsSync(dest)) {
    const destHash = sha(fs.readFileSync(dest));
    if (destHash === srcHash) { skipped++; newManifest.files[rel] = srcHash; continue; }
    if (update) {
      const base = oldManifest.files[rel];
      if (base && destHash === base) {
        // 旧版本，安全覆盖
      } else if (!force) {
        conflicts.push(rel);
        newManifest.files[rel] = destHash; // 保留本地修改，清单记录现状
        continue;
      }
    } else if (!force) {
      conflicts.push(rel);
      newManifest.files[rel] = destHash;
      continue;
    }
  }
  if (apply) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (src.endsWith('.mjs') || src.endsWith('.sh')) fs.chmodSync(dest, 0o755);
  }
  written++;
  newManifest.files[rel] = srcHash;
}

// 更新时清除新包已删除且未被本地修改的文件
if (update && oldManifest) {
  for (const [rel, oldHash] of Object.entries(oldManifest.files)) {
    if (pkgFiles.has(rel)) continue;
    const dest = path.join(targetRoot, rel);
    if (!fs.existsSync(dest)) continue;
    if (sha(fs.readFileSync(dest)) === oldHash || force) {
      if (apply) fs.rmSync(dest);
      pruned++;
    } else {
      kept.push(rel);
      newManifest.files[rel] = sha(fs.readFileSync(dest));
    }
  }
}

if (apply && !conflicts.length) {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2) + '\n');
}

console.log(`${update ? 'Update' : 'Install'} ${apply ? '' : 'preview '}→ ${targetRoot} (v${VERSION})`);
console.log(`skills: ${skills.join(', ')}`);
console.log(`${written} file(s) ${apply ? 'written' : 'would be written'}, ${skipped} identical skipped${update ? `, ${pruned} stale pruned` : ''}.`);
if (conflicts.length) {
  console.log(`conflicts（${update ? '本地已修改，未覆盖' : '内容不一致，未覆盖'}；加 --force 覆盖）:`);
  for (const c of conflicts) console.log(`- ${c}`);
}
if (kept.length) {
  console.log('kept（新包已删除但你本地改过，保留）:');
  for (const k of kept) console.log(`- ${k}`);
}
if (!apply) console.log('No files were written. 加 --apply 真实执行。');
if (conflicts.length) process.exitCode = 1;
