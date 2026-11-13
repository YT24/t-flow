import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';

function fixture(t) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'sy-workflow-test-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 fs.cpSync(new URL('../skills',import.meta.url),path.join(base,'skills'),{recursive:true});
 const root=path.join(base,'project');fs.mkdirSync(root);
 const run=(...args)=>{const r=spawnSync(process.execPath,[path.join(base,'skills/t-flow/scripts/yt.mjs'),...args],{cwd:root,encoding:'utf8',env:{...process.env,TFLOW_RUN_ROOT:root}});return {code:r.status,out:r.stdout+r.stderr};};
 const ok=(...args)=>{const r=run(...args);assert.equal(r.code,0,r.out);return r;};
 const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));};
 const doc=(p,v,cid='test')=>put(`docs/t-flow/change/${cid}/`+p,v);
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
 const setup=(prd='REQ-01 behavior')=>{ok('init','test');doc('clarify-log.md','scope');ok('approve','clarify','confirmed');ok('advance');for(const p of ['prd.md','spec-delta.md'])doc(p,p==='prd.md'?prd:'content');ok('approve','specify','confirmed');ok('advance');doc('adr.md','content');ok('approve','adr','confirmed');ok('advance');ok('skip','ui','no UI');ok('skip','design','small');ok('approve','skip-design','用户确认跳过设计');doc('plan.md','plan');put('src/a.js','export const a=1;');doc('plan/tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src'],acceptance:['works'],status:'pending'}]);ok('advance');};
 const pass=()=>{ok('run','T-01','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');ok('task','T-01','done');};
 // 走到 ui 节点（不 skip）
 const atUi=()=>{ok('init','test');doc('clarify-log.md','scope');ok('approve','clarify','confirmed');ok('advance');for(const p of ['prd.md','spec-delta.md'])doc(p,p==='prd.md'?'REQ-01 behavior':'content');ok('approve','specify','confirmed');ok('advance');doc('adr.md','content');ok('approve','adr','confirmed');ok('advance');};
 // 合法 ui.md：含 ui-scope 声明块，files/affected 指向真实存在的界面文件
 const uiMd=(scope={})=>{
  const {mode='new',files=['src/App.vue'],affected=[]}=scope;
  put('src/App.vue','export default {};');
  for(const a of affected)put(a,a.endsWith('.css')?'a{}':'export default {};');
  doc('ui.md',['```ui-scope',`mode: ${mode}`,`files: [${files.join(', ')}]`,`affected: [${affected.join(', ')}]`,'```','','prototype'].join('\n'));
 };
 return {base,root,run,ok,put,doc,read,setup,pass,atUi,uiMd};
}

test('check validates artifacts before approval but advance still requires approval',t=>{const f=fixture(t);f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('check');assert.equal(f.run('advance').code,1);});
test('default state output is compact and full status remains available',t=>{
 const f=fixture(t);f.setup();f.pass();
 const out=f.ok('advance').out;
 assert.match(out,/STATE: /);assert.match(out,/NEXT: verify/);assert.doesNotMatch(out,/"history"|"approvals"/);
 const full=JSON.parse(f.ok('status','--json').out);
 assert.equal(full.currentNode,'verify');assert.ok(Array.isArray(full.history));assert.ok(full.approvals.specify);
 const normal=f.ok('status').out;assert.match(normal,/STATE: /);assert.match(normal,/SUMMARY: /);assert.doesNotMatch(normal,/"history"/);
});
test('required artifacts reject assigned secrets without echoing them',t=>{
 const f=fixture(t);f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');f.ok('approve','specify','confirmed');f.ok('advance');f.doc('adr.md','content');f.ok('approve','adr','confirmed');f.ok('advance');f.ok('skip','ui','no UI');f.ok('skip','design','small');f.ok('approve','skip-design','用户确认跳过设计');
 f.put('src/a.js','export const a=1;');f.doc('plan.md','password=supersecret');f.doc('plan/tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src'],acceptance:['works'],status:'pending'}]);
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/疑似凭证不得落盘/);assert.doesNotMatch(r.out,/supersecret/);
});
test('migration rolls changed approved artifacts back for fresh confirmation',t=>{const f=fixture(t);f.setup();f.doc('prd.md','REQ-01 changed');const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'specify');assert.equal(s.approvals.specify,undefined);assert.equal(f.run('advance').code,1);});
for(const flags of [['--expect','['],['--timeout','Infinity'],['--min-output','Infinity']])test('invalid flags rejected before execution: '+flags.join(' '),t=>{const f=fixture(t);f.setup();assert.equal(f.run('run','T-01',...flags,'--',process.execPath,'-e','require("fs").writeFileSync("side-effect","yes")').code,1);assert.equal(fs.existsSync(path.join(f.root,'side-effect')),false);});
test('unchanged migration retains approvals and current node',t=>{const f=fixture(t);f.setup();const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'execute');assert.equal(s.approvals.specify.quote,'confirmed');f.ok('doctor');});
test('execute run rejects an id that is not a declared task',t=>{
 const f=fixture(t);f.setup();
 const ghost=f.run('run','GHOST','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.equal(ghost.code,1);assert.match(ghost.out,/未找到任务 GHOST/);
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test/evidence/GHOST.json')),false);
});
test('ui-routing reports the primary and fallback skills as available',t=>{
 const f=fixture(t);const r=f.run('ui-routing');
 assert.equal(r.code,0,r.out);
 assert.match(r.out,/主 Skill: ui-ux-pro-max（可用）/);
 assert.match(r.out,/兜底: frontend-design（可用）/);
});
test('ensure-skills installs both skills into the project and links .claude/skills',t=>{
 const f=fixture(t);
 const r=f.run('ensure-skills');assert.equal(r.code,0,r.out);
 assert.match(r.out,/已自动安装/);
 for(const name of ['ui-ux-pro-max','frontend-design']){
  assert.ok(fs.existsSync(path.join(f.root,'.agents','skills',name,'SKILL.md')),name+' 应装到 .agents/skills');
  const link=path.join(f.root,'.claude','skills',name);
  assert.ok(fs.existsSync(link),name+' 应有 .claude 链接');
  assert.ok(fs.lstatSync(link).isSymbolicLink(),name+' 的 .claude 条目应是符号链接');
 }
 // 幂等：再跑一次不重复安装
 const again=f.run('ensure-skills');assert.equal(again.code,0,again.out);
 assert.match(again.out,/已就位于/);
});
test('ensure-skills does not copy python caches',t=>{
 const f=fixture(t);f.ok('ensure-skills');
 const pyc=spawnSync('find',[path.join(f.root,'.agents','skills'),'-name','__pycache__']).stdout.toString().trim();
 assert.equal(pyc,'','不应包含 __pycache__');
});
test('ui-use records an explicitly selected primary skill',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const r=f.run('ui-use','ui-ux-pro-max');assert.equal(r.code,0,r.out);
 assert.match(r.out,/USED: ui-ux-pro-max（主 Skill）/);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').uiSkill.used,'ui-ux-pro-max');
});
test('ui-use with the fallback warns but is allowed',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const r=f.run('ui-use','frontend-design');assert.equal(r.code,0,r.out);
 assert.match(r.out,/兜底 Skill/);assert.match(r.out,/WARN/);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').uiSkill.used,'frontend-design');
});
test('ui-use rejects an unrelated skill name and non-ui nodes',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const bad=f.run('ui-use','some-other-skill');assert.equal(bad.code,1);assert.match(bad.out,/须为 ui-ux-pro-max 或 frontend-design/);
 const g=fixture(t);g.ok('init','test');
 assert.equal(g.run('ui-use').code,1);
});
test('doctor flags ui.md without a recorded skill once past ui',t=>{
 const f=fixture(t);f.atUi();f.uiMd();f.ok('ui-use','ui-ux-pro-max');
 f.ok('approve','ui','confirmed');f.ok('advance');
 const legacy=f.read('.t-flow/runs/t-flow/test/state.json');delete legacy.uiSkill;f.put('.t-flow/runs/t-flow/test/state.json',legacy);
 const r=f.run('doctor');assert.equal(r.code,1);assert.match(r.out,/未记录所用设计 Skill/);
});
test('doctor stays OK when the skill is recorded or ui was skipped',t=>{
 const rec=fixture(t);rec.atUi();rec.ok('ensure-skills');rec.ok('ui-use','ui-ux-pro-max');rec.uiMd();rec.ok('approve','ui','confirmed');rec.ok('advance');rec.ok('doctor');
 const skipped=fixture(t);skipped.setup();skipped.ok('doctor');
});
test('doctor reports a missing bundled skill as a distribution fault',t=>{
 const f=fixture(t);
 fs.rmSync(path.join(f.base,'skills','ui-ux-pro-max'),{recursive:true,force:true});
 const r=f.run('doctor');assert.equal(r.code,1);
 assert.match(r.out,/声明为分发内容但本包缺失: ui-ux-pro-max/);
});

// —— 存量项目 UI 变更 ——
test('ui.md requires a ui-scope block and rejects malformed declarations',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');
 f.doc('ui.md','no scope block here');
 assert.match(f.run('check').out,/缺少 ```ui-scope 声明块/);
 f.doc('ui.md','```ui-scope\nmode: bogus\nfiles: [src/App.vue]\n```');
 assert.match(f.run('check').out,/mode 必须是 new 或 change/);
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: []\n```');
 assert.match(f.run('check').out,/files 不能为空/);
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: [../outside.vue]\n```');
 assert.match(f.run('check').out,/路径必须在项目内/);
});
test('change mode must declare affected existing interfaces',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd({mode:'change',files:['src/App.vue'],affected:[]});
 assert.match(f.run('check').out,/必须用 affected 列出受影响的既有界面/);
 f.uiMd({mode:'change',files:['src/App.vue'],affected:['src/pages/Old.vue']});
 assert.equal(f.run('check').code,0);
});
function installerFixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'t-flow-inst-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 fs.cpSync(new URL('../skills',import.meta.url),path.join(base,'skills'),{recursive:true});
 fs.copyFileSync(new URL('../install.mjs',import.meta.url),path.join(base,'install.mjs'));
 const proj=path.join(base,'p');fs.mkdirSync(proj);
 const install=(...extra)=>spawnSync(process.execPath,[path.join(base,'install.mjs'),'--project',proj,...extra],{encoding:'utf8'});
 return {base,proj,install};
}
test('install links every bundled skill into .claude/skills',t=>{
 const {proj,install}=installerFixture(t);
 const r=install('--apply');assert.equal(r.status,0,r.stdout+r.stderr);
 const agentDir=path.join(proj,'.agents','skills'), claudeDir=path.join(proj,'.claude','skills');
 const names=fs.readdirSync(agentDir).filter(n=>fs.existsSync(path.join(agentDir,n,'SKILL.md')));
 assert.ok(names.length>0,'应至少装一个 Skill');
 for(const n of names){
  const link=path.join(claudeDir,n);
  assert.ok(fs.existsSync(link),n+' 应有 .claude 入口（否则 Claude 看不到）');
  assert.ok(fs.lstatSync(link).isSymbolicLink(),n+' 的 .claude 条目应是符号链接');
 }
 // t-flow 入口、节点与独立命令 Skill 都必须在其中
 for(const n of ['t-flow','t-flow-clarify','t-flow-verify','t-flow-fix'])assert.ok(fs.existsSync(path.join(claudeDir,n)),n+' 应有 .claude 入口');
 assert.equal(fs.existsSync(path.join(agentDir,'t-flow-fix','templates','fix-log.md')),false,'不再分发修复日志模板');
});
test('t-flow-fix is explicit, change scoped and outside the standard workflow',()=>{
 const skill=fs.readFileSync(new URL('../skills/t-flow-fix/SKILL.md',import.meta.url),'utf8');
 for(const phrase of ['/t-flow-fix <change-id> <问题描述>','普通修复请求不自动启用','不推进工作流状态机','不追加 fix-log.md','不直接编辑 `.t-flow/runs/`','不修改 `docs/t-flow/archive/`','同一 change 锁'])assert.ok(skill.includes(phrase),'t-flow-fix missing: '+phrase);
 const readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
 assert.ok(readme.includes('/t-flow-fix <change-id> <问题描述>'));
 assert.ok(readme.includes('普通“修复”请求不会自动启用此命令'));
});
test('--no-link-claude skips creating .claude entries',t=>{
 const {proj,install}=installerFixture(t);
 const r=install('--apply','--no-link-claude');assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(fs.existsSync(path.join(proj,'.claude')),false,'--no-link-claude 不应创建 .claude');
});
test('re-running install is idempotent for the claude links',t=>{
 const {proj,install}=installerFixture(t);
 install('--apply');install('--apply');
 const claudeDir=path.join(proj,'.claude','skills');
 const agentDir=path.join(proj,'.agents','skills');
 const names=fs.readdirSync(agentDir).filter(n=>fs.existsSync(path.join(agentDir,n,'SKILL.md')));
 for(const n of names)assert.ok(fs.lstatSync(path.join(claudeDir,n)).isSymbolicLink(),n+' 应仍是符号链接');
});
test('doctor reports a t-flow skill missing its .claude entry',t=>{
 const f=fixture(t);f.ok('ensure-skills');
 // 造出「.agents 有 t-flow 实体、.claude 无入口」
 const agentDir=path.join(f.root,'.agents','skills','t-flow-verify');
 fs.mkdirSync(agentDir,{recursive:true});fs.writeFileSync(path.join(agentDir,'SKILL.md'),'x');
 const r=f.run('doctor');assert.equal(r.code,1);assert.match(r.out,/Claude 入口缺失: .*t-flow-verify/);
});
test('doctor ignores unrelated third-party skills lacking a .claude entry',t=>{
 const f=fixture(t);
 // 与本工作流无关的 Skill 缺少 .claude 入口时不应报错（doctor 只管自己的 Skill）
 const other=path.join(f.root,'.agents','skills','some-other-skill');
 fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'SKILL.md'),'x');
 const r=f.run('doctor');assert.doesNotMatch(r.out,/some-other-skill/);
});


test('multiple changes have isolated documents and require explicit selection',t=>{
 const f=fixture(t);f.ok('init','first');
 f.doc('clarify-log.md','first scope','first');
 f.ok('init','second');
 f.doc('clarify-log.md','second scope','second');
 fs.rmSync(path.join(f.root,'.t-flow/runs/t-flow/active'));
 // 两个未聚焦变更时必须显式选择（use/--change），不能默认作用于某一个
 assert.equal(f.run('approve','clarify','confirmed').code,1);
 f.ok('--change','first','approve','clarify','first approved');
 assert.equal(f.read('.t-flow/runs/t-flow/first/state.json').approvals.clarify.quote,'first approved');
 assert.deepEqual(f.read('.t-flow/runs/t-flow/second/state.json').approvals,{});
 assert.match(f.ok('list').out,/first/);assert.match(f.ok('list').out,/second/);
 assert.equal(f.run('init','first').code,1);
 assert.equal(f.run('--change','../escape','status').code,1);
});

test('legacy flat documents are preserved until explicit layout migration',t=>{
 const f=fixture(t);f.ok('init','test');f.doc('clarify-log.md','legacy scope');
 const state=f.read('.t-flow/runs/t-flow/test/state.json');
 fs.rmSync(path.join(f.root,'.t-flow/runs/t-flow/test'),{recursive:true});
 f.put('.t-flow/runs/t-flow/state.json',state);
 fs.mkdirSync(path.join(f.root,'docs/t-flow/current'));
 fs.renameSync(path.join(f.root,'docs/t-flow/change/test/clarify-log.md'),path.join(f.root,'docs/t-flow/current/clarify-log.md'));
 fs.rmdirSync(path.join(f.root,'docs/t-flow/change/test'));
 assert.equal(f.run('init','second').code,1);
 f.ok('migrate');
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/clarify-log.md'),'utf8'),'legacy scope');
 f.ok('init','second');f.ok('--change','test','check');
});


test('resume selects a change and progress includes skipped stages',t=>{
 const f=fixture(t);f.setup();f.ok('init','other');
 assert.match(f.ok('resume','test').out,/NEXT: execute/);
 assert.match(f.ok('list').out,/test.*execute.*6\/9/);
});
test('doctor finds states whose document directory is missing',t=>{
 const f=fixture(t);f.ok('init','test');fs.rmSync(path.join(f.root,'docs/t-flow/change/test'),{recursive:true});
 assert.equal(f.run('doctor').code,1);
});
test('use rejects traversal and corrupted state cannot redirect writes',t=>{
 const f=fixture(t);f.ok('init','test');
 assert.equal(f.run('use','../test').code,1);
 const s=f.read('.t-flow/runs/t-flow/test/state.json');s.changeId='other';f.put('.t-flow/runs/t-flow/test/state.json',s);
 assert.equal(f.run('--change','test','decide','continue').code,1);
 assert.equal(fs.existsSync(path.join(f.root,'.t-flow/runs/t-flow/other/state.json')),false);
});

test('commands honor TFLOW_RUN_ROOT when cwd differs',t=>{
 const f=fixture(t);f.ok('init','test');fs.rmSync(path.join(f.root,'.t-flow/runs/t-flow/active'));
 for(const args of [['list'],['status'],['doctor']]){
  const r=spawnSync(process.execPath,[path.join(f.base,'skills/t-flow/scripts/yt.mjs'),...args],{cwd:f.base,encoding:'utf8',env:{...process.env,TFLOW_RUN_ROOT:f.root}});
  assert.equal(r.status,0,r.stdout+r.stderr);if(args[0]!=='doctor')assert.match(r.stdout,/test/);
 }
});
test('failed resume leaves the active pointer unchanged',t=>{
 const f=fixture(t);f.ok('init','first');f.ok('init','second');
 const s=f.read('.t-flow/runs/t-flow/first/state.json');s.protocolHash='old';f.put('.t-flow/runs/t-flow/first/state.json',s);
 assert.equal(f.run('resume','first').code,1);
 assert.equal(fs.readFileSync(path.join(f.root,'.t-flow/runs/t-flow/active'),'utf8').trim(),'second');
});

for(const phase of ['documents moved','state saved'])test('legacy migration resumes after '+phase,t=>{
 const f=fixture(t);f.atUi();
 const original=f.read('.t-flow/runs/t-flow/test/state.json');
 f.put('.t-flow/runs/t-flow/state.json',original);
 if(phase==='documents moved'){
  fs.rmSync(path.join(f.root,'.t-flow/runs/t-flow/test'),{recursive:true});
  f.doc('legacy-workflow-state.json',original);
 }else{
  // 模拟新状态已落盘、旧状态还未改名留存时中断。
  f.doc('legacy-workflow-state.json',original);
  const migrated={...original,currentNode:'clarify',completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0,history:[...original.history,{action:'migrate layout',at:new Date().toISOString()}]};
  f.put('.t-flow/runs/t-flow/test/state.json',migrated);
 }
 f.ok('migrate');
 const migrated=f.read('.t-flow/runs/t-flow/test/state.json');
 assert.equal(migrated.currentNode,'clarify');assert.deepEqual(migrated.approvals,{});
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/prd.md'),'utf8'),'REQ-01 behavior');
 assert.equal(fs.existsSync(path.join(f.root,'.t-flow/runs/t-flow/state.json')),false);
 f.ok('--change','test','status');
});
test('legacy migration refuses an unrelated existing change directory',t=>{
 const f=fixture(t);f.ok('init','test');
 const state=f.read('.t-flow/runs/t-flow/test/state.json');
 fs.rmSync(path.join(f.root,'.t-flow/runs/t-flow/test'),{recursive:true});
 f.put('.t-flow/runs/t-flow/state.json',state);f.doc('clarify-log.md','unrelated');
 assert.equal(f.run('migrate').code,1);
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/clarify-log.md'),'utf8'),'unrelated');
});


test('doctor checks UI records for an unfocused change',t=>{
 const f=fixture(t);f.atUi();f.uiMd();f.ok('ui-use','ui-ux-pro-max');f.ok('approve','ui','confirmed');f.ok('advance');
 const legacy=f.read('.t-flow/runs/t-flow/test/state.json');delete legacy.uiSkill;f.put('.t-flow/runs/t-flow/test/state.json',legacy);f.ok('init','other');
 const r=f.run('doctor');assert.equal(r.code,1);assert.match(r.out,/未记录所用设计 Skill/);
 f.ok('--change','other','doctor');
});

test('entering and resuming UI shows skip and skill choices until selected',t=>{
 const f=fixture(t);f.atUi();
 for(const r of [f.ok('status'),f.ok('resume','test')]){
  assert.match(r.out,/UI_CHOICE/);assert.match(r.out,/跳过 UI/);assert.match(r.out,/ui-ux-pro-max/);assert.match(r.out,/frontend-design/);
 }
 assert.equal(f.run('ui-use').code,1);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').uiSkill,undefined);
 f.ok('ui-use','frontend-design');assert.doesNotMatch(f.ok('status').out,/UI_CHOICE/);
 f.ok('reopen','specify');assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').uiSkill,undefined);
});
test('UI cannot be approved before explicit skill selection',t=>{
 const f=fixture(t);f.atUi();f.uiMd();
 assert.equal(f.run('approve','ui','confirmed').code,1);
 f.ok('ui-use','ui-ux-pro-max');f.ok('approve','ui','confirmed');f.ok('advance');
});
test('skipping UI clears a previous skill selection and produces no UI artifact',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.ok('skip','ui','用户选择跳过');
 const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'design');assert.equal(s.uiSkill,undefined);
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test/ui.md')),false);
});

function acceptanceFixture(t){
 const f=fixture(t);f.setup('REQ-01 behavior\nAC-01-1: first behavior\nAC-01-2: second behavior');f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');f.doc('test-report.md','report');
 const result={changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',method:'unit',acceptance:['AC-01-1']}]};
 return {f,result};
}
test('requirement coverage cannot substitute for individual acceptance coverage',t=>{
 const {f,result}=acceptanceFixture(t);f.doc('verify/test-results.json',result);
 assert.match(f.run('check').out,/验收标准.*AC-01-2/);
 result.tests[0].acceptance.push('AC-01-2');f.doc('verify/test-results.json',result);f.ok('check');
});
test('browser verification is opt-in and batches related AC in one session',()=>{
 const verify=fs.readFileSync(new URL('../skills/t-flow/reference/e2e.md',import.meta.url),'utf8');
 for(const phrase of ['不主动新增 E2E','共用一个 Playwright 套件和浏览器会话','不为每条 AC 单独写脚本','截图只在失败定位'])assert.ok(verify.includes(phrase),'verify missing: '+phrase);
 const ui=fs.readFileSync(new URL('../skills/t-flow-ui/SKILL.md',import.meta.url),'utf8');
 for(const phrase of ['不逐状态启动浏览器','共用一次浏览器会话批量验证'])assert.ok(ui.includes(phrase),'ui missing: '+phrase);
});
test('small changes select affected tests instead of full regression by default',()=>{
 const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
 for(const phrase of ['影响范围映射','最小验证命令','不得触发全量测试'])assert.ok(read('skills/t-flow-plan/SKILL.md').includes(phrase),'plan missing: '+phrase);
 for(const phrase of ['仅运行受影响套件','只保留逐条 AC 的实际结果'])assert.ok(read('skills/t-flow-verify/SKILL.md').includes(phrase),'verify missing: '+phrase);
 for(const phrase of ['失败或未测原因','不附命令、日志或证据引用'])assert.ok(read('skills/t-flow/templates/test-report.md').includes(phrase),'report template missing: '+phrase);
});
test('optional unexecuted acceptance and unknown acceptance ids cannot satisfy coverage',t=>{
 const {f,result}=acceptanceFixture(t);
 result.tests.push({id:'manual',required:false,status:'not_run',method:'manual',acceptance:['AC-01-2']});f.doc('verify/test-results.json',result);
 assert.equal(f.run('check').code,1);
 result.tests[0].acceptance.push('AC-99-1');f.doc('verify/test-results.json',result);assert.match(f.run('check').out,/未知验收标准.*AC-99-1/);
});
test('duplicate test ids cannot inflate a verification report',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');result.tests.push({...result.tests[0]});f.doc('verify/test-results.json',result);
 assert.match(f.run('check').out,/用例 ID 重复/);
});
test('reviewed prototypes participate in UI approval fingerprints',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd();
 f.doc('prototype.html','<html>approved prototype</html>');
 const ui=fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/ui.md'),'utf8').replace('mode: new','mode: new\nprototypes: [docs/t-flow/change/test/prototype.html]');f.doc('ui.md',ui);
 f.ok('approve','ui','confirmed');f.doc('prototype.html','<html>changed prototype</html>');
 assert.equal(f.run('advance').code,1);
 f.doc('prototype.html','<html>approved prototype</html>');f.ok('advance');
});
test('reviewed prototypes must be real files in the selected change',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd();
 const ui=fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/ui.md'),'utf8').replace('mode: new','mode: new\nprototypes: [docs/t-flow/change/other/prototype.html]');f.doc('ui.md',ui);f.put('docs/t-flow/change/other/prototype.html','other');
 assert.match(f.run('check').out,/原型.*本 change/);
});

test('nested bash commands also preserve failing pipeline status',t=>{
 const f=fixture(t);f.setup();
 const r=f.run('run','T-01','--expect','PASS','--','bash','-c',"bash -c 'false | cat; echo PASS'");assert.equal(r.code,1);
});


test('acceptance results do not require method or evidence references',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');delete result.tests[0].method;f.doc('verify/test-results.json',result);
 f.ok('check');
});

test('explicit E2E UI acceptance cases remain recordable',t=>{
 const {f,result}=acceptanceFixture(t);
 result.tests[0].acceptance.push('AC-01-2');result.tests[0].method='e2e';f.doc('verify/test-results.json',result);f.ok('check');
});

test('status all reports stage progress and waiting approval without changing active',t=>{
 const f=fixture(t);f.setup();f.ok('init','other');f.doc('clarify-log.md','scope','other');
 const result=f.ok('status','--all','--json');const rows=JSON.parse(result.out);
 assert.equal(rows.find(r=>r.changeId==='test').stage,'execute');
 assert.equal(rows.find(r=>r.changeId==='test').stageProgress.done,0);
 assert.equal(rows.find(r=>r.changeId==='test').stageProgress.total,1);
 assert.equal(rows.find(r=>r.changeId==='other').status,'waiting_approval');
 assert.equal(fs.readFileSync(path.join(f.root,'.t-flow/runs/t-flow/active'),'utf8').trim(),'other');
});
test('change lock rejects concurrent mutations but permits reads and other changes',t=>{
 const f=fixture(t);f.setup();f.put('.t-flow/runs/t-flow/test/write.lock',{pid:process.pid,host:os.hostname()});
 assert.equal(f.run('--change','test','task','T-01','in_progress').code,1);
 f.ok('--change','test','status');f.ok('init','other');
});

function archiveFixture(t){
 const f=fixture(t),pp=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json');
 const proto=JSON.parse(fs.readFileSync(pp));proto.config.specSyncRequired=false;fs.writeFileSync(pp,JSON.stringify(proto));
 f.setup();f.pass();f.ok('advance');f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.doc('test-report.md','report');f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed'}]});f.ok('advance');f.doc('archive-report.md','accepted');f.ok('approve','archive','accepted');return f;
}
for(const point of ['copy','publish','state'])test('archive resumes interruption after '+point,t=>{
 const f=archiveFixture(t),hook=path.join(f.base,'interrupt.cjs');
 fs.writeFileSync(hook,`const fs=require('fs'),sep=require('path').sep;const orig=fs.${point==='copy'?'cpSync':'renameSync'};fs.${point==='copy'?'cpSync':'renameSync'}=function(a,b,...rest){const result=orig.call(this,a,b,...rest);if(${point==='copy'?"String(b).includes('archive')":point==='publish'?"String(b).endsWith(sep+'archive'+sep+'test')":"String(b).endsWith(sep+'test'+sep+'state.json') && JSON.parse(fs.readFileSync(b)).currentNode===null"})throw Error('simulated interruption');return result;};`);
 const r=spawnSync(process.execPath,['--require',hook,path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'archive'],{cwd:f.root,encoding:'utf8',env:{...process.env,TFLOW_RUN_ROOT:f.root}});
 assert.equal(r.status,1);assert.match(r.stderr,/simulated interruption/);
 f.ok('archive');assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,null);
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test')),false);
 assert.equal(f.read('docs/t-flow/archive/test/workflow-state.json').currentNode,null);
 f.ok('--change','test','archive'); // 已完成的归档重试不产生重复记录
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').history.filter(h=>h.action==='archive').length,1);
});

test('real overlapping commands cannot overwrite a running change',async t=>{
 const f=fixture(t);f.setup();
 const child=spawn(process.execPath,[path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'--change','test','run','T-01','--',process.execPath,'-e','require("fs").writeFileSync("started","yes");setTimeout(()=>console.log("PASS"),1500)'],{cwd:f.root,env:{...process.env,TFLOW_RUN_ROOT:f.root},stdio:'ignore'});
 const completed=new Promise(resolve=>child.on('exit',resolve));
 try{
  const deadline=Date.now()+5000;
  while(!fs.existsSync(path.join(f.root,'started'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(fs.existsSync(path.join(f.root,'started')));
  assert.equal(f.run('--change','test','reopen','plan').code,1);
  const rows=JSON.parse(f.ok('status','--all','--json').out);assert.equal(rows[0].status,'running');
  f.ok('init','other');assert.equal(await completed,0);
  assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,'execute');
  f.ok('--change','test','task','T-01','done');
 }finally{await completed;}
});
test('archive recovery preserves changed source instead of deleting it',t=>{
 const f=archiveFixture(t),hook=path.join(f.base,'interrupt.cjs');
 fs.writeFileSync(hook,`const fs=require('fs'),orig=fs.cpSync;fs.cpSync=function(...args){orig(...args);throw Error('interrupt');};`);
 const r=spawnSync(process.execPath,['--require',hook,path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'archive'],{cwd:f.root,env:{...process.env,TFLOW_RUN_ROOT:f.root}});assert.equal(r.status,1);
 f.doc('extra.txt','new content');assert.equal(f.run('archive').code,1);
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/extra.txt'),'utf8'),'new content');
 assert.equal(f.run('reopen','plan').code,1);
});

test('archive resumes cleanup interrupted after source removal',t=>{
 const f=archiveFixture(t),hook=path.join(f.base,'interrupt.cjs');
 fs.writeFileSync(hook,`const fs=require('fs'),sep=require('path').sep,orig=fs.rmSync;fs.rmSync=function(p,...args){const result=orig(p,...args);if(String(p).endsWith(sep+'change'+sep+'test'))throw Error('cleanup interrupted');return result;};`);
 const r=spawnSync(process.execPath,['--require',hook,path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'archive'],{cwd:f.root,env:{...process.env,TFLOW_RUN_ROOT:f.root}});assert.equal(r.status,1);
 assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'archive_pending');
 f.ok('--change','test','archive');assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'archived');
 assert.equal(fs.existsSync(path.join(f.root,'.t-flow/runs/t-flow/test/archive-pending.json')),false);
});
test('change root keeps only stage Markdown and controlled directories',t=>{
 const f=archiveFixture(t);f.doc('manual-acceptance.md','manual checks');
 const r=f.ok('check');assert.doesNotMatch(r.out,/WARN: change 目录/);
 const root=path.join(f.root,'docs/t-flow/change/test');
 for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile())assert.ok(e.name.endsWith('.md'),'根目录不应包含非 Markdown 文件: '+e.name);
 for(const p of ['plan/tasks.json','verify/test-results.json'])assert.ok(fs.existsSync(path.join(root,p)),p+' 应位于阶段子目录');
});
test('uncontrolled change files warn without blocking or deleting history',t=>{
 const f=archiveFixture(t);
 f.doc('browser-query.js','console.log("query")');
 f.doc('screenshots/review.png','image');
 f.doc('evidence/helper-note.txt','controlled evidence note');
 const r=f.ok('check');
 assert.match(r.out,/未受控文件/);assert.match(r.out,/browser-query\.js/);
 assert.doesNotMatch(r.out,/screenshots\/review\.png/);assert.doesNotMatch(r.out,/evidence\/helper-note\.txt/);
 const a=f.ok('archive');assert.match(a.out,/browser-query\.js/);
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/archive/test/browser-query.js'),'utf8'),'console.log("query")');
});
test('status distinguishes an abandoned lock from a running command',t=>{
 const f=fixture(t);f.setup();f.put('.t-flow/runs/t-flow/test/write.lock',{pid:2147483647,host:os.hostname()});
 assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'locked');
 assert.equal(f.run('reopen','plan').code,1);
});

function liteFixture(t){
 const f=fixture(t);f.ok('init','test','--lite','local copy fix; no contracts changed');
 f.doc('prd.md','REQ-01 AC-01-1 fix');f.ok('approve','specify','confirmed');f.ok('advance');
 f.doc('plan.md','AC-01-1 -> src -> test');f.put('src/a.js','source');
 f.doc('plan/tasks.json',[{id:'T-01',title:'fix',dependsOn:[],modules:['src/a.js'],acceptance:['AC-01-1'],status:'pending'}]);f.ok('advance');return f;
}

test('lite mode promotion preserves work but requires full scope confirmation',t=>{
 const f=liteFixture(t);f.pass();f.ok('promote','new permission rules');const state=f.read('.t-flow/runs/t-flow/test/state.json');
 assert.equal(state.profile,'full');assert.equal(state.currentNode,'clarify');assert.deepEqual(state.approvals,{});assert.equal(f.run('advance').code,1);
 assert.equal(f.read('docs/t-flow/change/test/plan/tasks.json')[0].status,'done');
 assert.equal(f.run('reopen','verify').code,1);
});

test('mixed full and lite summaries and migration retain independent profiles',t=>{
 const f=liteFixture(t);f.ok('init','full');
 const rows=JSON.parse(f.ok('changes','--json').out);assert.equal(rows.find(r=>r.changeId==='test').progress.total,5);assert.equal(rows.find(r=>r.changeId==='full').progress.total,9);
 const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json'),proto=JSON.parse(fs.readFileSync(p));proto.comment+=' update';fs.writeFileSync(p,JSON.stringify(proto));
 f.ok('--change','test','migrate');const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'execute');assert.equal(s.profile,'lite');
 f.ok('--change','full','migrate');assert.equal(f.read('.t-flow/runs/t-flow/full/state.json').currentNode,'clarify');
});

test('run summary reports wrapper assertions and elapsed time without pretending to count tests',t=>{
 const f=fixture(t);f.setup();const r=f.ok('run','T-01','--expect','PASS','--reject','FAIL','--',process.execPath,'-e','console.log("PASS")');
 const summary=JSON.parse(r.out.split('\n').find(l=>l.startsWith('SUMMARY: ')).slice(9));assert.equal(summary.assertions.passed,2);assert.equal(summary.exitCode,0);assert.ok(summary.durationMs>=0);assert.equal(summary.tests,undefined);
});

test('runs return results without creating logs evidence or attempts even on failure and retry',t=>{
 const f=fixture(t);f.setup();
 const before=fs.readdirSync(path.join(f.root,'docs/t-flow/change/test')).sort();
 for(const exit of [0,1,0]){
  const r=f.run('run','T-01','--',process.execPath,'-e',`console.log('actual test output');process.exit(${exit})`);
  assert.equal(r.code,exit);assert.match(r.out,new RegExp('STATUS: '+(exit?'failed':'passed')));
  assert.doesNotMatch(r.out,/EVIDENCE:|LOG:|runId/);
  if(!exit)assert.doesNotMatch(r.out,/actual test output/);else assert.match(r.out,/FAILURE_DETAIL:[\s\S]*actual test output/);
 }
 assert.deepEqual(fs.readdirSync(path.join(f.root,'docs/t-flow/change/test')).sort(),before);
 f.ok('task','T-01','done');assert.equal(f.read('docs/t-flow/change/test/plan/tasks.json')[0].evidence,undefined);f.ok('advance');
});

test('sensitive output is blocked without being printed or written',t=>{
 const f=fixture(t);f.setup();const r=f.run('run','T-01','--',process.execPath,'-e','console.log(["pass","word"].join("")+"="+["super","secret"].join(""))');
 assert.equal(r.code,1);assert.match(r.out,/SECRET_OUTPUT_BLOCKED/);assert.doesNotMatch(r.out,/supersecret/);
 for(const dir of ['logs','evidence','attempts'])assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test',dir)),false);
});

test('clarification PRD ADR and design each require their own current-stage approval',t=>{
 const f=fixture(t);f.ok('init','test');f.doc('clarify-log.md','scope');
 assert.equal(f.run('approve','scope','approved all').code,1);
 for(const [stage,docs] of [['clarify',[]],['specify',['prd.md','spec-delta.md']],['adr',['adr.md']],['design',['design.md']]]){
  if(stage==='design')f.ok('skip','ui','no interface');
  for(const doc of docs)f.doc(doc,doc==='prd.md'?'REQ-01 AC-01-1 behavior':'content');
  assert.match(f.ok('check').out,/ARTIFACTS_READY/);assert.equal(f.run('advance').code,1);
  assert.equal(f.run('approve','archive','premature approval').code,1);
  f.ok('approve',stage,'reviewed '+stage);f.ok('advance');
 }
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,'plan');
});

for(const status of ['failed','not_run'])test('result-only reports block required '+status,t=>{
 const f=fixture(t);f.setup('REQ-01 AC-01-1');f.pass();f.ok('advance');f.doc('test-report.md',status);
 const result={changeId:'test',tests:[{id:'REQ-01',required:true,status,acceptance:['AC-01-1']}]};
 f.doc('verify/test-results.json',result);assert.equal(f.run('advance').code,1);
 result.tests[0].status='passed';f.doc('verify/test-results.json',result);f.ok('run','REQ-01','--',process.execPath,'-e','console.log("PASS")');f.ok('advance');
});

test('lite workflow archives using only results and two user approvals',t=>{
 const f=liteFixture(t);f.pass();f.ok('advance');f.doc('test-report.md','AC-01-1 passed');
 f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',acceptance:['AC-01-1']}]});
 f.ok('advance');f.doc('archive-report.md','accepted');assert.equal(f.run('archive').code,1);f.ok('approve','archive','accepted');f.ok('archive');f.ok('doctor');
 assert.deepEqual(Object.keys(f.read('.t-flow/runs/t-flow/test/state.json').approvals),['specify','archive']);
 for(const p of ['evidence','logs','attempts','adr.md'])assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/archive/test',p)),false);
});

test('migration cannot skip a newly introduced ADR approval',t=>{
 const f=fixture(t);f.setup();const statePath='.t-flow/runs/t-flow/test/state.json',s=f.read(statePath);
 s.completedNodes=s.completedNodes.filter(id=>id!=='adr');delete s.approvals.adr;delete s.completedHashes.adr;f.put(statePath,s);
 const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json'),proto=JSON.parse(fs.readFileSync(p));proto.comment+=' update';fs.writeFileSync(p,JSON.stringify(proto));
 f.ok('migrate');assert.equal(f.read(statePath).currentNode,'adr');assert.equal(f.run('advance').code,1);
});

test('full workflow archives with required coverage without log or evidence files',t=>{const f=fixture(t);f.setup();f.pass();f.ok('advance');f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');f.doc('test-report.md','report');f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed'}]});f.ok('advance');f.doc('archive-report.md','accepted');f.put('docs/t-flow/openspec/specs/test/spec.md','spec');const hash=p=>spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import crypto from 'node:crypto';console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))`,path.join(f.root,p)],{encoding:'utf8'}).stdout.trim();const source='docs/t-flow/change/test/spec-delta.md',target='docs/t-flow/openspec/specs/test/spec.md';f.doc('archive/spec-sync.json',{changeId:'test',reviewed:true,files:[{source,target,sourceHash:hash(source),targetHash:hash(target)}]});f.ok('check');assert.equal(f.run('archive').code,1);f.ok('approve','archive','accepted');f.ok('init','other');f.put('docs/t-flow/change/other/clarify-log.md','other scope');const sibling=f.read('.t-flow/runs/t-flow/other/state.json');f.ok('--change','test','archive');f.ok('--change','test','doctor');assert.deepEqual(f.read('.t-flow/runs/t-flow/other/state.json'),sibling);assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/other/clarify-log.md'),'utf8'),'other scope');assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test')),false);assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,null);assert.equal(fs.readFileSync(path.join(f.root,'.t-flow/runs/t-flow/active'),'utf8').trim(),'other');f.ok('--change','test','status');assert.match(f.ok('list').out,/test.*已归档.*9\/9.*1\/1/);assert.equal(f.run('init','test').code,1);});

for(const [flags,body] of [
 [['--expect','PASS'],'console.log("MISSING")'],
 [['--reject','BUILD FAILURE'],'console.log("BUILD FAILURE")'],
 [[], 'process.exit(1)'],
 [[], '']
])test('run reports actual assertion or command failure: '+JSON.stringify([flags,body]),t=>{
 const f=fixture(t);f.setup();const r=f.run('run','T-01',...flags,'--',process.execPath,'-e',body);
 assert.equal(r.code,body===''?0:1);assert.match(r.out,new RegExp('STATUS: '+(body===''?'passed':'failed')));
 for(const dir of ['logs','evidence'])assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test',dir)),false);
});

test('latest failed execution blocks completion and manually passed reports',t=>{
 const f=fixture(t);f.setup('REQ-01 AC-01-1');f.pass();
 assert.equal(f.run('run','T-01','--',process.execPath,'-e','process.exit(1)').code,1);
 assert.equal(f.run('task','T-01','done').code,1);assert.equal(f.run('advance').code,1);
 f.pass();f.ok('advance');f.doc('test-report.md','passed');
 f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',acceptance:['AC-01-1']}]});
 assert.equal(f.run('run','REQ-01','--',process.execPath,'-e','process.exit(1)').code,1);
 assert.match(f.run('check').out,/最新验证未通过/);assert.equal(f.run('advance').code,1);
 f.ok('run','REQ-01','--',process.execPath,'-e','console.log("PASS")');f.ok('advance');
});

for(const mutation of ['edit','add','delete','test','config'])test('changed validation inputs invalidate a passed report: '+mutation,t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');
 f.put('tests/check.js','test');f.put('package.json','{}');
 f.ok('reopen','execute');f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','tests','--',process.execPath,'-e','console.log("PASS")');
 f.doc('verify/test-results.json',result);f.ok('check');
 const p=mutation==='test'?'tests/check.js':mutation==='config'?'package.json':mutation==='add'?'src/new.js':'src/a.js';
 if(mutation==='delete')fs.unlinkSync(path.join(f.root,p));else f.put(p,'changed');
 assert.equal(f.run('check').code,1);assert.equal(f.run('advance').code,1);
});

test('changes during test execution cannot produce a passed result',t=>{
 const f=fixture(t);f.setup();const r=f.run('run','T-01','--',process.execPath,'-e','require("fs").writeFileSync("src/a.js","changed");console.log("PASS")');
 assert.equal(r.code,1);assert.match(r.out,/验证期间输入发生变化/);assert.equal(f.run('task','T-01','done').code,1);
});

test('future documents block check approval and attempts to retain them by reopening',t=>{
 const f=fixture(t);f.ok('init','test');f.doc('clarify-log.md','scope');f.doc('prd.md','REQ-01');
 for(const args of [['check'],['approve','clarify','confirmed'],['advance'],['reopen','clarify']])assert.match(f.run(...args).out,/提前生成或修改/);
 fs.unlinkSync(path.join(f.root,'docs/t-flow/change/test/prd.md'));f.ok('approve','clarify','confirmed');f.ok('advance');
 f.doc('prd.md','REQ-01');f.doc('spec-delta.md','delta');f.doc('adr.md','premature ADR');assert.match(f.run('check').out,/提前生成或修改/);
});

test('reopen retains old future documents but blocks editing them before their stage',t=>{
 const f=fixture(t);f.setup();f.ok('reopen','specify');f.doc('prd.md','REQ-01 revised');f.ok('check');
 f.doc('adr.md','edited too soon');assert.match(f.run('approve','specify','confirmed').out,/提前生成或修改/);
});

test('skipping Design requires an explicit current user confirmation and unchanged inputs',t=>{
 const f=fixture(t);f.atUi();f.ok('skip','ui','no UI');
 assert.equal(f.run('approve','skip-design','confirmed').code,1);
 const r=f.ok('skip','design','small change');assert.match(r.out,/等待用户确认跳过 Design/);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,'design');assert.equal(f.run('advance').code,1);
 f.doc('design.md','new input');assert.equal(f.run('approve','skip-design','confirmed').code,1);
 f.ok('skip','design','revised reason');f.ok('approve','skip-design','用户确认省略设计');
 const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'plan');assert.equal(s.skipped.design.quote,'用户确认省略设计');
 f.ok('reopen','design');assert.equal(f.run('approve','skip-design','reuse old approval').code,1);
});

test('failure details appear only in terminal with bounded output and no extra files',t=>{
 const f=fixture(t);f.setup();const dir=path.join(f.root,'docs/t-flow/change/test'),before=fs.readdirSync(dir).sort();
 const r=f.run('run','T-01','--',process.execPath,'-e','console.error("x".repeat(9000)+"ASSERT: expected 2 but got 1");process.exit(1)');
 assert.equal(r.code,1);assert.match(r.out,/FAILURE_DETAIL:[\s\S]*ASSERT: expected 2 but got 1/);assert.ok(r.out.length<5000);
 assert.deepEqual(fs.readdirSync(dir).sort(),before);const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.doesNotMatch(JSON.stringify(s),/ASSERT:|xxxxxxxxxx/);
});

test('a new dependency manifest invalidates earlier results even if previously absent',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');f.doc('verify/test-results.json',result);f.ok('check');
 f.put('package.json','{}');assert.equal(f.run('advance').code,1);assert.match(f.ok('context').out,/验证输入已变化/);
});

test('build output changes do not invalidate source verification',t=>{
 const f=fixture(t);f.setup();f.put('src/dist/generated.js','old');f.pass();f.put('src/dist/generated.js','new');f.ok('check');
});

test('pending Design skip appears as waiting approval without a design document',t=>{
 const f=fixture(t);f.atUi();f.ok('skip','ui','no UI');f.ok('skip','design','small');assert.match(f.ok('check').out,/ARTIFACTS_READY/);
 const summary=JSON.parse(f.ok('status','--all','--json').out)[0];assert.equal(summary.status,'waiting_approval');
 assert.equal(f.run('advance').code,1);f.ok('approve','skip-design','同意跳过');
});

for(const legacy of ['skip','validation'])test('migration reopens legacy unconfirmed or unverified work: '+legacy,t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');const sp='.t-flow/runs/t-flow/test/state.json',state=f.read(sp);
 if(legacy==='skip')delete state.skipped.design.quote;else delete state.validation;
 f.put(sp,state);const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json'),proto=JSON.parse(fs.readFileSync(p));proto.comment+=' update';fs.writeFileSync(p,JSON.stringify(proto));
 f.ok('migrate');assert.equal(f.read(sp).currentNode,legacy==='skip'?'design':'execute');assert.equal(f.run('advance').code,1);
});

test('a timeout replaces prior success and cannot be bypassed by task status',t=>{
 const f=fixture(t);f.setup();f.pass();const r=f.run('run','T-01','--timeout','0.05','--',process.execPath,'-e','setTimeout(()=>{},2000)');
 assert.equal(r.code,1);assert.match(r.out,/FAILURE_DETAIL:/);assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').validation['execute:T-01'].status,'failed');assert.equal(f.run('task','T-01','done').code,1);
});

test('unexecuted passed reports cannot satisfy delivery coverage',t=>{
 const f=fixture(t);f.setup('REQ-01 AC-01-1');f.pass();f.ok('advance');f.doc('test-report.md','passed');
 f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',acceptance:['AC-01-1']}]});
 assert.match(f.run('check').out,/缺少实际验证结果/);
});

test('source changes block an already approved archive',t=>{
 const f=archiveFixture(t);f.put('src/a.js','changed after acceptance');assert.equal(f.run('archive').code,1);
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/archive/test')),false);
});

function quickFixFixture(t,{archive=false}={}){
 const f=liteFixture(t);f.put('tests/check.js','test source');f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','tests/check.js','--',process.execPath,'-e','console.log("PASS")');
 f.doc('test-report.md','AC-01-1 passed');f.doc('verify/test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',acceptance:['AC-01-1']}]});
 if(archive){f.ok('advance');f.doc('archive-report.md','accepted');f.ok('approve','archive','accepted');}
 f.put('tools/repair.sh',"printf 'fixed' > src/a.js\n");return f;
}
const fixedAssertion=['--',process.execPath,'-e','require("assert").equal(require("fs").readFileSync("src/a.js","utf8"),"fixed");console.log("PASS")'];

test('quick fix shares verification results without advancing or changing approvals or task status',t=>{
 const f=quickFixFixture(t),sp='.t-flow/runs/t-flow/test/state.json',before=f.read(sp),tasks=f.read('docs/t-flow/change/test/plan/tasks.json');
 f.doc('fix-log.md','historical record');
 f.ok('fix','T-01','--repair','tools/repair.sh','--expect','PASS',...fixedAssertion);const after=f.read(sp);
 for(const key of ['currentNode','completedNodes','approvals','skipped'])assert.deepEqual(after[key],before[key]);
 assert.deepEqual(f.read('docs/t-flow/change/test/plan/tasks.json'),tasks);
 assert.equal(after.validation['execute:T-01'].status,'passed');assert.equal(after.validation['verify:REQ-01'].status,'passed');f.ok('check');
 assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/fix-log.md'),'utf8'),'historical record');
 const report=fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/test-report.md'),'utf8');assert.match(report,/AC-01-1.*passed/);assert.doesNotMatch(report,/command|repair|runId|evidence|logs|printf/);
 for(const dir of ['logs','evidence','attempts'])assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test',dir)),false);
});

test('quick fix failure updates affected results and blocks standard delivery',t=>{
 const f=quickFixFixture(t);const r=f.run('fix','T-01','--repair','tools/repair.sh','--',process.execPath,'-e','console.error("assertion failed");process.exit(1)');
 assert.equal(r.code,1);assert.match(r.out,/assertion failed/);
 assert.equal(f.read('docs/t-flow/change/test/verify/test-results.json').tests[0].status,'failed');assert.equal(f.run('advance').code,1);
 f.ok('fix','T-01',...fixedAssertion);f.ok('check');
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test/fix-log.md')),false);
});

test('quick fix at archive preserves approval text but invalidates old delivery acceptance',t=>{
 const f=quickFixFixture(t,{archive:true}),sp='.t-flow/runs/t-flow/test/state.json',before=f.read(sp);
 f.ok('fix','T-01','--repair','tools/repair.sh',...fixedAssertion);
 const after=f.read(sp);assert.equal(after.currentNode,'archive');assert.deepEqual(after.completedNodes,before.completedNodes);assert.deepEqual(after.approvals,before.approvals);
 assert.match(f.ok('check').out,/ARTIFACTS_READY/);assert.equal(f.run('archive').code,1);
 f.ok('approve','archive','reviewed fix');f.ok('archive');
});

for(const target of ['prd.md','design.md','plan/tasks.json'])test('quick fix refuses contract edits instead of registering success: '+target,t=>{
 const f=quickFixFixture(t);f.put('tools/repair.sh',`printf 'changed contract' > docs/t-flow/change/test/${target}\nprintf 'ran' > repaired\n`);
 const r=f.run('fix','T-01','--repair','tools/repair.sh','--',process.execPath,'-e','require("fs").writeFileSync("tested","yes")');
 assert.equal(r.code,1);assert.match(r.out,/回到对应阶段重新确认/);assert.equal(fs.existsSync(path.join(f.root,'tested')),false);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').validation['execute:T-01'].status,'failed');
});

test('quick fix holds the shared lock during repair and tests',async t=>{
 const f=quickFixFixture(t);f.put('tools/repair.sh',"touch started\nsleep 1\nprintf 'fixed' > src/a.js\n");
 const child=spawn(process.execPath,[path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'fix','T-01','--repair','tools/repair.sh',...fixedAssertion],{cwd:f.root,env:{...process.env,TFLOW_RUN_ROOT:f.root},stdio:'ignore'});
 const finished=new Promise(resolve=>child.on('exit',resolve));
 try{
  const deadline=Date.now()+5000;while(!fs.existsSync(path.join(f.root,'started'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(fs.existsSync(path.join(f.root,'started')));
  for(const args of [['run','REQ-01','--',process.execPath,'-e','process.exit(0)'],['fix','T-01',...fixedAssertion],['reopen','execute']])assert.match(f.run(...args).out,/已锁定/);
  assert.equal(await finished,0);f.ok('check');
 }finally{await finished;}
});

test('standard workflow lock prevents quick fix edits',t=>{
 const f=quickFixFixture(t);f.put('.t-flow/runs/t-flow/test/write.lock',{pid:process.pid,host:os.hostname()});
 assert.match(f.run('fix','T-01','--repair','tools/repair.sh',...fixedAssertion).out,/已锁定/);
 assert.notEqual(fs.readFileSync(path.join(f.root,'src/a.js'),'utf8'),'fixed');
});

test('quick fix is rejected before implementation and for archived changes',t=>{
 const f=fixture(t);f.atUi();assert.equal(f.run('fix','T-01',...fixedAssertion).code,1);
 const g=quickFixFixture(t,{archive:true});g.ok('archive');assert.equal(g.run('fix','T-01',...fixedAssertion).code,1);
});

test('quick fix at execute updates results without generating future reports',t=>{
 const f=liteFixture(t);f.put('tools/repair.sh',"printf 'fixed' > src/a.js\n");
 const before=f.read('.t-flow/runs/t-flow/test/state.json');f.ok('fix','T-01','--repair','tools/repair.sh',...fixedAssertion);
 const after=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(after.currentNode,before.currentNode);assert.deepEqual(after.approvals,before.approvals);
 assert.equal(f.read('docs/t-flow/change/test/plan/tasks.json')[0].status,'pending');
 for(const file of ['test-report.md','verify/test-results.json','fix-log.md'])assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test',file)),false);
});

test('quick fix cannot change approvals through its repair script',t=>{
 const f=quickFixFixture(t),sp='.t-flow/runs/t-flow/test/state.json',before=f.read(sp);
 f.put('tools/repair.sh',`node -e 'const fs=require("fs"),p="${sp}",s=JSON.parse(fs.readFileSync(p));s.approvals={};fs.writeFileSync(p,JSON.stringify(s))'\n`);
 const r=f.run('fix','T-01','--repair','tools/repair.sh',...fixedAssertion);assert.equal(r.code,1);assert.match(r.out,/回到对应阶段重新确认/);
 assert.deepEqual(f.read(sp).approvals,before.approvals);assert.equal(f.read(sp).validation['execute:T-01'].status,'failed');
});

test('quick fix rejects missing implementation after repair even if the test exits zero',t=>{
 const f=quickFixFixture(t);f.put('tools/repair.sh','rm src/a.js\n');
 const r=f.run('fix','T-01','--repair','tools/repair.sh','--',process.execPath,'-e','process.exit(0)');assert.equal(r.code,1);assert.match(r.out,/验证输入缺失/);
});

test('quick fix can restore a deleted implementation before testing',t=>{
 const f=quickFixFixture(t);fs.unlinkSync(path.join(f.root,'src/a.js'));
 f.ok('fix','T-01','--repair','tools/repair.sh',...fixedAssertion);f.ok('check');
});

test('verification-only quick fix keeps unchanged delivery acceptance and reports',t=>{
 const f=quickFixFixture(t,{archive:true}),sp='.t-flow/runs/t-flow/test/state.json',before=f.read(sp),report=fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/test-report.md'),'utf8');
 f.ok('fix','T-01','--',process.execPath,'-e','console.log("PASS")');
 assert.deepEqual(f.read(sp).approvals,before.approvals);assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/test-report.md'),'utf8'),report);
 assert.doesNotMatch(f.ok('check').out,/ARTIFACTS_READY/);f.ok('archive');
});

test('failed repair does not execute tests or reuse an old passing result',t=>{
 const f=quickFixFixture(t);f.put('tools/repair.sh',"printf 'partly-fixed' > src/a.js\nfalse\n");
 const r=f.run('fix','T-01','--repair','tools/repair.sh','--',process.execPath,'-e','require("fs").writeFileSync("tested","yes");console.log("PASS")');
 assert.equal(r.code,1);assert.equal(fs.existsSync(path.join(f.root,'tested')),false);assert.equal(f.run('advance').code,1);
 assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').validation['execute:T-01'].status,'failed');
});

test('sensitive repair output is blocked and never persisted or printed',t=>{
 const f=quickFixFixture(t);f.put('tools/repair.sh',"printf 'password=supersecret'\n");
 const r=f.run('fix','T-01','--repair','tools/repair.sh',...fixedAssertion);assert.equal(r.code,1);assert.match(r.out,/SECRET_OUTPUT_BLOCKED/);assert.doesNotMatch(r.out,/supersecret/);
 const state=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(state.validation['execute:T-01'].status,'failed');assert.doesNotMatch(JSON.stringify(state),/supersecret/);
});
