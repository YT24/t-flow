#!/usr/bin/env node
// t-flow 安装/更新脚本：把 skills/ 下的工作流与依赖 Skill 安装到目标目录。
//
// 用法：
//   node install.mjs --project /path/to/project [--apply]   安装到 <project>/.agents/skills/
//   node install.mjs --global [--apply]                     安装到 ~/.agents/skills/
//   node install.mjs --project <dir> --update [--apply]     更新已安装的 t-flow
//   默认 preview（只列出将写入的文件，不落盘）；--apply 才真实写入。
//   --force  覆盖内容不一致的同名 Skill（默认拒绝，防止覆盖你的本地修改）。
//
// 更新语义（--update）：以目标目录的 .t-flow-manifest.json 为基线——
//   目标文件与基线一致 → 视为旧版本，安全覆盖为新版；
//   目标文件与基线不一致 → 视为本地修改，跳过并列为冲突（--force 才覆盖）；
//   基线中存在但新包已删除的文件 → 未修改则清除，修改过则保留并提示。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSION = '2.2.0';
const MANIFEST = '.t-flow-manifest.json';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (has('--help') || has('-h')) {
  console.log(`node install.mjs --project <dir> [--apply] [--force] [--no-link-claude]
node install.mjs --global [--apply] [--force] [--no-link-claude]
node install.mjs --project <dir> --update [--apply] [--force]
默认 preview 不写文件；--apply 真实写入；--update 按安装清单区分旧版本与本地修改；--force 覆盖冲突。
安装后默认在 .claude/skills/（或 ~/.claude/skills/）为每个 Skill 建符号链接，使 Claude Code 与
agent 两条发现路径都能命中；--no-link-claude 可关闭。`);
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
const noLink = has('--no-link-claude');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
    else if (e.isSymbolicLink()) {
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) yield* walk(p);
        else if (st.isFile()) yield p;
      } catch { /* 悬空符号链接跳过 */ }
    }
  }
}

const skills = fs.readdirSync(srcRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcRoot, e.name, 'SKILL.md')))
  .map((e) => e.name);

// UI 设计 Skill：协议声明的主/兜底 Skill 应当随包分发；缺失时提示（ui 节点会尝试自动安装）。
const routingPath = path.join(srcRoot, 't-flow', 'reference', 'workflow-protocol.json');
let missingUiSkills = [];
try {
  const routing = JSON.parse(fs.readFileSync(routingPath, 'utf8')).uiSkillRouting;
  const bundled = new Set(skills);
  for (const name of routing?.distribution || []) {
    if (name && !bundled.has(name)) missingUiSkills.push(name);
  }
} catch { /* 协议缺失时跳过提示 */ }

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
  const vcmp = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  if (oldManifest.version && vcmp(oldManifest.version, VERSION) > 0) {
    console.error(`警告：已安装版本 ${oldManifest.version} 高于本包 ${VERSION}，继续将降级覆盖。`);
  }
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
        continue; // 本地修改不记入清单：后续 --update 仍将其识别为冲突，不会被误当旧版本覆盖
      }
    } else if (!force) {
      conflicts.push(rel);
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
      kept.push(rel); // 本地修改过的已删除文件保留，且不记入清单，避免下次更新被误清理
    }
  }
}

// 清单始终落盘，记录本包实际安装的文件基线，保证后续 --update 有据可依；
// 冲突与保留的本地修改不入清单（见上），不会被后续更新误覆盖或误清理。
if (apply) {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2) + '\n');
}

// Claude Code 从 .claude/skills/ 发现 Skill，agent 从 .agents/skills/ 发现；
// 实体只装一份在 .agents/，在 .claude/ 建符号链接使两条路径都能命中。
// 此前只有 UI 设计 Skill 会被链接，导致 t-flow 入口与各节点 Skill 在 Claude 下不可见。
// targetRoot 形如 <base>/.agents/skills，故同级目录是 <base>/.claude/skills。
const claudeRoot = path.join(path.dirname(path.dirname(targetRoot)), '.claude', 'skills');
let linked = 0, linkSkipped = 0;
if (apply && !noLink) {
  fs.mkdirSync(claudeRoot, { recursive: true });
  for (const name of skills) {
    const src = path.join(targetRoot, name);
    const dst = path.join(claudeRoot, name);
    try {
      if (!fs.existsSync(path.join(src, 'SKILL.md'))) continue;
      // dst 不存在时 lstatSync 会抛错，必须先用 existsSync/lstat 判存，不能靠 catch 兜底。
      let dstExists = false;
      try { dstExists = fs.existsSync(dst) || fs.lstatSync(dst).isSymbolicLink(); } catch { dstExists = false; }
      if (dstExists) { linkSkipped++; continue; }
      fs.symlinkSync(path.relative(claudeRoot, src), dst);
      linked++;
    } catch { linkSkipped++; }
  }
}

console.log(`${update ? 'Update' : 'Install'} ${apply ? '' : 'preview '}→ ${targetRoot} (v${VERSION})`);
console.log(`skills: ${skills.join(', ')}`);
console.log(`${written} file(s) ${apply ? 'written' : 'would be written'}, ${skipped} identical skipped${update ? `, ${pruned} stale pruned` : ''}.`);
if (apply && !noLink) console.log(`Claude 入口: ${linked} 个符号链接建于 ${claudeRoot}${linkSkipped ? `，${linkSkipped} 个已存在（跳过）` : ''}。`);
if (!apply) console.log(`（预览）将在 ${claudeRoot} 为每个 Skill 建符号链接；用 --no-link-claude 关闭。`);
if (conflicts.length) {
  console.log(`conflicts（${update ? '本地已修改，未覆盖' : '内容不一致，未覆盖'}；加 --force 覆盖）:`);
  for (const c of conflicts) console.log(`- ${c}`);
}
if (kept.length) {
  console.log('kept（新包已删除但你本地改过，保留）:');
  for (const k of kept) console.log(`- ${k}`);
}
if (missingUiSkills.length) {
  console.log('警告：协议声明为分发内容的 UI 设计 Skill 未随本包附带，UI 节点将无法自动安装:');
  for (const name of missingUiSkills) console.log(`- ${name}`);
}
if (!apply) console.log('No files were written. 加 --apply 真实执行。');
if (conflicts.length) process.exitCode = 1;
