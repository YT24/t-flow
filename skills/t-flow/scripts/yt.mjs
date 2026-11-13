#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(process.env.TFLOW_RUN_ROOT || process.cwd());
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const protocol=JSON.parse(fs.readFileSync(path.join(pkg,'reference/workflow-protocol.json')));
const fullNodes=protocol.nodes.filter(n=>!n.disabled);
let nodes=fullNodes, profile="full";
const cfg=protocol.config||{};
const SPEC_PREFIX=cfg.specTargetPrefix??'docs/t-flow/openspec/specs/';
const SPEC_REQUIRED=cfg.specSyncRequired!==false;
// 需求编号模式与覆盖校验：PRD 里的需求编号必须被 test-results.json 中已通过必测用例的 id 覆盖，
// 否则"必测项"完全由被测方自定义，需求与测试之间没有可追溯性（历史缺陷）。
const REQ_PATTERN=cfg.requirementIdPattern??'REQ-\\d+';
const REQ_COVERAGE=cfg.requireCoverage!==false;
// --change <id> 全局覆盖：显式指定本次命令作用的变更（脚本化友好）；否则用 active 指针。
const _argv=process.argv.slice(2);
// 仅识别命令前缀，run 的子命令参数保持原样。
let CLI_CHANGE=null;
if(_argv[0]==='--change'){CLI_CHANGE=_argv[1];_argv.splice(0,2);}
const [cmd='help',arg,value,...extra]=_argv;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// 确认门禁与验证-修复上限均由协议声明（改动这些值会改变 protocolHash，进行中变更需 migrate）。
let APPROVAL_NODES=nodes.filter(n=>n.approval).map(n=>n.id);
const MAX_VERIFY_FAILURES=cfg.maxVerifyFailures??3;
function configureProfile(s={}){
 profile=s.profile||'full';
 if(!['full','lite'].includes(profile))throw Error('未知工作流模式 '+profile);
 nodes=profile==='lite'?fullNodes.filter(n=>['specify','plan','execute','verify','archive'].includes(n.id)):fullNodes;
 APPROVAL_NODES=nodes.filter(n=>n.approval).map(n=>n.id);
}
function safe(rel){
 if(!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw Error('路径必须在项目内');
 const full=path.resolve(root,rel); let cursor=root;
 for(const part of path.relative(root,full).split(path.sep)){ cursor=path.join(cursor,part); if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('不允许符号链接: '+rel); }
 return full;
}
// —— 多 change 布局 ——
// docs/t-flow/change/<change-id>/       每个未归档变更一个独立目录（change 为父目录）
// .t-flow/runs/t-flow/<change-id>/state.json   每 change 一份状态
// .t-flow/runs/t-flow/active             指针：当前聚焦的 changeId（"继续"目标）
// 归档：docs/t-flow/archive/<change-id>/；状态保留供查询，同名 change 不覆盖。
const RUNS_DIR=path.dirname(safe(protocol.state.statePath)), ACTIVE_FILE=RUNS_DIR+'/active';
// 协议产物模板都写在 docs/t-flow/current/...；多 change 布局下 current 段映射到 change/<cid>/。
const DOC_BASE='docs/t-flow', CHANGES_BASE=protocol.state.changesBase||DOC_BASE+'/change';
const TASKS_PATH='plan/tasks.json', TEST_RESULTS_PATH='verify/test-results.json', SPEC_SYNC_PATH='archive/spec-sync.json';
const LEGACY_STATE=path.join(RUNS_DIR,'state.json');
function validId(cid){if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(cid||''))throw Error('change-id 使用小写字母数字和连字符');return cid;}
function changeIds(){return fs.existsSync(RUNS_DIR)?fs.readdirSync(RUNS_DIR,{withFileTypes:true}).filter(d=>d.isDirectory()&&fs.existsSync(stateFileOf(d.name))).map(d=>d.name):[];}
function changeDocDir(cid){return CHANGES_BASE+'/'+cid;}
function mapArt(cid,p){return p.replace(DOC_BASE+'/current/',changeDocDir(cid)+'/');}
let ACTIVE=null; // 当前聚焦的 change（init/use/--change 后确定）
function activeId(){
 if(CLI_CHANGE)return ACTIVE=CLI_CHANGE; // --change 显式指定优先，且不落盘
 if(ACTIVE)return ACTIVE;
 try{const v=fs.readFileSync(ACTIVE_FILE,'utf8').trim();if(v)return ACTIVE=validId(v);}catch{}
 // 无指针时：仅有一个未归档变更则自动聚焦它（单变更场景无需先 use）；多于一个才要求显式选择。
 const ids=changeIds().filter(cid=>{try{return JSON.parse(fs.readFileSync(stateFileOf(cid))).currentNode;}catch{return false;}});
 if(ids.length===1)return ACTIVE=ids[0];
 return null;
}
function setActive(cid){ACTIVE=validId(cid);writeRaw(path.relative(root,ACTIVE_FILE),cid+'\n');}
function stateFileOf(cid){return safe(path.relative(root,RUNS_DIR)+'/'+validId(cid)+'/state.json');}
// 原子创建锁文件覆盖整个读-改-写过程，包括长时间运行的验证命令。
function lockChange(cid){
 const lock=path.dirname(stateFileOf(cid))+'/write.lock';
 fs.mkdirSync(path.dirname(lock),{recursive:true});
 let fd;try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code!=='EEXIST')throw e;throw Error('change '+cid+' 已锁定；等待执行结束。若进程已退出，核对 '+lock+' 中的主机和 PID 后清理遗留锁');}
 fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname(),command:cmd,at:new Date().toISOString()}));fs.closeSync(fd);
 process.on('exit',()=>{try{fs.unlinkSync(lock);}catch{}});
}
function readState(cid){
 const f=stateFileOf(cid);
 if(!fs.existsSync(f))throw Error('变更 '+cid+' 不存在（changes 查看列表，init <id> 新建）');
 const s=JSON.parse(fs.readFileSync(f,'utf8'));
 if(s.changeId!==cid)throw Error('状态 changeId 与目录不一致: '+cid);
 if(s.workflow!==protocol.name||s.protocolHash!==protocolHash())throw Error('变更 '+cid+' 的状态与工作流版本不一致：运行 --change '+cid+' migrate');
 configureProfile(s);
 return s;
}
function writeStateFile(s){const f=stateFileOf(s.changeId);fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,f);}
// 当前聚焦 change 的产物目录（替代原 current 常量）与状态读写。
function docDir(){const cid=activeId();if(!cid)throw Error('未聚焦任何变更：use <change-id> 或 init <change-id>');return changeDocDir(cid);}
function read(rel){return fs.readFileSync(safe(rel),'utf8');}
function json(rel){return JSON.parse(read(rel));}
function writeRaw(rel,data){const f=safe(rel);fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,f);}
function write(rel,data){writeRaw(rel,JSON.stringify(data,null,2)+'\n');}
function protocolHash(){return sha(JSON.stringify(protocol));}
function migrateLegacy(){
 const legacy=JSON.parse(fs.readFileSync(safe(path.relative(root,LEGACY_STATE)),'utf8')),cid=validId(legacy.changeId);
 if(CLI_CHANGE&&CLI_CHANGE!==cid)throw Error('旧状态属于 '+cid);
 if(legacy.workflow!==protocol.name)throw Error('旧状态 workflow 不匹配');
 const target=changeDocDir(cid),old=DOC_BASE+'/current',backup=target+'/legacy-workflow-state.json';
 const moved=fs.existsSync(safe(target));
 // 只有与旧状态完全一致的迁移记录，才允许接续已经移动的目录。
 if(moved&&(fs.existsSync(safe(old))||!fs.existsSync(safe(backup))||JSON.stringify(json(backup))!==JSON.stringify(legacy)))throw Error('迁移目标已存在，请核对 '+target);
 let s=legacy;
 if(fs.existsSync(stateFileOf(cid))){
  s=readState(cid);
  if(!moved||s.history?.at(-1)?.action!=='migrate layout')throw Error('迁移目标状态已存在，请核对 '+cid);
 }else{
  if(s.currentNode){
   if(!moved){
    if(!fs.existsSync(safe(old)))throw Error('旧 current 目录缺失');
    // 先写记录再移动，移动或状态落盘中断后均可核对重试。
    write(old+'/legacy-workflow-state.json',legacy);
    fs.mkdirSync(safe(CHANGES_BASE),{recursive:true});fs.renameSync(safe(old),safe(target));
   }
   // 路径参与确认指纹，保留历史，从澄清重新确认并重新验证。
   s={...legacy,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0};delete s.uiSkill;
  }
  s.protocolHash=protocolHash();if(s.currentNode)retainFutureArtifacts(s);save(s,'migrate layout');
 }
 if(s.currentNode)setActive(cid);
 fs.renameSync(LEGACY_STATE,LEGACY_STATE+'.legacy-'+Date.now());
 print(s);console.log('旧文档和历史保留；产物内 current 路径需更新，确认与验证须重新执行。');
}

function state(){const cid=activeId();if(!cid)throw Error('未聚焦任何变更：use <change-id> 或 init <change-id>');return readState(cid);}
function save(s,action){if(action)s.history.push({action,at:new Date().toISOString()});s.updatedAt=new Date().toISOString();writeStateFile(s);}
function node(id){const n=nodes.find(n=>n.id===id);if(!n)throw Error('未知节点 '+id);return n;}
function files(n){if(profile==='lite'&&['specify','archive'].includes(n.id))return ['docs/t-flow/current/'+(n.id==='specify'?'prd.md':'archive-report.md')];return n.outputSchemas.flatMap(id=>{const schema=protocol.outputSchemas.find(x=>x.id===id);if(!schema)throw Error('缺少 schema '+id);return schema.artifacts.filter(a=>a.required).flatMap(a=>a.paths);});}
function contentHash(p){return p.endsWith('/tasks.json')?sha(JSON.stringify(json(p).map(({status,evidence,...rest})=>rest))):sha(fs.readFileSync(safe(p)));}
function fingerprint(s,id){
 const end=nodes.findIndex(n=>n.id===id),paths=nodes.slice(0,end+1).flatMap(files).map(p=>mapArt(s.changeId,p));
 const ui=changeDocDir(s.changeId)+'/ui.md';
 if(end>=nodes.findIndex(n=>n.id==='ui')&&!s.skipped?.ui&&fs.existsSync(safe(ui)))paths.push(...(parseUiScope(read(ui))?.prototypes||[]));
 return sha(JSON.stringify({changeId:s.changeId,protocol:s.protocolHash,...(id==='archive'?{validation:[...new Set(Object.values(s.validation||{}).flatMap(r=>Object.entries(r.inputs||{}).map(pair=>JSON.stringify(pair))))].sort()}:{}),files:[...new Set(paths)].map(p=>[p,fs.existsSync(safe(p))?contentHash(p):null])}));
}
function tasks(){const t=json(docDir()+'/'+TASKS_PATH);if(!Array.isArray(t)||!t.length)throw Error('tasks.json 必须是非空数组');const ids=new Set(t.map(x=>x.id));if(ids.size!==t.length)throw Error('任务 ID 重复');for(const x of t){if(!x.id||!x.title||!Array.isArray(x.dependsOn)||!Array.isArray(x.acceptance)||!x.acceptance.length||!['pending','in_progress','blocked','done'].includes(x.status))throw Error('任务字段不完整 '+x.id);
 // modules 明确任务实现范围。
 if(!Array.isArray(x.modules)||!x.modules.length||x.modules.some(m=>typeof m!=='string'||!m.trim()))throw Error('任务 '+x.id+' 的 modules 必须是非空路径数组');
 if(x.dependsOn.some(d=>!ids.has(d)||d===x.id))throw Error('任务依赖非法 '+x.id);}const seen=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('任务依赖循环');if(seen.has(id))return;active.add(id);t.find(x=>x.id===id).dependsOn.forEach(visit);active.delete(id);seen.add(id);}t.forEach(x=>visit(x.id));return t;}
// 仅在现有 state.json 保存每个任务/套件的最新结果与输入指纹。
const INPUT_IGNORES=new Set(['.git','.t-flow','node_modules','target','build','dist','out','coverage','.next','.nuxt','__pycache__','.playwright-cli']);
function inputHash(rel){
 const entries=[];
 function visit(p){
  const f=safe(p),stat=fs.statSync(f);
  if(stat.isDirectory()&&p.replace(/\\/g,'/').replace(/^\.\//,'')===docDir())return;
  if(stat.isDirectory())for(const name of fs.readdirSync(f).sort()){if(!INPUT_IGNORES.has(name))visit(p+'/'+name);}
  else if(stat.isFile())entries.push([p,contentHash(p)]);
 }
 visit(rel);return sha(JSON.stringify(entries));
}
function validationRoots(s,task,extraInputs=[]){
 const modules=task?task.modules:tasks().flatMap(t=>t.modules);
 const end=nodes.findIndex(n=>n.id==='execute');
 const artifacts=nodes.slice(0,end).flatMap(files).map(p=>mapArt(s.changeId,p)).filter(p=>fs.existsSync(safe(p)));
 const manifests=['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','pom.xml','build.gradle','pyproject.toml','requirements.txt'];
 return [...new Set([...modules,...extraInputs,...artifacts,...manifests])].sort();
}
function inputSnapshot(roots){return Object.fromEntries(roots.map(p=>[p,fs.existsSync(safe(p))?inputHash(p):null]));}
function validateRun(result){
 if(!result||result.status!=='passed')throw Error('缺少最新通过的验证结果，请 run 重测');
 if(!result.inputs||!Object.keys(result.inputs).length)throw Error('验证结果缺少输入指纹，请 run 重测');
 try{if(!isDeepStrictEqual(result.inputs,inputSnapshot(Object.keys(result.inputs))))throw Error('changed');}
 catch{throw Error('验证输入已变化或缺失，请重测 '+result.id);}
}
function validateTaskRun(s,id){validateRun(s.validation?.['execute:'+id]);}
function validateDeliveryRuns(s,r){
 const results=Object.values(s.validation||{});
 for(const result of results)if(result.status!=='passed')throw Error('最新验证未通过 '+result.id+'，请在 '+result.node+' 重测');
 for(const t of r.tests.filter(t=>t.required&&t.status==='passed')){
  const matching=results.filter(result=>result.id===t.id||(t.acceptance?.length&&t.acceptance.every(ac=>result.acceptance?.includes(ac))));
  if(!matching.length)throw Error('用例缺少实际验证结果 '+t.id+'，请 run 执行');
  let valid=false;for(const result of matching){try{validateRun(result);valid=true;break;}catch{}}
  if(!valid)throw Error('用例验证结果已失效 '+t.id+'，请重测');
 }
}
function updateFixResults(s,task,passed){
 const rp=docDir()+'/'+TEST_RESULTS_PATH,report=docDir()+'/test-report.md';
 if(!fs.existsSync(safe(rp)))return;
 const r=json(rp);let changed=false;
 if(r.changeId!==s.changeId||!Array.isArray(r.tests))throw Error('缺少本次测试结果');
 for(const t of r.tests)if(t.id===task.id||(t.acceptance?.length&&t.acceptance.every(ac=>task.acceptance.includes(ac)))){
  const status=passed?'passed':'failed',reason=passed?undefined:'快速修复验证失败';
  if(t.status!==status||t.reason!==reason)changed=true;
  t.status=status;if(passed)delete t.reason;else t.reason=reason;
 }
 if(!changed)return;
 write(rp,r);
 if(fs.existsSync(safe(report))){
  const rows=r.tests.flatMap(t=>(t.acceptance?.length?t.acceptance:['—']).map(ac=>'| '+[t.id,ac,t.status,t.reason||''].map(v=>String(v).replaceAll('|','\\|').replace(/\r?\n/g,' ')).join(' | ')+' |'));
  writeRaw(report,'# 测试结果\n\n| 用例 | AC | 结果 | 失败或未测原因 |\n|---|---|---|---|\n'+rows.join('\n')+'\n');
 }
 if(s.completedNodes.includes('verify'))s.completedHashes.verify=fingerprint(s,'verify');
}
function futureArtifacts(s){
 const i=nodes.findIndex(n=>n.id===s.currentNode),current=new Set(nodes.slice(0,i+1).flatMap(files));
 return [...new Set(nodes.slice(i+1).flatMap(files))].filter(p=>!current.has(p)).map(p=>mapArt(s.changeId,p));
}
function retainFutureArtifacts(s){
 s.retainedArtifacts=Object.fromEntries(futureArtifacts(s).filter(p=>fs.existsSync(safe(p))).map(p=>[p,contentHash(p)]));
}
function validateStageArtifacts(s){
 if(!s.currentNode)return;
 for(const p of futureArtifacts(s))if(fs.existsSync(safe(p))&&s.retainedArtifacts?.[p]!==contentHash(p))throw Error('提前生成或修改后续阶段产物: '+p+'；当前阶段确认后才能继续');
}
function testResult(s){
 const r=json(docDir()+'/'+TEST_RESULTS_PATH);
 if(r.changeId!==s.changeId||!Array.isArray(r.tests)||!r.tests.length)throw Error('缺少本次测试结果');
 if(new Set(r.tests.map(t=>t.id)).size!==r.tests.length)throw Error('用例 ID 重复');
 for(const t of r.tests){
  if(typeof t.id!=='string'||!t.id.trim()||typeof t.required!=='boolean'||!['passed','failed','not_run'].includes(t.status))throw Error('测试结果非法');
  if(t.status==='failed')throw Error('测试失败 '+t.id);
  if(t.required&&t.status!=='passed')throw Error('必测项未通过 '+t.id);
 }
 if(!r.tests.some(t=>t.required))throw Error('没有定义必测项');
 coverage(r);validateDeliveryRuns(s,r);return r;
}
// 需求覆盖：每个需求至少有一个通过的必测用例。
function coverage(r){
 const prd=read(docDir()+'/prd.md');
 if(REQ_COVERAGE){
  let re;try{re=new RegExp(REQ_PATTERN,'g');}catch(e){throw Error('requirementIdPattern 不是合法正则: '+REQ_PATTERN);}
  const reqs=new Set(prd.match(re)||[]);
  if(!reqs.size)throw Error('PRD 未包含任何需求编号（模式 '+REQ_PATTERN+'）：无法建立需求与测试的对应关系；若本项目不使用编号，请在 protocol config 置 requireCoverage:false');
  const ids=r.tests.filter(t=>t.required&&t.status==='passed').map(t=>String(t.id));
  const uncovered=[...reqs].filter(q=>!ids.some(id=>new RegExp('(^|[^0-9A-Za-z])'+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^0-9])').test(id)));
  if(uncovered.length)throw Error('以下需求缺少已通过的必测用例: '+uncovered.join(', ')+'（用例 id 须包含需求编号）');
 }
 // PRD 声明了逐条 AC 时，需求级通过不能替代验收标准通过。
 const criteria=new Set(prd.match(/\bAC-\d+-\d+\b/g)||[]),covered=new Set();
 for(const t of r.tests){
  if(t.acceptance!==undefined&&(!Array.isArray(t.acceptance)||t.acceptance.some(a=>typeof a!=='string')))throw Error('用例 '+t.id+' 的 acceptance 必须是验收编号数组');
  for(const ac of t.acceptance||[]){
   if(!criteria.has(ac))throw Error('用例 '+t.id+' 引用了未知验收标准 '+ac);
   if(t.required&&t.status==='passed')covered.add(ac);
  }
 }
 const missing=[...criteria].filter(ac=>!covered.has(ac));
 if(missing.length)throw Error('以下验收标准缺少已通过的必测用例: '+missing.join(', ')+'（在用例 acceptance 中逐条列出；未测不能计为通过）');
}

function validateUiCoverage(s){
 if(!s.skipped?.ui&&fs.existsSync(safe(docDir()+'/ui.md')))uiScope({implementation:true});
}

// 只读恢复包：给出选择与定位，不展开历史。
function context(s){
 if(!s.currentNode)return {changeId:s.changeId,profile:s.profile||'full',next:'done',archivePath:s.archivePath};
 const blockers=[];
 try{drift(s);}catch(e){blockers.push(e.message);}
 if(['execute','verify','archive'].includes(s.currentNode)){
  try{
   for(const r of Object.values(s.validation||{}))if(r.status!=='passed')validateRun(r);
   for(const t of tasks().filter(t=>t.status==='done'))validateTaskRun(s,t.id);
   if(s.currentNode!=='execute'&&fs.existsSync(safe(docDir()+'/'+TEST_RESULTS_PATH)))testResult(s);
  }catch(e){blockers.push(e.message);}
 }
 const tp=docDir()+'/'+TASKS_PATH;
 const ts=fs.existsSync(safe(tp))?tasks():[];
 const candidates=ts.filter(t=>t.status!=='done'&&t.dependsOn.every(id=>ts.find(x=>x.id===id)?.status==='done'));
 const selected=arg?ts.find(t=>t.id===arg):candidates.find(t=>t.status==='in_progress')||candidates[0];
 if(arg&&!selected)throw Error('未知任务 '+arg);
 const prd=docDir()+'/prd.md',acs=selected?.acceptance||[];
 const acceptance=fs.existsSync(safe(prd))?read(prd).split('\n').flatMap((line,i)=>acs.some(ac=>new RegExp('(^|[^A-Za-z0-9-])'+String(ac).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^A-Za-z0-9-])').test(line))?[{line:i+1,text:line}]:[]):[];
 const upstream={clarify:[],specify:['clarify-log.md'],adr:['prd.md'],ui:['prd.md'],design:['prd.md','ui.md'],plan:['prd.md','design.md'],execute:['plan.md','design.md'],verify:['prd.md',TEST_RESULTS_PATH],archive:['test-report.md','spec-delta.md',SPEC_SYNC_PATH]};
 const readFiles=(upstream[s.currentNode]||[]).map(p=>docDir()+'/'+p).filter(p=>fs.existsSync(safe(p)));
 if(selected)readFiles.push(...selected.modules);
 let next=s.currentNode==='execute'&&selected?'task '+selected.id+' in_progress':'check';
 if(blockers.length)next='修复 blocker 指示的阶段后再次 context';
 return {changeId:s.changeId,profile:s.profile||'full',stage:s.currentNode,blockers,
  task:selected||null,acceptance,readFiles:[...new Set(readFiles)],
  requiredArtifacts:files(node(s.currentNode)).map(p=>mapArt(s.changeId,p)),next,
  note:'按实际执行填写测试结果；不生成或引用日志与证据文件。'};
}

function syncResult(s){if(s.profile==='lite')return;const p=docDir()+'/'+SPEC_SYNC_PATH;if(!fs.existsSync(safe(p))){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步记录');return;}const r=json(p);if(r.changeId!==s.changeId||!Array.isArray(r.files))throw Error('Spec 同步记录非法');if(!r.files.length){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步记录');return;}for(const f of r.files){if(!f.source.startsWith(docDir()+'/')||!f.target.startsWith(SPEC_PREFIX))throw Error('Spec 路径不正确（目标须以 '+SPEC_PREFIX+' 开头）');if(sha(read(f.source))!==f.sourceHash||sha(read(f.target))!==f.targetHash)throw Error('Spec 同步记录过期');}if(r.reviewed!==true)throw Error('Spec 合并未核对');}
function validate(s,id,{approval=true}={}){
 validateStageArtifacts(s);
 if(id==='design'&&s.pendingSkip&&cmd!=='approve'){
  if(s.pendingSkip.fingerprint!==fingerprint(s,'design'))throw Error('跳过 Design 的输入已变化，请重新提出原因并确认');
  if(approval)throw Error('需要用户确认跳过 Design：approve skip-design <用户原文>');
  return;
 }
 if(s.skipped?.design&&!s.skipped.design.quote)throw Error('跳过 Design 缺少用户确认，请 reopen design');
 const n=node(id);for(const p of files(n).map(pp=>mapArt(s.changeId,pp))){if(p.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(p)))continue;if(!read(p).trim())throw Error('产物为空 '+p);}
 const idx=nodes.findIndex(n=>n.id===id);
 for(const p of [...new Set(nodes.slice(0,idx+1).flatMap(files).map(pp=>mapArt(s.changeId,pp)))])if(fs.existsSync(safe(p)))assertNoSecrets(p,read(p));
 if(id==='ui'){uiScope();if(!s.uiSkill?.used)throw Error('请用 ui-use <Skill名> 记录默认或用户指定的设计 Skill');}
 if(id==='plan')tasks();
 if(id==='execute'){for(const t of tasks()){if(t.status!=='done')throw Error('任务未完成 '+t.id);validateTaskRun(s,t.id);}}
 if(id==='verify'){validate(s,'execute',{approval:false});const r=testResult(s);validateUiCoverage(s,r);}
 if(id==='archive'){validate(s,'execute',{approval:false});const r=testResult(s);validateUiCoverage(s,r);syncResult(s);}
 if(approval&&APPROVAL_NODES.includes(id)&&s.approvals[id]?.fingerprint!==fingerprint(s,id))throw Error('需要用户确认或确认已失效: '+id);
}
function drift(s){validateStageArtifacts(s);for(const id of s.completedNodes){if(s.completedHashes[id]!==fingerprint(s,id))throw Error('已完成产物变化，请 reopen '+id);}}
// —— ui-scope：把「用户确认的界面」与真实文件绑定 ——
// ui.md 里形如：
//   ```ui-scope
//   mode: change            # new | change
//   files: [src/pages/Page1.vue]
//   affected: [src/pages/Page2.vue]
//   ```
// 目的：ui 门禁确认的是"关于界面的描述"，此前与真实交付物无绑定——确认的界面可以是 A，
// 实际交付的却是 B。声明后这些路径会被校验存在，并在 verify/archive 检查实现路径。
const UI_SCOPE_BLOCK='ui-scope';
function parseUiScope(text){
 const re=new RegExp('```'+UI_SCOPE_BLOCK+'\\s*\\n([\\s\\S]*?)```');
 const m=re.exec(text);
 if(!m)return null;
 const out={mode:null,files:[],affected:[],prototypes:[]};
 for(const raw of m[1].split('\n')){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const kv=/^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
  if(!kv)continue;
  const [,k,v]=kv;
  const list=v.trim().replace(/^\[|\]$/g,'').split(',').map(s=>s.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
  if(k==='mode')out.mode=v.trim().replace(/^["']|["']$/g,'')||null;
  else if(k==='files')out.files.push(...list);
  else if(k==='affected')out.affected.push(...list);
  else if(k==='prototypes')out.prototypes.push(...list);
 }
 return out;
}
// 校验 ui.md 的 ui-scope 声明：模式合法、路径真实存在、改造时必须列受影响界面。
function uiScope({implementation=false}={}){
 const p=docDir()+'/ui.md';
 if(!fs.existsSync(safe(p)))return null;
 const sc=parseUiScope(read(p));
 if(!sc){
  throw Error('ui.md 缺少 ```'+UI_SCOPE_BLOCK+' 声明块：需声明本次交付的界面文件（存量项目改造时另列 affected），把用户确认的界面与真实文件绑定。参见 templates/ui.md');
 }
 if(!['new','change'].includes(sc.mode))throw Error('ui-scope 的 mode 必须是 new 或 change（当前 '+(sc.mode||'<空>')+'）');
 if(!sc.files.length)throw Error('ui-scope 的 files 不能为空：至少列出本次交付/改动的界面文件或目录');
 for(const p of sc.prototypes){if(!p.startsWith(docDir()+'/')||!fs.existsSync(safe(p))||!fs.statSync(safe(p)).isFile())throw Error('原型须为本 change 内真实文件: '+p);}
 for(const p of sc.files)safe(p);
 const required=(implementation||sc.mode==='change'?sc.files:[]).concat(sc.affected,sc.prototypes);
 const bad=required.filter(f=>{try{return !fs.existsSync(safe(f));}catch{return true;}});
 if(bad.length)throw Error('ui-scope 声明的路径不存在或非法: '+bad.join(', ')+'（须为项目内真实相对路径）');
 if(sc.mode==='change'&&!sc.affected.length)throw Error('ui-scope 的 mode=change（存量改造）时必须用 affected 列出受影响的既有界面，供用户评估影响面与回归范围');
 return sc;
}
function archiveJournal(cid){return path.relative(root,path.dirname(stateFileOf(cid))+'/archive-pending.json');}
function treeManifest(dir){
 const result={};
 function walk(rel){for(const entry of fs.readdirSync(safe(rel),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const p=rel+'/'+entry.name;
  if(entry.isSymbolicLink())throw Error('归档不允许符号链接: '+p);
  if(entry.isDirectory())walk(p);else if(entry.isFile())result[p.slice(dir.length+1)]=sha(fs.readFileSync(safe(p)));else throw Error('不支持的归档文件: '+p);
 }}
 walk(dir);return result;
}
// change 目录只保留受控产物。辅助脚本/手工输出不属于阶段产物，只警告不删除，避免影响历史变更。
function uncontrolledChangeFiles(cid){
 const base=changeDocDir(cid);if(!fs.existsSync(safe(base)))return [];
 const allowed=new Set(protocol.outputSchemas.flatMap(sc=>sc.artifacts).flatMap(a=>a.paths).map(p=>mapArt(cid,p).slice(base.length+1)));
 allowed.add('fix-log.md');
 const ui=base+'/ui.md';
 if(fs.existsSync(safe(ui))){try{for(const p of parseUiScope(read(ui))?.prototypes||[]){const n=path.normalize(p).split(path.sep).join('/');if(n.startsWith(base+'/'))allowed.add(n.slice(base.length+1));}}catch{}}
 const controlledDirs=new Set(['evidence','logs','screenshots']),out=[];
 function walk(rel){for(const e of fs.readdirSync(safe(rel),{withFileTypes:true})){
  const p=rel+'/'+e.name,r=p.slice(base.length+1);
  if(e.isDirectory()){if(rel===base&&controlledDirs.has(e.name))continue;walk(p);}
  else if(!allowed.has(r)||(!r.includes('/')&&!r.endsWith('.md')))out.push(r);
 }}
 walk(base);return out.sort();
}
function warnUncontrolledChangeFiles(cid){
 const stray=uncontrolledChangeFiles(cid);if(!stray.length)return;
 console.error('WARN: change 目录存在未受控文件或根目录非 Markdown 文件:\n'+stray.map(p=>'- '+p).join('\n')+'\n根目录只保留各阶段 Markdown；JSON 固定放在 plan/tasks.json、verify/test-results.json、archive/spec-sync.json，原型放 prototypes/，截图放 screenshots/。验证辅助脚本作为 run 的命令并用 --input 绑定，其它临时文件请删除或移出。');
}
function archiveChange(s){
 const source=changeDocDir(s.changeId),destination=DOC_BASE+'/archive/'+s.changeId,jp=archiveJournal(s.changeId),stage=destination+'.pending';
 if(!fs.existsSync(safe(jp))){
  if(!s.currentNode){if(s.archivePath!==destination||!fs.existsSync(safe(destination+'/workflow-state.json')))throw Error('归档状态不完整，请 doctor');print(s);return;}
  if(s.currentNode!=='archive')throw Error('当前不是归档阶段');
  drift(s);validate(s,'archive');warnUncontrolledChangeFiles(s.changeId);
  if(fs.existsSync(safe(destination))||fs.existsSync(safe(stage)))throw Error('归档目录已存在');
  const manifest=treeManifest(source);
  if(Object.hasOwn(manifest,'workflow-state.json'))throw Error('workflow-state.json 为归档保留文件名');
  const finalState=structuredClone(s);finalState.completedNodes.push('archive');finalState.completedHashes.archive=fingerprint(s,'archive');finalState.currentNode=null;finalState.archivePath=destination;
  finalState.updatedAt=new Date().toISOString();finalState.history.push({action:'archive',at:finalState.updatedAt});
  write(jp,{changeId:s.changeId,manifest,initialState:s,finalState});
 }
 const journal=json(jp);
 if(journal.changeId!==s.changeId||journal.finalState?.archivePath!==destination)throw Error('归档恢复记录不匹配');
 if(s.currentNode){
  if(!isDeepStrictEqual(s,journal.initialState))throw Error('归档开始后状态发生变化');
  drift(s);validate(s,'archive');
  if(!isDeepStrictEqual(treeManifest(source),journal.manifest))throw Error('归档开始后源文件发生变化，保留现场供核对');
 }else if(!isDeepStrictEqual(s,journal.finalState))throw Error('归档完成状态与恢复记录不一致');
 if(!fs.existsSync(safe(destination))){
  if(!s.currentNode)throw Error('已归档目录缺失');
  fs.mkdirSync(path.dirname(safe(destination)),{recursive:true});
  if(fs.existsSync(safe(stage)))fs.rmSync(safe(stage),{recursive:true});
  fs.cpSync(safe(source),safe(stage),{recursive:true,errorOnExist:true,force:false});
  if(!isDeepStrictEqual(treeManifest(stage),journal.manifest))throw Error('归档复制校验失败');
  fs.renameSync(safe(stage),safe(destination));
 }
 const actual=treeManifest(destination);delete actual['workflow-state.json'];
 if(!isDeepStrictEqual(actual,journal.manifest))throw Error('归档文件与恢复记录不一致，保留源目录');
 write(destination+'/workflow-state.json',journal.finalState);
 writeStateFile(journal.finalState);
 if(fs.existsSync(safe(source))){
  const remaining=treeManifest(source);
  if(Object.entries(remaining).some(([p,h])=>journal.manifest[p]!==h))throw Error('归档源目录已变化，停止清理');
  fs.rmSync(safe(source),{recursive:true});
 }
 // active 只是默认选择；保留指针避免与其他会话 use/init 的写入竞争。
 fs.unlinkSync(safe(jp));print(journal.finalState);
}
function changeSummary(cid){
 const previous=CLI_CHANGE,previousProfile=profile;CLI_CHANGE=cid;
 try{
  const s=readState(cid),base=s.currentNode?changeDocDir(cid):s.archivePath;
  const taskPath=base+'/'+TASKS_PATH,legacyTasks=base+'/tasks.json';
  const tsPath=fs.existsSync(safe(taskPath))?taskPath:legacyTasks,ts=fs.existsSync(safe(tsPath))?json(tsPath):[];
  const row={changeId:cid,profile:s.profile||'full',stage:s.currentNode||'archived',status:s.currentNode?'in_progress':'archived',
   progress:{done:new Set([...s.completedNodes,...Object.keys(s.skipped||{})]).size,total:nodes.length},
   tasks:{done:ts.filter(t=>t.status==='done').length,total:ts.length,blocked:ts.filter(t=>t.status==='blocked').length},
   stageProgress:{kind:'artifacts',done:0,total:0},reason:'',next:s.currentNode?'继续 '+s.currentNode:'已完成',updatedAt:s.updatedAt};
  if(!s.currentNode){row.stageProgress={kind:'archive',done:1,total:1};if(fs.existsSync(safe(archiveJournal(cid)))){row.status='archive_pending';row.next='archive（恢复清理）';}return row;}
  const required=files(node(s.currentNode)).map(p=>mapArt(cid,p)).filter(p=>SPEC_REQUIRED||!p.endsWith('/spec-sync.json'));
  row.stageProgress={kind:'artifacts',done:required.filter(p=>fs.existsSync(safe(p))&&read(p).trim()).length,total:required.length};
  if(s.currentNode==='execute')row.stageProgress={kind:'tasks',done:row.tasks.done,total:row.tasks.total};
  if(s.currentNode==='verify'){
   const currentResults=base+'/'+TEST_RESULTS_PATH,rp=fs.existsSync(safe(currentResults))?currentResults:base+'/test-results.json',tests=fs.existsSync(safe(rp))?json(rp).tests.filter(t=>t.required):[];
   row.stageProgress={kind:'required_tests',done:tests.filter(t=>t.status==='passed').length,total:tests.length};
  }
  try{drift(s);validate(s,s.currentNode,{approval:false});
   row.status=APPROVAL_NODES.includes(s.currentNode)&&s.approvals[s.currentNode]?.fingerprint!==fingerprint(s,s.currentNode)?'waiting_approval':'ready';
   row.next=row.status==='waiting_approval'?'等待用户确认':s.currentNode==='archive'?'archive':'advance';
  }catch(e){row.reason=e.message;row.status='blocked';row.next='修复阻塞后 check';}
  if(fs.existsSync(path.dirname(stateFileOf(cid))+'/archive-pending.json')){row.status='archive_pending';row.next='archive（恢复归档）';}
  if(fs.existsSync(path.dirname(stateFileOf(cid))+'/write.lock')){
   row.status='locked';row.next='核对锁中主机/PID及子进程，确认停止后清理遗留锁';
   try{row.lock=JSON.parse(fs.readFileSync(path.dirname(stateFileOf(cid))+'/write.lock','utf8'));
    if(row.lock.host===os.hostname()&&Number.isInteger(row.lock.pid)&&row.lock.pid>0){process.kill(row.lock.pid,0);row.status='running';row.next='等待正在执行的命令结束';}
   }catch{}
  }
  return row;
 }catch(e){return {changeId:cid,status:'invalid',stage:'?',reason:e.message,next:'doctor',stageProgress:{done:0,total:0},progress:{done:0,total:nodes.length},tasks:{done:0,total:0}};}
 finally{CLI_CHANGE=previous;configureProfile({profile:previousProfile});}
}
function listChanges(){
 const rows=changeIds().sort().map(changeSummary);
 if(_argv.includes('--json')){console.log(JSON.stringify(rows,null,2));return;}
 const labels={in_progress:'进行中',archived:'已归档',waiting_approval:'待确认',ready:'可推进',blocked:'阻塞',running:'执行中',locked:'锁待核对',archive_pending:'归档待恢复',invalid:'状态异常'};
 console.log('change\t阶段\t总进度\t任务\t阶段进度\t状态\t下一步\t原因\t更新时间');
 for(const r of rows)console.log([r.changeId,r.stage==='archived'?'已归档':r.stage,r.progress.done+'/'+r.progress.total,r.tasks.done+'/'+r.tasks.total,r.stageProgress.done+'/'+r.stageProgress.total+' '+(r.stageProgress.kind||''),labels[r.status],r.next,r.reason,r.updatedAt||'-'].join('\t'));
 if(!rows.length)console.log('(无 change；init <change-id> 新建)');
}
function print(s){
 if(cmd==='status'&&_argv.includes('--json')){console.log(JSON.stringify(s,null,2));return;}
 // 默认只输出恢复所需摘要；完整确认、指纹和 history 落盘保存，需要审计时用 status --json。
 console.log('STATE: '+JSON.stringify({changeId:s.changeId,profile:s.profile||'full',currentNode:s.currentNode,completedNodes:s.completedNodes,skipped:Object.keys(s.skipped||{}),verifyFailures:s.verifyFailures,...(s.archivePath?{archivePath:s.archivePath}:{}),updatedAt:s.updatedAt}));
 if(cmd==='status')console.log('SUMMARY: '+JSON.stringify(changeSummary(s.changeId)));
 if(!s.currentNode){console.log('NEXT: done');return;}
 console.log('NEXT: '+s.currentNode+(APPROVAL_NODES.includes(s.currentNode)?'（用户确认门禁，approve 记录确认原文后才能 advance）':''));
 console.log('SKILL: t-flow-'+s.currentNode);
 if(s.currentNode==='ui'){
  if(s.uiSkill?.used)console.log('UI_SELECTED: '+s.uiSkill.used+'（已选择，继续设计；原型仍需用户确认）');
  else{
   console.log('UI_CHOICE: 默认使用主 Skill；沿用用户明确选择，无需额外询问工具偏好。原型仍须验收。');
   console.log('1. 跳过 UI（无界面需求或用户已明确要求跳过）：--change '+s.changeId+' skip ui <用户选择及原因>');
   console.log('2. '+(UI_ROUTING?.primary||'ui-ux-pro-max')+'（推荐）：--change '+s.changeId+' ui-use '+(UI_ROUTING?.primary||'ui-ux-pro-max'));
   console.log('3. '+(UI_ROUTING?.fallback||'frontend-design')+'：--change '+s.changeId+' ui-use '+(UI_ROUTING?.fallback||'frontend-design'));
  }
 }
}
const SECRET_RULES=[
 ['private-key',/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
 ['credential-assignment',/(?:password|passwd|secret|access[_-]?token|api[_-]?key|密码|密钥|令牌)\s*[:=]\s*(?!["']?(?:<|\$\{|\*{3,}|x{3,}|example|sample|dummy|redacted|示例))["']?[^\s,"'}\]]{6,}/i],
 ['bearer-token',/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+\/-]{8,}/i]
];
function secretFindings(text){return SECRET_RULES.filter(([,pattern])=>pattern.test(String(text))).map(([name])=>name);}
function assertNoSecrets(rel,text){const hits=secretFindings(text);if(hits.length)throw Error('疑似凭证不得落盘: '+rel+'（'+hits.join(', ')+'）；请脱敏并使用环境变量，不回显匹配内容');}
function shellQuote(a){return /^[\w@%+=:,./-]+$/.test(a)?a:"'"+a.replace(/'/g,"'\\''")+"'";}
function readStdin(){try{if(!fs.fstatSync(0).isCharacterDevice())return fs.readFileSync(0,'utf8');}catch{}return null;}
// —— UI 设计 Skill 路由与自动安装 ——
// 协议声明主/兜底 Skill；两者都随本包分发在 skills/ 下，本地缺失时自动补齐。
const UI_ROUTING=protocol.uiSkillRouting||null;
const BUNDLED_SKILLS=path.join(pkg,'..');
// Skill 是否可用：本包自带，或在目标项目 / 全局的 .agents|.claude/skills 下已安装（含符号链接）。
function skillDirs(name){
 return [
  path.join(BUNDLED_SKILLS,name),
  path.join(root,'.agents','skills',name),
  path.join(root,'.claude','skills',name),
  path.join(os.homedir(),'.agents','skills',name),
  path.join(os.homedir(),'.claude','skills',name),
 ];
}
function skillAvailable(name){return skillDirs(name).some(d=>{try{return fs.existsSync(path.join(d,'SKILL.md'));}catch{return false;}});}
// 建立 .claude/skills 与 .agents/skills 的互链，使 Claude 与 agent 两条发现路径都能命中。
function linkSkill(name){
 const pairs=[[path.join(root,'.agents','skills',name),path.join(root,'.claude','skills',name)],
              [path.join(os.homedir(),'.agents','skills',name),path.join(os.homedir(),'.claude','skills',name)]];
 for(const [src,dst] of pairs){
  try{
   if(!fs.existsSync(path.join(src,'SKILL.md')))continue;
   if(fs.existsSync(dst))continue;
   fs.mkdirSync(path.dirname(dst),{recursive:true});
   // Windows 目录符号链接需要特权，junction 无需；junction 目标须为绝对路径。
   if(process.platform==='win32')fs.symlinkSync(src,dst,'junction');
   else fs.symlinkSync(path.relative(path.dirname(dst),src),dst);
  }catch{/* 链接失败不阻断：另一条路径仍可用 */ }
 }
}
// 确保路由声明的 Skill 就位。包内自带的不等于"项目里可用"——Claude 与多数 agent 只从
// .agents/skills 或 .claude/skills 发现 Skill，因此只在本包内的也要落到目标目录。
function ensureUiSkills({auto=true,scope='project'}={}){
 if(!UI_ROUTING)throw Error('协议缺少 uiSkillRouting 配置，请运行 migrate 或补全 workflow-protocol.json');
 const names=[UI_ROUTING.primary,UI_ROUTING.fallback,...(UI_ROUTING.distribution||[])].filter(Boolean)
  .filter((n,i,a)=>a.indexOf(n)===i);
 const base=scope==='global'?path.join(os.homedir(),'.agents','skills'):path.join(root,'.agents','skills');
 const out=[];
 for(const name of names){
  const dest=path.join(base,name);
  if(fs.existsSync(path.join(dest,'SKILL.md'))){linkSkill(name);out.push({name,available:true,action:'已就位于 '+dest});continue;}
  if(!auto){out.push({name,available:false,action:'缺失且未自动安装'});continue;}
  const bundled=fs.existsSync(path.join(BUNDLED_SKILLS,name,'SKILL.md'));
  if(!bundled){out.push({name,available:false,action:'本包不含该 Skill，请手动放置到 '+dest});continue;}
  try{
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   fs.cpSync(path.join(BUNDLED_SKILLS,name),dest,{recursive:true,filter:s=>!s.includes('__pycache__')&&!s.endsWith('.pyc')});
   linkSkill(name);
   out.push({name,available:fs.existsSync(path.join(dest,'SKILL.md')),action:'已自动安装到 '+dest});
  }catch(e){out.push({name,available:false,action:'安装失败：'+e.message});}
 }
 return out;
}
function uiRouting(){
 if(!UI_ROUTING)throw Error('协议缺少 uiSkillRouting 配置，请运行 migrate 或补全 workflow-protocol.json');
 const lines=[`主 Skill: ${UI_ROUTING.primary}（${skillAvailable(UI_ROUTING.primary)?'可用':'缺失'}）`,
  `兜底: ${UI_ROUTING.fallback}（${skillAvailable(UI_ROUTING.fallback)?'可用':'缺失'}）`];
 for(const n of UI_ROUTING.distribution||[])lines.push(`分发内容: ${n}${skillAvailable(n)?'':'（缺失）'}`);
 return {primary:UI_ROUTING.primary,fallback:UI_ROUTING.fallback,lines};
}
function doctor(){
 const problems=[];
 for(const n of nodes){if(!fs.existsSync(path.join(pkg,'..','t-flow-'+n.id,'SKILL.md')))problems.push('缺少节点 Skill: t-flow-'+n.id);}
 // UI 设计 Skill 自检：主/兜底 Skill 必须可用（缺失时可自动安装）；ui.md 产出时须记录所用 Skill。
 if(!UI_ROUTING)problems.push('协议缺少 uiSkillRouting：UI 节点无法确定设计 Skill');
 else{
  if(!UI_ROUTING.primary)problems.push('uiSkillRouting 缺少 primary');
  if(!UI_ROUTING.fallback)problems.push('uiSkillRouting 缺少 fallback');
  for(const name of [UI_ROUTING.primary,UI_ROUTING.fallback].filter(Boolean)){
   if(!skillAvailable(name))problems.push('UI 设计 Skill 不可用: '+name+'（运行 ensure-skills 自动安装，或手动放置）');
  }
  const dist=UI_ROUTING.distribution||[];
  for(const name of dist){if(!fs.existsSync(path.join(BUNDLED_SKILLS,name,'SKILL.md')))problems.push('声明为分发内容但本包缺失: '+name);}
 }
 for(const t of ['spec-sync.json','test-results.json'])if(!fs.existsSync(path.join(pkg,'templates',t)))problems.push('缺少模板 '+t);
 // Claude 入口完整性：本工作流的 Skill 实体装在 .agents/skills，但 Claude Code 只从
 // .claude/skills 发现——缺入口则该 Skill 在 Claude 下不可见。只检查本包自己的 Skill
 // （t-flow、t-flow-<node>、以及分发范围内的 UI 设计 Skill），不干涉用户目录里的其它 Skill。
 {
  const own=new Set(['t-flow',...nodes.map(n=>'t-flow-'+n.id),...(UI_ROUTING?.distribution||[])]);
  const pairs=[[path.join(root,'.agents','skills'),path.join(root,'.claude','skills')]];
  for(const [agentRoot,claudeRoot] of pairs){
   if(!fs.existsSync(agentRoot))continue;
   for(const name of fs.readdirSync(agentRoot)){
    if(!own.has(name))continue;
    try{
     if(!fs.existsSync(path.join(agentRoot,name,'SKILL.md')))continue;
     if(fs.existsSync(path.join(claudeRoot,name)))continue;
     problems.push('Claude 入口缺失: '+path.join(claudeRoot,name)+'（实体在 '+path.join(agentRoot,name)+'）——重跑 install.mjs --apply，或手工建符号链接');
    }catch{/* 读取失败跳过 */ }
   }
  }
 }
 // 多 change：逐个未归档变更做体检；没有变更时提示可 init。
 const ids=CLI_CHANGE?[CLI_CHANGE]:changeIds();
 if(!ids.length)console.log('changes: 无未归档变更（init <change-id> 新建）');
 for(const cid of ids){
  const tag='['+cid+'] ';
  let s=null;try{s=JSON.parse(fs.readFileSync(stateFileOf(cid),'utf8'));}catch(e){problems.push(tag+'状态损坏: '+e.message+'；人工修复或删除 '+stateFileOf(cid));}
  if(!s)continue;
  try{configureProfile(s);}catch(e){problems.push(tag+e.message);continue;}
  if(fs.existsSync(safe(archiveJournal(cid))))problems.push(tag+'归档待恢复：--change '+cid+' archive');
  if(fs.existsSync(path.dirname(stateFileOf(cid))+'/write.lock'))problems.push(tag+'存在写入锁：等待命令结束，异常退出后核对主机/PID及子进程再清理遗留锁');
  const hashOk=s.workflow===protocol.name&&s.protocolHash===protocolHash();
  if(s.workflow!==protocol.name)problems.push(tag+'state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致');
  if(s.protocolHash!==protocolHash())problems.push(tag+'protocolHash 不匹配：运行 yt.mjs --change '+cid+' migrate 迁移');
  if(s.changeId!==cid)problems.push(tag+'状态内 changeId ('+s.changeId+') 与文件名不一致');
  if(s.currentNode&&!nodes.some(n=>n.id===s.currentNode))problems.push(tag+'currentNode 非法: '+s.currentNode);
  if((s.verifyFailures||0)>MAX_VERIFY_FAILURES)problems.push(tag+'验证-修复循环已超限（'+s.verifyFailures+' 次）：向用户展示失败历史，用户决策后用 decide <用户决策原文> 解除');
  for(const id of Object.keys(s.skipped||{})){const sn=nodes.find(n=>n.id===id);if(!sn)problems.push(tag+'跳过记录指向未知节点 '+id);else if(!sn.skippable)problems.push(tag+'不可跳过的节点存在跳过记录: '+id);}
  if(s.currentNode&&s.skipped?.[s.currentNode])problems.push(tag+'当前节点存在跳过记录: '+s.currentNode);
  const docdir=changeDocDir(cid);
  if(s.currentNode&&fs.existsSync(safe(docdir+'/ui.md'))){
   const rec=s.uiSkill||null;
   if(!s.skipped?.ui&&!rec&&nodes.findIndex(n=>n.id===s.currentNode)>nodes.findIndex(n=>n.id==='ui'))
    problems.push(tag+'ui.md 已产出但未记录所用设计 Skill：运行 --change '+cid+' ui-use <Skill名> 记录');
   if(rec&&!rec.used)problems.push(tag+'ui-use 记录缺少所用 Skill 名');
  }
  if(s.currentNode&&!fs.existsSync(safe(docdir)))problems.push(tag+'currentNode 非空但 '+docdir+' 目录缺失');
  if(!s.currentNode&&fs.existsSync(safe(docdir)))problems.push(tag+'已归档但 '+docdir+' 残留（上次归档清理中断），核实后手动删除');
  const docBase=s.currentNode?docdir:s.archivePath;
  for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(DOC_BASE+'/current/',docBase+'/'):p;if(ap.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(ap)))continue;if(!fs.existsSync(safe(ap)))problems.push(tag+'已完成节点 '+id+' 缺产物 '+ap);}}
  if(hashOk&&s.currentNode){
   for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;try{if(s.completedHashes?.[id]!==fingerprint(s,id))problems.push(tag+'已完成节点 '+id+' 的产物已变化，需 reopen '+id);}catch(e){problems.push(tag+'节点 '+id+' 指纹计算失败: '+e.message);}}
   for(const id of Object.keys(s.approvals||{})){if(!APPROVAL_NODES.includes(id))continue;try{if(s.approvals[id]?.fingerprint!==fingerprint(s,id))problems.push(tag+'节点 '+id+' 的用户确认已失效，需重新确认');}catch{}}
  }
  const newTasks=docdir+'/'+TASKS_PATH,taskFile=fs.existsSync(safe(newTasks))?newTasks:docdir+'/tasks.json';
  if(fs.existsSync(safe(taskFile))){try{json(taskFile);}catch(e){problems.push(tag+'tasks.json 损坏: '+e.message);}}
 }
 // 指针与目录一致性
 const act=activeId();
 if(act&&!fs.existsSync(stateFileOf(act)))problems.push('active 指针指向不存在的变更: '+act+'（use <change-id> 修正）');
 if(act&&fs.existsSync(stateFileOf(act))&&JSON.parse(fs.readFileSync(stateFileOf(act))).currentNode&&!fs.existsSync(safe(CHANGES_BASE+'/'+act)))problems.push('active 变更 '+act+' 的产物目录缺失: '+CHANGES_BASE+'/'+act);
 if(fs.existsSync(safe(CHANGES_BASE)))for(const d of fs.readdirSync(safe(CHANGES_BASE),{withFileTypes:true})){
  if(d.isDirectory()&&!fs.existsSync(stateFileOf(d.name)))problems.push('change/'+d.name+' 有目录但无状态文件（init 中断？删除该目录或补状态）');
 }
 if(problems.length){console.log('PROBLEMS:');for(const p of problems)console.log('- '+p);process.exitCode=1;}else console.log('OK');
}
try{
 if(CLI_CHANGE!==null)validId(CLI_CHANGE);
 if(['init','approve','decide','skip','advance','task','run','fix','ui-use','reopen','migrate','archive','promote'].includes(cmd)){
  const cid=cmd==='init'?arg:cmd==='migrate'&&fs.existsSync(LEGACY_STATE)?JSON.parse(fs.readFileSync(LEGACY_STATE)).changeId:activeId();
  if(cid){lockChange(cid);if(cmd!=='archive'&&fs.existsSync(safe(archiveJournal(cid))))throw Error('归档尚未完成，请先 --change '+cid+' archive 恢复');}
 }
 if(['init','use','resume'].includes(cmd)&&CLI_CHANGE&&CLI_CHANGE!==arg)throw Error('--change 与目标 change 不一致');
 if(fs.existsSync(LEGACY_STATE)&&!['help','migrate','doctor','changes','list'].includes(cmd))throw Error('检测到旧布局，请先运行 migrate 迁移 current');
 if(cmd==='help'){console.log(`yt.mjs [--change <id>] init <change-id> [--lite <理由>] | context [<任务id>] | promote <原因> | use <change-id> | resume <change-id> | changes [--json] | status [--all] [--json] | approve <node> [用户确认原文] | decide [用户决策原文] | skip <node> <原因> | check | advance | task <id> <status> | run <id> [--input <路径>]... [--expect <正则>]... [--reject <正则>]... [--min-output <字符数>] [--timeout <秒>] [--force] -- <命令> | fix <任务id> [--repair <项目内 Bash 脚本>] [验证参数] -- <测试命令> | ensure-skills | ui-routing | ui-use <Skill名> | handoff | doctor | reopen <node> | migrate | archive
fix 在 execute/verify/archive 共用 change 锁执行修复脚本和验证，只更新结果，不推进阶段或修改审批；脚本不得改写工作流文档或状态，范围变化须回到对应阶段确认。\n状态输出：run/task/approve/advance 等默认只打印紧凑 STATE 摘要；status --json 输出单个 change 的完整状态，status --all --json 输出全部 change 摘要。
确认节点: ${APPROVAL_NODES.join('/')}（产物变化后确认自动失效；确认/决策原文可经 stdin 传入）。可跳过节点（协议声明）: ${nodes.filter(n=>n.skippable).map(n=>n.id).join('/')||'无'}；skip design 仅提出原因；收到用户确认后 approve skip-design <用户原文> 才进入下一节点；skip ui 记录原因后跳过，reopen 前序节点会清除其后的跳过记录。
run 只在 execute/verify 可用，execute id 须为任务 id，modules 与 --input 指定的路径在执行时须存在。用 run 执行最终验证并记录最新结果，普通 Shell 用于调试。
验证仅输出结果摘要，不生成日志或证据文件；最新结果与输入指纹保存在现有 state.json；task done 须有最新通过结果，不需要证据参数，测试报告只保留真实结果。
断言：--expect <正则> 要求输出命中（可重复多次，各项都必须命中）；--reject <正则> 任一命中即失败。直接调用 Bash 时自动启用 errexit/pipefail 并让嵌套 Bash 继承，不能让管道或 echo 成功标记吞掉失败；其他解释器需自行保证退出码。--min-output 要求输出不少于 N 字符；与退出码同时满足才算 passed。run 不校验命令语义，请自行确保命令真实覆盖被测内容。参数校验在命令执行前完成。
验收覆盖：PRD 声明 AC-NN-N 时，test-results.json 用例须用 acceptance 逐条覆盖全部 AC；未测/可选用例不计覆盖。重复用例 ID 和未知 AC 会被拒绝。
需求覆盖：prd.md 里的需求编号（模式 ${REQ_PATTERN}）必须被 test-results.json 中已通过必测用例的 id 覆盖，缺项阻断 verify；不使用编号的项目置 config.requireCoverage:false。
从 verify 回退且存在 failed 测试才计验证-修复次数，超过 ${MAX_VERIFY_FAILURES} 次停止并要求用户决策，decide 记录用户决策原文后解除。协议文件变更后对每个未归档变更运行 --change <id> migrate。多 change：各变更独立目录 docs/t-flow/change/<id>/ 与状态，互不干扰、可并行推进；并行会话每条命令固定使用 --change <id> 前缀；init 新建、resume/use 选择继续目标、changes/list 查看进度和状态。
UI 设计 Skill：主 ${UI_ROUTING?UI_ROUTING.primary:'ui-ux-pro-max'}，兜底 ${UI_ROUTING?UI_ROUTING.fallback:'frontend-design'}（ui-routing 查看；ui-use <Skill名> 记录实际所用）。缺失时运行 ensure-skills 自动安装到项目 .agents/skills/ 并链接 .claude/skills/（Claude 与 agent 两条发现路径都可用）。
ui.md 须含 ${UI_SCOPE_BLOCK} 声明块。新建界面的实现路径在 verify/archive 检查；存量改造（mode: change）必须列 affected。原型与评审截图参与确认指纹。
Spec 合并目标前缀: ${SPEC_PREFIX}（protocol config 可改；无正式 Spec 的项目置 specSyncRequired:false）。项目根: TFLOW_RUN_ROOT 或 cwd。归档前必须人工验收；不会自动提交或发布代码。`);}
 else if(cmd==='ensure-skills'){
  const results=ensureUiSkills({auto:true});
  for(const r of results)console.log((r.available?'OK   ':'FAIL ')+r.name+': '+r.action);
  const bad=results.filter(r=>!r.available);
  if(bad.length){console.error('BLOCKED: 以下 Skill 仍不可用: '+bad.map(b=>b.name).join(', '));process.exitCode=1;}
  else console.log('UI 设计 Skill 就位（项目 .agents/skills/ 与 .claude/skills/ 均可发现）。');
 }
 else if(cmd==='ui-routing'){
  const r=uiRouting();
  console.log('UI 设计 Skill（改动 protocol 即需 migrate）：');
  for(const l of r.lines)console.log('  '+l);
  if(UI_ROUTING.source)console.log('  来源: '+UI_ROUTING.source+(UI_ROUTING.license?'（'+UI_ROUTING.license+'）':''));
  console.log('  '+(UI_ROUTING.primaryNote||''));
  console.log('  '+(UI_ROUTING.fallbackNote||''));
  if(UI_ROUTING.fiveStatesRequired)console.log('  '+(UI_ROUTING.fiveStatesNote||''));
 }
 else if(cmd==='ui-use'){
  const s=state();
  if(s.currentNode!=='ui')throw Error('只能在 ui 节点记录设计 Skill（当前 '+s.currentNode+'）');
  const primary=UI_ROUTING.primary,fallback=UI_ROUTING.fallback;
  const primaryOk=skillAvailable(primary);
  // 参数：允许显式指定实际所用 Skill（如 ui-use frontend-design）
  const used=arg?.trim();
  if(!used)throw Error('请先让用户选择：跳过 UI / '+primary+' / '+fallback+'；ui-use 必须显式提供 Skill 名');
  if(used!==primary&&used!==fallback)throw Error('所用 Skill 须为 '+primary+' 或 '+fallback+'（协议 uiSkillRouting 可改，改了需 migrate）');
  if(!skillAvailable(used)){
   const res=ensureUiSkills({auto:true});
   const one=res.find(r=>r.name===used);
   console.log('AUTO: '+(one?one.action:'已尝试自动安装 '+used));
   if(!skillAvailable(used))throw Error('Skill '+used+' 仍不可用：'+((one||{}).action||'请手动放置'));
  }
  if(s.uiSkill?.used!==used)delete s.approvals.ui;
  s.uiSkill={used,primary,primaryAvailable:primaryOk,at:new Date().toISOString()};
  save(s,'ui-use '+used);print(s);
  console.log('USED: '+used+(used===primary?'（主 Skill）':'（兜底 Skill；主 Skill '+primary+(primaryOk?'可用但你选择了兜底':'不可用')+'）'));
  if(used!==primary)console.log('WARN: 未使用主 Skill '+primary+'，请在 ui.md 说明原因并自行补齐五态与实测结论');
 }
 else if(cmd==='doctor'){doctor();}
 else if(cmd==='init'){
  validId(arg);
  if(value&&value!=='--lite')throw Error('init 仅支持 --lite <适用理由>');
  if(value==='--lite'&&!extra.join(' ').trim())throw Error('轻量模式须记录适用理由：无新功能/权限规则/接口契约/数据迁移');
  configureProfile({profile:value==='--lite'?'lite':'full'});
  if(fs.existsSync(stateFileOf(arg)))throw Error('变更 '+arg+' 已存在（use '+arg+' 聚焦，或换一个 id）');
  const docdir=changeDocDir(arg);
  if(fs.existsSync(safe(DOC_BASE+'/archive/'+arg)))throw Error('归档目录已存在，请使用新的 change-id');
  if(fs.existsSync(safe(DOC_BASE+'/current')))throw Error('旧 current 尚未迁移，先核对其任务归属');
  if(fs.existsSync(safe(docdir)))throw Error(docdir+' 已存在，先检查已有文档，不自动覆盖');
  const s={schemaVersion:1,profile,profileReason:value==='--lite'?extra.join(' '):undefined,workflow:protocol.name,protocolHash:protocolHash(),changeId:arg,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0,history:[]};
  fs.mkdirSync(safe(docdir),{recursive:true});setActive(arg);save(s,'init');print(s);
  console.log('CHANGES: 本项目可有多个并行变更；changes 查看，use <id> 切换。');
 }else if(cmd==='use'||cmd==='resume'){
  if(!fs.existsSync(stateFileOf(arg||'')))throw Error('变更 '+(arg||'')+' 不存在（changes 查看列表）');
  const selected=readState(arg);if(!selected.currentNode)throw Error('变更已归档');setActive(arg);print(selected);
 }else if(cmd==='changes'||cmd==='list'||cmd==='status'&&arg==='--all'){
  listChanges();
 }else if(cmd==='migrate'){
  if(fs.existsSync(LEGACY_STATE)){migrateLegacy();process.exit(0);}
  const cid=activeId();if(!cid)throw Error('未聚焦任何变更：--change <change-id> migrate');
  const sf=stateFileOf(cid);
  if(!fs.existsSync(sf))throw Error('变更 '+cid+' 不存在');
  // migrate 的职责就是修复版本不一致，因此这里只读原始状态、不做 protocolHash 校验。
  const s=JSON.parse(fs.readFileSync(sf,'utf8'));
  if(s.changeId!==cid)throw Error('状态 changeId 与目录不一致: '+cid);
  configureProfile(s);
  if(s.workflow!==protocol.name)throw Error('state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致，无法自动迁移');
  if(s.protocolHash===protocolHash())throw Error('协议未变化，无需迁移');
  const docBase=s.currentNode?changeDocDir(s.changeId):s.archivePath;
  for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(DOC_BASE+'/current/',docBase+'/'):p;if(ap.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(ap)))continue;if(!fs.existsSync(safe(ap))||!read(ap).trim())throw Error('产物缺失或为空 '+ap+'，修复后重新 migrate');}}
  // 先使用旧协议指纹检查原有绑定，避免迁移替改动过的产物重新背书。
  if(s.currentNode){
   const changed=nodes.findIndex((n,i)=>{
    if(i<nodes.findIndex(x=>x.id===s.currentNode)&&!s.completedNodes.includes(n.id)&&!s.skipped?.[n.id])return true;
    if(n.id==='design'&&s.skipped?.design&&!s.skipped.design.quote)return true;
    if(n.id==='execute'&&s.completedNodes.includes(n.id)){try{for(const t of tasks())validateTaskRun(s,t.id);}catch{return true;}}
    if(!s.completedNodes.includes(n.id)&&!s.approvals[n.id])return false;
    try{return (s.completedNodes.includes(n.id)&&s.completedHashes[n.id]!==fingerprint(s,n.id)) || (s.approvals[n.id]&&s.approvals[n.id].fingerprint!==fingerprint(s,n.id)) || (s.completedNodes.includes(n.id)&&n.approval&&!s.approvals[n.id]);}catch{return true;}
   });
   if(changed>=0){
    s.currentNode=nodes[changed].id;s.completedNodes=s.completedNodes.filter(id=>nodes.findIndex(n=>n.id===id)<changed);
    if(changed<=nodes.findIndex(n=>n.id==='ui'))delete s.uiSkill;
    for(const n of nodes.slice(changed)){delete s.approvals[n.id];delete s.completedHashes[n.id];if(s.skipped)delete s.skipped[n.id];}
    s.history.push({action:'migrate reopen '+s.currentNode,at:new Date().toISOString()});
   }
  }
  s.protocolHash=protocolHash();
  if(s.currentNode){
   for(const id of s.completedNodes||[]){if(nodes.some(n=>n.id===id))s.completedHashes[id]=fingerprint(s,id);}
   for(const id of Object.keys(s.approvals||{})){if(nodes.some(n=>n.id===id))s.approvals[id].fingerprint=fingerprint(s,id);}
  }
  if(s.currentNode){delete s.pendingSkip;retainFutureArtifacts(s);}
  save(s,'migrate');print(s);
 }else{
  const s=state();
  if(cmd==='archive')archiveChange(s);
  else if(cmd==='status')print(s);
  else if(cmd==='context')console.log(JSON.stringify(context(s),null,2));
  else if(fs.existsSync(safe(archiveJournal(s.changeId))))throw Error('归档尚未完成，请先 archive 恢复');
  else if(cmd==='handoff'){
   if(!s.currentNode)throw Error('变更已归档');
   console.log('# handoff '+s.changeId+' @ '+s.currentNode);
   const idx=nodes.findIndex(n=>n.id===s.currentNode);
   for(const p of [...new Set(nodes.slice(0,idx+1).flatMap(files).map(pp=>mapArt(s.changeId,pp)))])console.log('- '+p+' '+(fs.existsSync(safe(p))?contentHash(p):'MISSING'));
  }
  else if(cmd==='promote'){
   validateStageArtifacts(s);
   if(s.profile!=='lite'||!s.currentNode)throw Error('仅未归档轻量变更可升级');
   if(!arg?.trim())throw Error('promote 需要范围升级原因');
   s.profile='full';configureProfile(s);s.currentNode=nodes[0].id;
   s.completedNodes=[];s.completedHashes={};s.approvals={};s.skipped={};delete s.pendingSkip;delete s.validation;retainFutureArtifacts(s);
   save(s,'promote '+arg);print(s);
  }
  else if(cmd==='reopen'){
   validateStageArtifacts(s);
   const i=nodes.findIndex(n=>n.id===arg);if(i<0||!s.currentNode)throw Error('无法重新打开');
   const currentIndex=nodes.findIndex(n=>n.id===s.currentNode);if(i>currentIndex)throw Error('不能跳过阶段');
   if(s.currentNode==='verify'&&i<currentIndex){
    let failed=true;try{failed=json(docDir()+'/'+TEST_RESULTS_PATH).tests?.some(t=>t.status==='failed')??true;}catch{}
    if(failed){s.verifyFailures=(s.verifyFailures||0)+1;if(s.verifyFailures>MAX_VERIFY_FAILURES){save(s,'verify-loop-blocked');throw Error('验证-修复循环已达 '+MAX_VERIFY_FAILURES+' 次：停止自动重试，向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除');}}
   }
   if(i<=nodes.findIndex(n=>n.id==='ui'))delete s.uiSkill;
   s.currentNode=arg;s.completedNodes=s.completedNodes.filter(id=>nodes.findIndex(n=>n.id===id)<i);for(const n of nodes.slice(i)){delete s.approvals[n.id];delete s.completedHashes[n.id];if(s.skipped)delete s.skipped[n.id];}delete s.pendingSkip;retainFutureArtifacts(s);save(s,'reopen '+arg);print(s);
  }else{
   drift(s);if(!s.currentNode)throw Error('变更已归档');
   if(cmd==='approve'){
    const quote=value??readStdin();
    if(arg==='skip-design'){
     if(s.currentNode!=='design'||!s.pendingSkip||!quote?.trim())throw Error('先 skip design <原因> 展示跳过理由，收到用户确认后 approve skip-design <用户原文>');
     if(s.pendingSkip.fingerprint!==fingerprint(s,'design'))throw Error('跳过 Design 的输入已变化，请重新提出原因并确认');
     (s.skipped=s.skipped||{}).design={reason:s.pendingSkip.reason,quote:quote.trim(),at:new Date().toISOString()};
     delete s.pendingSkip;delete s.approvals.design;s.currentNode=nodes[nodes.findIndex(n=>n.id==='design')+1].id;
     save(s,'approve skip-design');print(s);
    }else{
     if(arg!==s.currentNode||!APPROVAL_NODES.includes(arg)||!quote?.trim())throw Error('只可为当前确认节点记录用户确认原文（可经 stdin 传入）');
     validate(s,arg,{approval:false});s.approvals[arg]={quote:quote.trim(),fingerprint:fingerprint(s,arg),at:new Date().toISOString()};delete s.pendingSkip;save(s,'approve '+arg);print(s);
    }
   }else if(cmd==='decide'){
    const quote=arg??readStdin();
    if(!quote?.trim())throw Error('decide 需要用户决策原文（可经 stdin 传入）');
    if((s.verifyFailures||0)<=MAX_VERIFY_FAILURES)throw Error('验证-修复循环未超限，无需 decide');
    s.verifyFailures=0;(s.decisions=s.decisions||[]).push({quote:quote.trim(),at:new Date().toISOString()});save(s,'decide');print(s);
   }else if(cmd==='skip'){
    const n=node(arg);if(!n.skippable)throw Error('节点不可跳过 '+arg+'（可跳过: '+(nodes.filter(x=>x.skippable).map(x=>x.id).join('/')||'无')+'）');
    if(arg!==s.currentNode)throw Error('只能跳过当前节点 '+s.currentNode);
    if(!value?.trim())throw Error('skip 必须记录原因');
    if(arg==='design'){
     s.pendingSkip={reason:value.trim(),fingerprint:fingerprint(s,'design')};save(s,'request skip design');
     console.log('ARTIFACTS_READY: 等待用户确认跳过 Design，收到确认后 approve skip-design <用户原文>');print(s);
    }else{
    if(arg==='ui')delete s.uiSkill;
    (s.skipped=s.skipped||{})[arg]={reason:value.trim(),at:new Date().toISOString()};delete s.approvals[arg];
    s.currentNode=nodes[nodes.findIndex(x=>x.id===arg)+1]?.id??null;save(s,'skip '+arg);print(s);
    }
   }else if(cmd==='run'||cmd==='fix'){
    const fixing=cmd==='fix';
    if(!(fixing?['execute','verify','archive']:['execute','verify']).includes(s.currentNode))throw Error(fixing?'快速修复仅用于 execute/verify/archive 阶段':'只有 execute/verify 阶段可执行验证');
    if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(arg||''))throw Error('验证 id 使用字母数字和连字符');
    const rest=_argv.slice(2),sep=rest.indexOf('--');
    if(sep<0||sep===rest.length-1)throw Error('用法: run <id> [--input <路径>]... [--expect <正则>]... [--reject <正则>]... [--min-output <字符数>] [--timeout <秒>] [--force] -- <命令>');
    const flags=rest.slice(0,sep),cmdArgs=rest.slice(sep+1),extraInputs=[];
    let timeoutMs=30*60*1000,expects=[],rejects=[],minOutput=0,repair=null;
    for(let i=0;i<flags.length;i++){
     if(flags[i]==='--force')continue;
     else if(fixing&&flags[i]==='--repair'&&flags[i+1])repair=flags[++i];
     else if(flags[i]==='--input'&&flags[i+1])extraInputs.push(flags[++i]);
     else if(flags[i]==='--expect'&&flags[i+1])expects.push(flags[++i]);
     else if(flags[i]==='--reject'&&flags[i+1])rejects.push(flags[++i]);
     else if(flags[i]==='--min-output'&&flags[i+1]){const n=Number(flags[++i]);if(!Number.isSafeInteger(n)||n<0)throw Error('--min-output 需为非负数');minOutput=n;}
     else if(flags[i]==='--timeout'&&flags[i+1]){const sec=Number(flags[++i]);if(!Number.isFinite(sec)||!Number.isSafeInteger(sec*1000)||sec<=0)throw Error('--timeout 需为正数秒');timeoutMs=sec*1000;}
     else throw Error('无法识别的参数 '+flags[i]);
    }
    const patterns=expects.map(pat=>{try{return new RegExp(pat,'m');}catch(e){throw Error('--expect 不是合法正则: '+pat+' ('+e.message+')');}});
    const rejectPatterns=rejects.map(pat=>{try{return new RegExp(pat,'m');}catch(e){throw Error('--reject 不是合法正则: '+pat+' ('+e.message+')');}});
    // Bash 包装的测试必须传播管道和中间命令的失败，嵌套 Bash 通过导出的 SHELLOPTS 继承。
    const bash=path.basename(cmdArgs[0])==='bash';
    if(bash)cmdArgs.splice(1,0,'-e','-o','pipefail');
    const runEnv=bash||repair?{...process.env,SHELLOPTS:[...new Set([...(process.env.SHELLOPTS||'').split(':').filter(Boolean),'errexit','pipefail'])].join(':')}:process.env;
    const command=cmdArgs.map(shellQuote).join(' ');
    const commandSecrets=secretFindings(command);if(commandSecrets.length)throw Error('命令包含疑似凭证（'+commandSecrets.join(', ')+'），已拒绝执行；请改用环境变量，不回显匹配内容');
    const task=fixing||s.currentNode==='execute'?tasks().find(t=>t.id===arg):null;
    if((fixing||s.currentNode==='execute')&&!task)throw Error('未找到任务 '+arg);
    for(const p of [...extraInputs,...(task?.modules||[])])if(!(fixing&&repair)&&!fs.existsSync(safe(p)))throw Error('输入路径不存在 '+p);
    if(repair&&!fs.statSync(safe(repair)).isFile())throw Error('修复脚本必须是项目内真实文件');
    const related=fixing?Object.entries(s.validation||{}).filter(([,r])=>r.node==='verify'&&r.acceptance?.length&&r.acceptance.every(ac=>task.acceptance.includes(ac))):[];
    const keys=fixing?['execute:'+arg,...related.map(([key])=>key)]:[s.currentNode+':'+arg];
    const roots=validationRoots(s,task,[...extraInputs,...related.flatMap(([,r])=>Object.keys(r.inputs||{})).filter(p=>fs.existsSync(safe(p)))]);
    const acceptance=task?.acceptance||[...new Set((read(docDir()+'/prd.md').match(/\bAC-\d+-\d+\b/g)||[]).filter(ac=>(arg.match(/REQ-\d+/g)||[]).includes('REQ-'+ac.split('-')[1])))];
    const protectedDocs=fixing?treeManifest(docDir()):null;
    for(const key of keys){const [node,id]=key.split(':');(s.validation=s.validation||{})[key]={id,node,status:'not_run',acceptance:s.validation?.[key]?.acceptance||acceptance,inputs:inputSnapshot(roots)};}
    save(s);
    const protectedState=fixing?sha(fs.readFileSync(stateFileOf(s.changeId))):null;
    const started=Date.now();
    const repaired=repair?spawnSync('bash',['-e','-o','pipefail',safe(repair)],{cwd:root,env:runEnv,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024}):null;
    const repairPassed=!repaired||(repaired.status===0&&!repaired.error&&!secretFindings((repaired.stdout||'')+'\n'+(repaired.stderr||'')).length);
    const contractsUnchanged=()=>!fixing||(isDeepStrictEqual(protectedDocs,treeManifest(docDir()))&&protectedState===sha(fs.readFileSync(stateFileOf(s.changeId))));
    let contractsValid=false;try{contractsValid=contractsUnchanged();}catch{}
    const inputs=contractsValid?inputSnapshot(roots):s.validation[keys[0]].inputs;
    const inputsPresent=[...extraInputs,...(task?.modules||[])].every(p=>fs.existsSync(safe(p)));
    const remaining=timeoutMs-(Date.now()-started);
    const r=repairPassed&&contractsValid&&inputsPresent&&remaining>0?spawnSync(cmdArgs[0],cmdArgs.slice(1),{cwd:root,env:runEnv,encoding:'utf8',timeout:remaining,maxBuffer:64*1024*1024}):{status:1};
    const durationMs=Date.now()-started;
    const out=(r.stdout||'')+'\n'+(r.stderr||''),repairOut=(repaired?.stdout||'')+'\n'+(repaired?.stderr||''),outputSecrets=secretFindings(out+'\n'+repairOut);
    // 断言：退出码 0 且全部 --expect 模式命中、输出量达标，才算 passed。
    const unmet=expects.filter((pat,i)=>!patterns[i].test(out));
    const rejected=rejects.filter((pat,i)=>rejectPatterns[i].test(out));
    const bodyLen=out.trim().length;
    let inputsUnchanged=false;try{inputsUnchanged=isDeepStrictEqual(inputs,inputSnapshot(roots));}catch{}
    try{contractsValid=contractsUnchanged();}catch{contractsValid=false;}
    const ok=repairPassed&&contractsValid&&inputsPresent&&r.status===0&&!r.error&&!unmet.length&&!rejected.length&&!outputSecrets.length&&bodyLen>=minOutput&&inputsUnchanged;
    for(const key of keys){const previous=s.validation[key];s.validation[key]={id:previous.id,node:previous.node,status:ok?'passed':'failed',acceptance:previous.acceptance,inputs,exitCode:r.status,at:new Date().toISOString()};}
    if(fixing&&contractsValid&&['verify','archive'].includes(s.currentNode))updateFixResults(s,task,ok);
    save(s);
    if(!ok&&!outputSecrets.length){
     const detail=[repaired?.error?.message,r.error?.message,!contractsValid?'修复改变了工作流文档或状态；停止快速修复，回到对应阶段重新确认':'',!inputsPresent?'修复后验证输入缺失，请检查任务实现范围':'',!inputsUnchanged?'验证期间输入发生变化，请重测':'',bodyLen<minOutput?'输出长度未达到要求':'',repairOut.trim(),out.trim()].filter(Boolean).join('\n');
     console.error('FAILURE_DETAIL:\n'+detail.slice(-4000));
    }
    if(outputSecrets.length)console.error('SECRET_OUTPUT_BLOCKED: 输出包含疑似凭证，仅显示规则名: '+outputSecrets.join(', '));
    console.log('STATUS: '+(ok?'passed':'failed'));
    console.log('SUMMARY: '+JSON.stringify({status:ok?'passed':'failed',exitCode:r.status,signal:r.signal||null,durationMs,assertions:{passed:expects.length-unmet.length+rejects.length-rejected.length,failed:unmet.length+rejected.length},failedPatterns:[...unmet,...rejected]}));
    if(!ok)process.exitCode=1;
   }else if(cmd==='task'){
    if(s.currentNode!=='execute')throw Error('只有执行阶段可更新任务');
    const ts=tasks(),t=ts.find(x=>x.id===arg);if(!t||!['pending','in_progress','blocked','done'].includes(value))throw Error('任务或状态非法');
    if(['in_progress','done'].includes(value)&&t.dependsOn.some(d=>ts.find(x=>x.id===d).status!=='done'))throw Error('任务依赖未完成');
    if(value==='done')validateTaskRun(s,arg);
    delete t.evidence;
    if(t.status==='done'&&value!=='done'&&ts.some(x=>x.dependsOn.includes(t.id)&&x.status==='done'))throw Error('先重开依赖本任务的已完成任务');
    t.status=value;write(docDir()+'/'+TASKS_PATH,ts);save(s,'task '+arg+'='+value);print(s);
   }else if(['check','advance'].includes(cmd)){
    validate(s,s.currentNode,{approval:cmd!=='check'});
    if(cmd==='check'){warnUncontrolledChangeFiles(s.changeId);console.log(APPROVAL_NODES.includes(s.currentNode)&&s.approvals[s.currentNode]?.fingerprint!==fingerprint(s,s.currentNode)?'ARTIFACTS_READY: 等待用户确认':'READY');print(s);}
    else if(s.currentNode==='archive'){throw Error('归档请运行 archive');
    }else{
     const from=s.currentNode;if(from==='verify')s.verifyFailures=0;
     s.completedHashes[from]=fingerprint(s,from);s.completedNodes.push(from);s.currentNode=nodes[nodes.findIndex(n=>n.id===from)+1]?.id??null;save(s,'advance '+from);print(s);
    }
   }else throw Error('未知命令 '+cmd);
  }
 }
}catch(e){console.error('BLOCKED: '+e.message);process.exitCode=1;}
