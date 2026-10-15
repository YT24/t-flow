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
 const setup=(prd='REQ-01 behavior')=>{ok('init','test');doc('clarify-log.md','scope');ok('approve','clarify','confirmed');ok('advance');for(const p of ['prd.md','adr.md','spec-delta.md'])doc(p,p==='prd.md'?prd:'content');ok('approve','specify','confirmed');ok('advance');ok('skip','ui','no UI');ok('skip','design','small');doc('plan.md','plan');put('src/a.js','export const a=1;');doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src'],acceptance:['works'],status:'pending'}]);ok('advance');};
 const pass=()=>{ok('run','T-01','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');ok('task','T-01','done','docs/t-flow/change/test/evidence/T-01.json');};
 // 走到 ui 节点（不 skip）
 const atUi=()=>{ok('init','test');doc('clarify-log.md','scope');ok('approve','clarify','confirmed');ok('advance');for(const p of ['prd.md','adr.md','spec-delta.md'])doc(p,p==='prd.md'?'REQ-01 behavior':'content');ok('approve','specify','confirmed');ok('advance');};
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
test('failed rerun blocks advancement and preserves separate attempt logs',t=>{const f=fixture(t);f.setup();f.pass();const old=f.read('docs/t-flow/change/test/evidence/T-01.json');assert.equal(f.run('run','T-01','--',process.execPath,'-e','process.exit(1)').code,1);assert.equal(f.run('check').code,1);assert.match(fs.readFileSync(path.join(f.root,old.log),'utf8'),/PASS/);assert.notEqual(f.read('docs/t-flow/change/test/evidence/T-01.json').log,old.log);f.pass();f.ok('check');});
for(const change of ['add','delete'])test('directory evidence detects '+change+' files',t=>{const f=fixture(t);f.setup();f.pass();if(change==='add')f.put('src/new.js','new source');else fs.unlinkSync(path.join(f.root,'src/a.js'));assert.equal(f.run('check').code,1);});
test('migration rolls changed approved artifacts back for fresh confirmation',t=>{const f=fixture(t);f.setup();f.doc('prd.md','REQ-01 changed');const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'specify');assert.equal(s.approvals.specify,undefined);assert.equal(f.run('advance').code,1);});
test('optional unexecuted case cannot cover a delivery requirement',t=>{const f=fixture(t);f.setup();f.pass();f.ok('advance');f.doc('test-report.md','report');f.doc('test-results.json',{changeId:'test',tests:[{id:'smoke',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/T-01.json'},{id:'REQ-01',required:false,status:'not_run'}]});assert.equal(f.run('check').code,1);});
for(const flags of [['--expect','['],['--timeout','Infinity'],['--min-output','Infinity']])test('invalid flags rejected before execution: '+flags.join(' '),t=>{const f=fixture(t);f.setup();assert.equal(f.run('run','T-01',...flags,'--',process.execPath,'-e','require("fs").writeFileSync("side-effect","yes")').code,1);assert.equal(fs.existsSync(path.join(f.root,'side-effect')),false);});
test('full workflow archives with required coverage and retains inspectable logs',t=>{const f=fixture(t);f.setup();f.pass();f.ok('advance');f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');f.doc('test-report.md','report');f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-01.json'}]});f.ok('advance');f.doc('archive-report.md','accepted');f.put('openspec/specs/test/spec.md','spec');const hash=p=>spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import crypto from 'node:crypto';console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))`,path.join(f.root,p)],{encoding:'utf8'}).stdout.trim();const source='docs/t-flow/change/test/spec-delta.md',target='openspec/specs/test/spec.md';f.doc('spec-sync.json',{changeId:'test',reviewed:true,files:[{source,target,sourceHash:hash(source),targetHash:hash(target)}]});f.ok('check');assert.equal(f.run('archive').code,1);f.ok('approve','archive','accepted');f.ok('init','other');f.put('docs/t-flow/change/other/clarify-log.md','other scope');const sibling=f.read('.t-flow/runs/t-flow/other/state.json');f.ok('--change','test','archive');f.ok('--change','test','doctor');assert.deepEqual(f.read('.t-flow/runs/t-flow/other/state.json'),sibling);assert.equal(fs.readFileSync(path.join(f.root,'docs/t-flow/change/other/clarify-log.md'),'utf8'),'other scope');assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test')),false);assert.equal(f.read('.t-flow/runs/t-flow/test/state.json').currentNode,null);assert.equal(fs.readFileSync(path.join(f.root,'.t-flow/runs/t-flow/active'),'utf8').trim(),'other');f.ok('--change','test','status');assert.match(f.ok('list').out,/test.*已归档.*8\/8.*1\/1/);assert.equal(f.run('init','test').code,1);});

test('unchanged migration retains approvals and current node',t=>{const f=fixture(t);f.setup();const p=path.join(f.base,'skills/t-flow/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.t-flow/runs/t-flow/test/state.json');assert.equal(s.currentNode,'execute');assert.equal(s.approvals.specify.quote,'confirmed');f.ok('doctor');});
test('historical success cannot bypass latest failed attempt',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--',process.execPath,'-e','console.log("PASS")');
 const old=f.read('docs/t-flow/change/test/evidence/REQ-01.json');
 assert.equal(f.run('run','REQ-01','--input','src','--',process.execPath,'-e','process.exit(1)').code,1);
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:`docs/t-flow/change/test/evidence/attempts/REQ-01/${old.runId}.json`}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/证据路径必须是|不是最新执行结果/);
});
test('legacy evidence requires rerun rather than silent upgrade',t=>{const f=fixture(t);f.setup();f.pass();const ep='docs/t-flow/change/test/evidence/T-01.json',old=f.read(ep);delete old.schemaVersion;f.put(ep,old);const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/旧版验证证据/);f.pass();f.ok('check');});
test('unchanged binary directory inputs remain valid',t=>{const f=fixture(t);f.setup();fs.writeFileSync(path.join(f.root,'src/asset.bin'),Buffer.from([255,254,0,128]));f.pass();f.ok('check');});

// —— 证据伪造 / 复用向量 ——
test('copied evidence file cannot impersonate another case id',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 fs.copyFileSync(path.join(f.root,'docs/t-flow/change/test/evidence/REQ-01.json'),path.join(f.root,'docs/t-flow/change/test/evidence/REQ-02.json'));
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[
  {id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-01.json'},
  {id:'REQ-02',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-02.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/证据文件与内容 id 不一致/);
});
test('copied evidence with rewritten id still requires a real attempt record',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const copied=f.read('docs/t-flow/change/test/evidence/REQ-01.json');copied.id='REQ-02';
 f.put('docs/t-flow/change/test/evidence/REQ-02.json',copied);
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[
  {id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-01.json'},
  {id:'REQ-02',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-02.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/缺少该证据的执行记录/);
});
test('verify case cannot reuse execute task evidence',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/T-01.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/引用了 T-01 的证据/);
});
test('execute run rejects an id that is not a declared task',t=>{
 const f=fixture(t);f.setup();
 const ghost=f.run('run','GHOST','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.equal(ghost.code,1);assert.match(ghost.out,/必须是 tasks.json 中的任务 id/);
 assert.equal(fs.existsSync(path.join(f.root,'docs/t-flow/change/test/evidence/GHOST.json')),false);
});
test('same id reused across execute and verify is allowed once verify reruns it',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('skip','ui','no UI');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/a.js','export const a=1;');
 f.doc('tasks.json',[{id:'REQ-01',title:'task',dependsOn:[],modules:['src'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.ok('task','REQ-01','done','docs/t-flow/change/test/evidence/REQ-01.json');
 f.ok('advance');
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-01.json'}]});
 assert.equal(f.run('check').code,1,'execute-phase evidence must not satisfy the verify case');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.ok('check','verify rerun of the same id must be accepted');
});
test('evidence log path must stay inside the workflow logs directory',t=>{
 const f=fixture(t);f.setup();f.pass();
 const ep='docs/t-flow/change/test/evidence/T-01.json',ev=f.read(ep);
 f.put('outside.log','forged');
 ev.log='outside.log';
 f.put(ep,ev);
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/证据日志必须位于/);
});


// —— UI 设计 Skill：主/兜底 + 自动安装 ——
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
 const f=fixture(t);f.atUi();
 f.doc('ui.md','no scope block here');
 assert.match(f.run('check').out,/缺少 ```ui-scope 声明块/);
 f.doc('ui.md','```ui-scope\nmode: bogus\nfiles: [src/App.vue]\n```');
 assert.match(f.run('check').out,/mode 必须是 new 或 change/);
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: []\n```');
 assert.match(f.run('check').out,/files 不能为空/);
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: [src/Ghost.vue]\n```');
 assert.match(f.run('check').out,/路径不存在或非法/);
});
test('change mode must declare affected existing interfaces',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd({mode:'change',files:['src/App.vue'],affected:[]});
 assert.match(f.run('check').out,/必须用 affected 列出受影响的既有界面/);
 f.uiMd({mode:'change',files:['src/App.vue'],affected:['src/pages/Old.vue']});
 assert.equal(f.run('check').code,0);
});
test('ui-scope files are force-bound even when missing from task modules',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use','ui-ux-pro-max');f.uiMd();
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 // modules 故意不含 ui-scope 声明的 src/App.vue
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const ev=f.read('docs/t-flow/change/test/evidence/T-01.json');
 assert.ok(ev.inputs['src/App.vue'],'ui-scope 声明的文件应被强制计入证据输入');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/t-flow/change/test/evidence/T-01.json');
 // 改动已确认的界面文件 -> 证据必须过期
 f.put('src/App.vue','export default {changed:true};');
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/验证证据过期: src\/App\.vue/);
});
test('affected interfaces are bound too, so declared impact cannot be bypassed',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use','ui-ux-pro-max');
 f.uiMd({mode:'change',files:['src/App.vue'],affected:['src/pages/Old.vue']});
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const ev=f.read('docs/t-flow/change/test/evidence/T-01.json');
 assert.ok(ev.inputs['src/pages/Old.vue'],'affected 声明的既有界面也应被绑定');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/t-flow/change/test/evidence/T-01.json');
 f.put('src/pages/Old.vue','export default {touched:true};');
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/验证证据过期: src\/pages\/Old\.vue/);
});
test('run warns when a UI change binds no style or theme file',t=>{
 const f=fixture(t);f.setup();
 // setup 走 skip ui：没有 ui.md，因此不应告警
 const noUi=f.run('run','T-01','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.doesNotMatch(noUi.out,/未绑定任何样式/);
const g=fixture(t);
 g.ok('init','test');g.doc('clarify-log.md','scope');g.ok('approve','clarify','confirmed');g.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])g.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 g.ok('approve','specify','confirmed');g.ok('advance');g.ok('ui-use','ui-ux-pro-max');g.uiMd();
 g.ok('approve','ui','confirmed');g.ok('advance');g.ok('skip','design','small');
 g.doc('plan.md','plan');g.put('src/api.js','export const x=1;');
 g.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 g.ok('advance');
 const warned=g.run('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.match(warned.out,/UI 变更（ui.md 存在），但证据未绑定任何样式\/主题文件/);
 // 绑定样式文件后不再告警
 g.put('src/styles/theme.css',':root{--brand:#0a0}');
 const ok=g.run('run','T-01','--input','src/api.js','--input','src/styles/theme.css','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.doesNotMatch(ok.out,/未绑定任何样式/);
});
test('adding a new page is detected through the ui-scope directory binding',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use','ui-ux-pro-max');
 f.put('src/pages/Existing.vue','export default {};');
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: [src/pages]\naffected: []\n```');
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/t-flow/change/test/evidence/T-01.json');
 f.put('src/pages/NewPage.vue','export default {};');
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/验证证据目录已变化: src\/pages/);
});

// —— Claude 入口（.claude/skills）——
// Claude Code 只从 .claude/skills 发现 Skill，实体在 .agents/skills；安装器须为每个 Skill 建链接。
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
 // t-flow 入口与节点 Skill 都必须在其中
 for(const n of ['t-flow','t-flow-clarify','t-flow-verify'])assert.ok(fs.existsSync(path.join(claudeDir,n)),n+' 应有 .claude 入口');
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


test('explicit change run preserves child command arguments and active focus',t=>{
 const f=fixture(t);f.setup();f.ok('init','other');
 f.ok('--change','test','run','T-01','--expect','--change child','--',process.execPath,'-e','console.log(process.argv.slice(1).join(" "))','--','--change','child');
 assert.equal(f.read('docs/t-flow/change/test/evidence/T-01.json').changeId,'test');
 assert.equal(fs.readFileSync(path.join(f.root,'.t-flow/runs/t-flow/active'),'utf8').trim(),'other');
});
test('resume selects a change and progress includes skipped stages',t=>{
 const f=fixture(t);f.setup();f.ok('init','other');
 assert.match(f.ok('resume','test').out,/NEXT: execute/);
 assert.match(f.ok('list').out,/test.*execute.*5\/8/);
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

test('evidence in another change cannot validate the selected task',t=>{
 const f=fixture(t);f.setup();f.pass();
 const ev=f.read('docs/t-flow/change/test/evidence/T-01.json');
 f.put('docs/t-flow/change/other/evidence/T-01.json',ev);
 const tasks=f.read('docs/t-flow/change/test/tasks.json');tasks[0].evidence='docs/t-flow/change/other/evidence/T-01.json';f.doc('tasks.json',tasks);
 assert.equal(f.run('--change','test','check').code,1);
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

test('skipping a reopened UI ignores the old prototype scope during execution',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd();f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const a=1;');f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);f.ok('advance');
 f.ok('reopen','ui');f.ok('skip','ui','用户选择跳过原型');f.ok('skip','design','small');f.ok('advance');
 fs.unlinkSync(path.join(f.root,'src/App.vue'));
 const r=f.ok('run','T-01','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.doesNotMatch(r.out,/未绑定任何样式/);
 assert.ok(fs.existsSync(path.join(f.root,'docs/t-flow/change/test/ui.md')));
 assert.equal(f.read('docs/t-flow/change/test/evidence/T-01.json').inputs['src/App.vue'],undefined);
});


function acceptanceFixture(t){
 const f=fixture(t);f.setup('REQ-01 behavior\nAC-01-1: first behavior\nAC-01-2: second behavior');f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');f.doc('test-report.md','report');
 const result={changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',method:'unit',acceptance:['AC-01-1'],evidence:'docs/t-flow/change/test/evidence/REQ-01.json'}]};
 return {f,result};
}
test('requirement coverage cannot substitute for individual acceptance coverage',t=>{
 const {f,result}=acceptanceFixture(t);f.doc('test-results.json',result);
 assert.match(f.run('check').out,/验收标准.*AC-01-2/);
 result.tests[0].acceptance.push('AC-01-2');f.doc('test-results.json',result);f.ok('check');
});
test('optional unexecuted acceptance and unknown acceptance ids cannot satisfy coverage',t=>{
 const {f,result}=acceptanceFixture(t);
 result.tests.push({id:'manual',required:false,status:'not_run',method:'manual',acceptance:['AC-01-2']});f.doc('test-results.json',result);
 assert.equal(f.run('check').code,1);
 result.tests[0].acceptance.push('AC-99-1');f.doc('test-results.json',result);assert.match(f.run('check').out,/未知验收标准.*AC-99-1/);
});
test('duplicate test ids cannot inflate a verification report',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');result.tests.push({...result.tests[0]});f.doc('test-results.json',result);
 assert.match(f.run('check').out,/用例 ID 重复/);
});
test('bash verification preserves a failed pipeline status despite a success marker',t=>{
 const f=fixture(t);f.setup();
 const r=f.run('run','T-01','--expect','PASS','--','bash','-c','false | cat; printf "PASS\\n"');
 assert.equal(r.code,1);assert.equal(f.read('docs/t-flow/change/test/evidence/T-01.json').status,'failed');
});
test('negative assertions reject failure output even if success output and exit code pass',t=>{
 const f=fixture(t);f.setup();
 const r=f.run('run','T-01','--expect','PASS','--reject','BUILD FAILURE','--',process.execPath,'-e','console.log("PASS\\nBUILD FAILURE")');
 assert.equal(r.code,1);
 const ev=f.read('docs/t-flow/change/test/evidence/T-01.json');assert.equal(ev.status,'failed');assert.deepEqual(ev.rejects,['BUILD FAILURE']);assert.equal(ev.exitCode,0);
 f.ok('run','T-01','--expect','PASS','--reject','BUILD FAILURE','--',process.execPath,'-e','console.log("PASS")');
 const bad=f.run('run','T-01','--reject','[','--',process.execPath,'-e','require("fs").writeFileSync("side-effect","yes")');
 assert.equal(bad.code,1);assert.equal(fs.existsSync(path.join(f.root,'side-effect')),false);
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


test('acceptance coverage records the verification method explicitly',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');delete result.tests[0].method;f.doc('test-results.json',result);
 assert.match(f.run('check').out,/method.*验证方式/);result.tests[0].method='unit';f.doc('test-results.json',result);f.ok('check');
});

test('execution evidence binds reviewed HTML and binary screenshots and rejects stale reuse',t=>{
 const f=fixture(t);f.atUi();f.ok('ui-use','ui-ux-pro-max');f.uiMd();
 const html='docs/t-flow/change/test/prototype.html',png='docs/t-flow/change/test/screenshot.png';
 f.doc('prototype.html','<html>approved</html>');fs.writeFileSync(path.join(f.root,png),Buffer.from([255,254,0,128]));
 const ui=fs.readFileSync(path.join(f.root,'docs/t-flow/change/test/ui.md'),'utf8').replace('mode: new',`mode: new\nprototypes: [${html}, ${png}]`);f.doc('ui.md',ui);
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');f.doc('plan.md','plan');
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/App.vue'],acceptance:['works'],status:'pending'}]);f.ok('advance');f.pass();
 const ev=f.read('docs/t-flow/change/test/evidence/T-01.json');assert.ok(ev.inputs[html]);assert.ok(ev.inputs[png]);
 fs.writeFileSync(path.join(f.root,png),Buffer.from([255,253,0,128]));
 f.ok('reopen','ui');f.ok('ui-use','ui-ux-pro-max');f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');f.ok('advance');
 assert.match(f.run('check').out,/验证证据过期.*screenshot/);
 f.pass();f.ok('check');
});

for(const tamper of ['record','log'])test('integrity rejects modified '+tamper,t=>{
 const f=fixture(t);f.setup();f.pass();const ep='docs/t-flow/change/test/evidence/T-01.json',ev=f.read(ep);
 if(tamper==='record'){ev.command='different command';f.put(ep,ev);}else f.put(ev.log,'changed log');
 assert.equal(f.run('check').code,1);
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
 f.doc('test-report.md','report');f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/t-flow/change/test/evidence/REQ-01.json'}]});f.ok('advance');f.doc('archive-report.md','accepted');f.ok('approve','archive','accepted');return f;
}
for(const point of ['copy','publish','state'])test('archive resumes interruption after '+point,t=>{
 const f=archiveFixture(t),hook=path.join(f.base,'interrupt.cjs');
 fs.writeFileSync(hook,`const fs=require('fs');const orig=fs.${point==='copy'?'cpSync':'renameSync'};fs.${point==='copy'?'cpSync':'renameSync'}=function(a,b,...rest){const result=orig.call(this,a,b,...rest);if(${point==='copy'?"String(b).includes('archive')":point==='publish'?"String(b).endsWith('/archive/test')":"String(b).endsWith('/test/state.json') && JSON.parse(fs.readFileSync(b)).currentNode===null"})throw Error('simulated interruption');return result;};`);
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
  f.ok('--change','test','task','T-01','done','docs/t-flow/change/test/evidence/T-01.json');
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
 fs.writeFileSync(hook,`const fs=require('fs'),orig=fs.rmSync;fs.rmSync=function(p,...args){const result=orig(p,...args);if(String(p).endsWith('/change/test'))throw Error('cleanup interrupted');return result;};`);
 const r=spawnSync(process.execPath,['--require',hook,path.join(f.base,'skills/t-flow/scripts/yt.mjs'),'archive'],{cwd:f.root,env:{...process.env,TFLOW_RUN_ROOT:f.root}});assert.equal(r.status,1);
 assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'archive_pending');
 f.ok('--change','test','archive');assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'archived');
 assert.equal(fs.existsSync(path.join(f.root,'.t-flow/runs/t-flow/test/archive-pending.json')),false);
});
test('verification progress never treats stale evidence as ready',t=>{
 const {f,result}=acceptanceFixture(t);result.tests[0].acceptance.push('AC-01-2');f.doc('test-results.json',result);
 let row=JSON.parse(f.ok('changes','--json').out)[0];assert.equal(row.status,'ready');assert.deepEqual(row.stageProgress,{kind:'required_tests',done:1,total:1});
 f.put('src/a.js','changed');row=JSON.parse(f.ok('changes','--json').out)[0];assert.equal(row.status,'blocked');assert.match(row.reason,/证据过期/);
});
test('old evidence without a log digest requires rerun',t=>{
 const f=fixture(t);f.setup();f.pass();const ep='docs/t-flow/change/test/evidence/T-01.json',ev=f.read(ep);delete ev.logHash;
 f.put(ep,ev);f.put('docs/t-flow/change/test/evidence/attempts/T-01/'+ev.runId+'.json',ev);
 assert.match(f.run('check').out,/旧证据缺少日志摘要/);
 f.pass();f.ok('check');
});
test('status distinguishes an abandoned lock from a running command',t=>{
 const f=fixture(t);f.setup();f.put('.t-flow/runs/t-flow/test/write.lock',{pid:2147483647,host:os.hostname()});
 assert.equal(JSON.parse(f.ok('changes','--json').out)[0].status,'locked');
 assert.equal(f.run('reopen','plan').code,1);
});
