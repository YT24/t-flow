import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture(t) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'sy-workflow-test-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 fs.cpSync(new URL('../skills',import.meta.url),path.join(base,'skills'),{recursive:true});
 const root=path.join(base,'project');fs.mkdirSync(root);
 const run=(...args)=>{const r=spawnSync(process.execPath,[path.join(base,'skills/sy-comet/scripts/yt.mjs'),...args],{cwd:root,encoding:'utf8',env:{...process.env,COMET_RUN_ROOT:root}});return {code:r.status,out:r.stdout+r.stderr};};
 const ok=(...args)=>{const r=run(...args);assert.equal(r.code,0,r.out);return r;};
 const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));};
 const doc=(p,v)=>put('docs/sy-comet/current/'+p,v);
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
 const setup=()=>{ok('init','test');doc('clarify-log.md','scope');ok('approve','clarify','confirmed');ok('advance');for(const p of ['prd.md','adr.md','spec-delta.md'])doc(p,p==='prd.md'?'REQ-01 behavior':'content');ok('approve','specify','confirmed');ok('advance');ok('skip','ui','no UI');ok('skip','design','small');doc('plan.md','plan');put('src/a.js','export const a=1;');doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src'],acceptance:['works'],status:'pending'}]);ok('advance');};
 const pass=()=>{ok('run','T-01','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');ok('task','T-01','done','docs/sy-comet/current/evidence/T-01.json');};
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
test('failed rerun blocks advancement and preserves separate attempt logs',t=>{const f=fixture(t);f.setup();f.pass();const old=f.read('docs/sy-comet/current/evidence/T-01.json');assert.equal(f.run('run','T-01','--',process.execPath,'-e','process.exit(1)').code,1);assert.equal(f.run('check').code,1);assert.match(fs.readFileSync(path.join(f.root,old.log),'utf8'),/PASS/);assert.notEqual(f.read('docs/sy-comet/current/evidence/T-01.json').log,old.log);f.pass();f.ok('check');});
for(const change of ['add','delete'])test('directory evidence detects '+change+' files',t=>{const f=fixture(t);f.setup();f.pass();if(change==='add')f.put('src/new.js','new source');else fs.unlinkSync(path.join(f.root,'src/a.js'));assert.equal(f.run('check').code,1);});
test('migration rolls changed approved artifacts back for fresh confirmation',t=>{const f=fixture(t);f.setup();f.doc('prd.md','REQ-01 changed');const p=path.join(f.base,'skills/sy-comet/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.comet/runs/sy-comet/state.json');assert.equal(s.currentNode,'specify');assert.equal(s.approvals.specify,undefined);assert.equal(f.run('advance').code,1);});
test('optional unexecuted case cannot cover a delivery requirement',t=>{const f=fixture(t);f.setup();f.pass();f.ok('advance');f.doc('test-report.md','report');f.doc('test-results.json',{changeId:'test',tests:[{id:'smoke',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/T-01.json'},{id:'REQ-01',required:false,status:'not_run'}]});assert.equal(f.run('check').code,1);});
for(const flags of [['--expect','['],['--timeout','Infinity'],['--min-output','Infinity']])test('invalid flags rejected before execution: '+flags.join(' '),t=>{const f=fixture(t);f.setup();assert.equal(f.run('run','T-01',...flags,'--',process.execPath,'-e','require("fs").writeFileSync("side-effect","yes")').code,1);assert.equal(fs.existsSync(path.join(f.root,'side-effect')),false);});
test('full workflow archives with required coverage and retains inspectable logs',t=>{const f=fixture(t);f.setup();f.pass();f.ok('advance');f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');f.doc('test-report.md','report');f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-01.json'}]});f.ok('advance');f.doc('archive-report.md','accepted');f.put('openspec/specs/test/spec.md','spec');const hash=p=>spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import crypto from 'node:crypto';console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))`,path.join(f.root,p)],{encoding:'utf8'}).stdout.trim();const source='docs/sy-comet/current/spec-delta.md',target='openspec/specs/test/spec.md';f.doc('spec-sync.json',{changeId:'test',reviewed:true,files:[{source,target,sourceHash:hash(source),targetHash:hash(target)}]});f.ok('check');assert.equal(f.run('archive').code,1);f.ok('approve','archive','accepted');f.ok('archive');f.ok('doctor');assert.equal(f.read('.comet/runs/sy-comet/state.json').currentNode,null);});

test('unchanged migration retains approvals and current node',t=>{const f=fixture(t);f.setup();const p=path.join(f.base,'skills/sy-comet/reference/workflow-protocol.json');const proto=JSON.parse(fs.readFileSync(p));proto.comment+=' updated';fs.writeFileSync(p,JSON.stringify(proto));f.ok('migrate');const s=f.read('.comet/runs/sy-comet/state.json');assert.equal(s.currentNode,'execute');assert.equal(s.approvals.specify.quote,'confirmed');f.ok('doctor');});
test('historical success cannot bypass latest failed attempt',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--',process.execPath,'-e','console.log("PASS")');
 const old=f.read('docs/sy-comet/current/evidence/REQ-01.json');
 assert.equal(f.run('run','REQ-01','--input','src','--',process.execPath,'-e','process.exit(1)').code,1);
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:`docs/sy-comet/current/evidence/attempts/REQ-01/${old.runId}.json`}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/证据路径必须是|不是最新执行结果/);
});
test('legacy evidence requires rerun rather than silent upgrade',t=>{const f=fixture(t);f.setup();f.pass();const ep='docs/sy-comet/current/evidence/T-01.json',old=f.read(ep);delete old.schemaVersion;f.put(ep,old);const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/旧版验证证据/);f.pass();f.ok('check');});
test('unchanged binary directory inputs remain valid',t=>{const f=fixture(t);f.setup();fs.writeFileSync(path.join(f.root,'src/asset.bin'),Buffer.from([255,254,0,128]));f.pass();f.ok('check');});

// —— 证据伪造 / 复用向量 ——
test('copied evidence file cannot impersonate another case id',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 fs.copyFileSync(path.join(f.root,'docs/sy-comet/current/evidence/REQ-01.json'),path.join(f.root,'docs/sy-comet/current/evidence/REQ-02.json'));
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[
  {id:'REQ-01',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-01.json'},
  {id:'REQ-02',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-02.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/证据文件与内容 id 不一致/);
});
test('copied evidence with rewritten id still requires a real attempt record',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const copied=f.read('docs/sy-comet/current/evidence/REQ-01.json');copied.id='REQ-02';
 f.put('docs/sy-comet/current/evidence/REQ-02.json',copied);
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[
  {id:'REQ-01',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-01.json'},
  {id:'REQ-02',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-02.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/缺少该证据的执行记录/);
});
test('verify case cannot reuse execute task evidence',t=>{
 const f=fixture(t);f.setup();f.pass();f.ok('advance');
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/T-01.json'}]});
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/引用了 T-01 的证据/);
});
test('execute run rejects an id that is not a declared task',t=>{
 const f=fixture(t);f.setup();
 const ghost=f.run('run','GHOST','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 assert.equal(ghost.code,1);assert.match(ghost.out,/必须是 tasks.json 中的任务 id/);
 assert.equal(fs.existsSync(path.join(f.root,'docs/sy-comet/current/evidence/GHOST.json')),false);
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
 f.ok('task','REQ-01','done','docs/sy-comet/current/evidence/REQ-01.json');
 f.ok('advance');
 f.doc('test-report.md','report');
 f.doc('test-results.json',{changeId:'test',tests:[{id:'REQ-01',required:true,status:'passed',evidence:'docs/sy-comet/current/evidence/REQ-01.json'}]});
 assert.equal(f.run('check').code,1,'execute-phase evidence must not satisfy the verify case');
 f.ok('run','REQ-01','--input','src','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.ok('check','verify rerun of the same id must be accepted');
});
test('evidence log path must stay inside the workflow logs directory',t=>{
 const f=fixture(t);f.setup();f.pass();
 const ep='docs/sy-comet/current/evidence/T-01.json',ev=f.read(ep);
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
test('ui-use records the primary skill by default',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const r=f.run('ui-use');assert.equal(r.code,0,r.out);
 assert.match(r.out,/USED: ui-ux-pro-max（主 Skill）/);
 assert.equal(f.read('.comet/runs/sy-comet/state.json').uiSkill.used,'ui-ux-pro-max');
});
test('ui-use with the fallback warns but is allowed',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const r=f.run('ui-use','frontend-design');assert.equal(r.code,0,r.out);
 assert.match(r.out,/兜底 Skill/);assert.match(r.out,/WARN/);
 assert.equal(f.read('.comet/runs/sy-comet/state.json').uiSkill.used,'frontend-design');
});
test('ui-use rejects an unrelated skill name and non-ui nodes',t=>{
 const f=fixture(t);f.atUi();f.ok('ensure-skills');
 const bad=f.run('ui-use','some-other-skill');assert.equal(bad.code,1);assert.match(bad.out,/须为 ui-ux-pro-max 或 frontend-design/);
 const g=fixture(t);g.ok('init','test');
 assert.equal(g.run('ui-use').code,1);
});
test('doctor flags ui.md without a recorded skill once past ui',t=>{
 const f=fixture(t);f.atUi();f.uiMd();
 f.ok('approve','ui','confirmed');f.ok('advance');
 const r=f.run('doctor');assert.equal(r.code,1);assert.match(r.out,/未记录所用设计 Skill/);
});
test('doctor stays OK when the skill is recorded or ui was skipped',t=>{
 const rec=fixture(t);rec.atUi();rec.ok('ensure-skills');rec.ok('ui-use');rec.uiMd();rec.ok('approve','ui','confirmed');rec.ok('advance');rec.ok('doctor');
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
 const f=fixture(t);f.atUi();f.uiMd({mode:'change',files:['src/App.vue'],affected:[]});
 assert.match(f.run('check').out,/必须用 affected 列出受影响的既有界面/);
 f.uiMd({mode:'change',files:['src/App.vue'],affected:['src/pages/Old.vue']});
 assert.equal(f.run('check').code,0);
});
test('ui-scope files are force-bound even when missing from task modules',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use');f.uiMd();
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 // modules 故意不含 ui-scope 声明的 src/App.vue
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const ev=f.read('docs/sy-comet/current/evidence/T-01.json');
 assert.ok(ev.inputs['src/App.vue'],'ui-scope 声明的文件应被强制计入证据输入');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/sy-comet/current/evidence/T-01.json');
 // 改动已确认的界面文件 -> 证据必须过期
 f.put('src/App.vue','export default {changed:true};');
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/验证证据过期: src\/App\.vue/);
});
test('affected interfaces are bound too, so declared impact cannot be bypassed',t=>{
 const f=fixture(t);
 f.ok('init','test');f.doc('clarify-log.md','scope');f.ok('approve','clarify','confirmed');f.ok('advance');
 for(const p of ['prd.md','adr.md','spec-delta.md'])f.doc(p,p==='prd.md'?'REQ-01 behavior':'content');
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use');
 f.uiMd({mode:'change',files:['src/App.vue'],affected:['src/pages/Old.vue']});
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 const ev=f.read('docs/sy-comet/current/evidence/T-01.json');
 assert.ok(ev.inputs['src/pages/Old.vue'],'affected 声明的既有界面也应被绑定');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/sy-comet/current/evidence/T-01.json');
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
 g.ok('approve','specify','confirmed');g.ok('advance');g.ok('ui-use');g.uiMd();
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
 f.ok('approve','specify','confirmed');f.ok('advance');f.ok('ui-use');
 f.put('src/pages/Existing.vue','export default {};');
 f.doc('ui.md','```ui-scope\nmode: new\nfiles: [src/pages]\naffected: []\n```');
 f.ok('approve','ui','confirmed');f.ok('advance');f.ok('skip','design','small');
 f.doc('plan.md','plan');f.put('src/api.js','export const x=1;');
 f.doc('tasks.json',[{id:'T-01',title:'task',dependsOn:[],modules:['src/api.js'],acceptance:['works'],status:'pending'}]);
 f.ok('advance');
 f.ok('run','T-01','--input','src/api.js','--expect','PASS','--',process.execPath,'-e','console.log("PASS")');
 f.ok('task','T-01','in_progress');f.ok('task','T-01','done','docs/sy-comet/current/evidence/T-01.json');
 f.put('src/pages/NewPage.vue','export default {};');
 const r=f.run('check');assert.equal(r.code,1);assert.match(r.out,/验证证据目录已变化: src\/pages/);
});
