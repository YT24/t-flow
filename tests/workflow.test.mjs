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
 return {base,root,run,ok,put,doc,read,setup,pass};
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
 const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/不是最新执行结果/);
});
test('legacy evidence requires rerun rather than silent upgrade',t=>{const f=fixture(t);f.setup();f.pass();const ep='docs/sy-comet/current/evidence/T-01.json',old=f.read(ep);delete old.schemaVersion;f.put(ep,old);const result=f.run('check');assert.equal(result.code,1);assert.match(result.out,/旧版验证证据/);f.pass();f.ok('check');});
test('unchanged binary directory inputs remain valid',t=>{const f=fixture(t);f.setup();fs.writeFileSync(path.join(f.root,'src/asset.bin'),Buffer.from([255,254,0,128]));f.pass();f.ok('check');});
