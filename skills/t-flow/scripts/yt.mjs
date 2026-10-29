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
const nodes=protocol.nodes.filter(n=>!n.disabled);
const cfg=protocol.config||{};
const SPEC_PREFIX=cfg.specTargetPrefix??'openspec/specs/';
const SPEC_REQUIRED=cfg.specSyncRequired!==false;
// 需求编号模式与覆盖校验：PRD 里的需求编号必须被 test-results.json 中已通过必测用例的 id 覆盖，
// 否则"必测项"完全由被测方自定义，需求与测试之间没有可追溯性（历史缺陷）。
const REQ_PATTERN=cfg.requirementIdPattern??'REQ-\\d+';
const REQ_COVERAGE=cfg.requireCoverage!==false;
// 存量项目 UI 变更：样式层文件模式。UI 变更的证据若完全没绑到这些模式，
// 说明主题/样式改动不会被"证据过期"检出（历史缺陷）。
const UI_CHANGE=protocol.uiChange||null;
const STYLE_WARN=UI_CHANGE?.styleWarnEnabled!==false&&!!UI_CHANGE;
// 轻量 glob：支持 ** 、* 、? 与 {a,b}，用于匹配样式文件模式。
// 注意：先把 glob 元字符转成占位符，再转义字面量，最后还原——否则 {} 展开出的
// 分组括号会被后续转义步骤破坏。
function matchStyleGlob(rel){
 if(!UI_CHANGE?.styleGlobs?.length)return false;
 const p=rel.split(path.sep).join('/');
 for(const g of UI_CHANGE.styleGlobs){
  const rx='^'+g
   .replace(/\{([^}]*)\}/g,(_,inner)=>'\u0001'+inner.split(',').map(s=>s.trim()).join('\u0002')+'\u0003')
   .replace(/\*\*\//g,'\u0000').replace(/\*/g,'\u0004').replace(/\?/g,'\u0005')
   .replace(/[.+^$()|[\]\\]/g,'\\$&')
   .replace(/\u0000/g,'(?:.*/)?').replace(/\u0004/g,'[^/]*').replace(/\u0005/g,'[^/]')
   .replace(/\u0001/g,'(?:').replace(/\u0002/g,'|').replace(/\u0003/g,')')
   +'$';
  try{if(new RegExp(rx).test(p))return true;}catch{/* 模式非法则跳过 */}
 }
 return false;
}
// --change <id> 全局覆盖：显式指定本次命令作用的变更（脚本化友好）；否则用 active 指针。
const _argv=process.argv.slice(2);
// 仅识别命令前缀，run 的子命令参数保持原样。
let CLI_CHANGE=null;
if(_argv[0]==='--change'){CLI_CHANGE=_argv[1];_argv.splice(0,2);}
const [cmd='help',arg,value,...extra]=_argv;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// 确认门禁与验证-修复上限均由协议声明（改动这些值会改变 protocolHash，进行中变更需 migrate）。
const APPROVAL_NODES=nodes.filter(n=>n.approval).map(n=>n.id), MAX_VERIFY_FAILURES=cfg.maxVerifyFailures??3;
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
 return s;
}
function writeStateFile(s){const f=stateFileOf(s.changeId);fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,f);}
// 当前聚焦 change 的产物目录（替代原 current 常量）与状态读写。
function docDir(){const cid=activeId();if(!cid)throw Error('未聚焦任何变更：use <change-id> 或 init <change-id>');return changeDocDir(cid);}
const logsDir=()=>docDir()+'/logs', evDir=()=>docDir()+'/evidence';
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
   // 路径参与确认和证据指纹，保留历史，从澄清重新确认并重新验证。
   s={...legacy,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0};delete s.uiSkill;
  }
  s.protocolHash=protocolHash();save(s,'migrate layout');
 }
 if(s.currentNode)setActive(cid);
 fs.renameSync(LEGACY_STATE,LEGACY_STATE+'.legacy-'+Date.now());
 print(s);console.log('旧文档和历史保留；产物内 current 路径需更新，确认与验证须重新执行。');
}

function state(){const cid=activeId();if(!cid)throw Error('未聚焦任何变更：use <change-id> 或 init <change-id>');return readState(cid);}
function save(s,action){if(action)s.history.push({action,at:new Date().toISOString()});s.updatedAt=new Date().toISOString();writeStateFile(s);}
function node(id){const n=nodes.find(n=>n.id===id);if(!n)throw Error('未知节点 '+id);return n;}
function files(n){return n.outputSchemas.flatMap(id=>{const schema=protocol.outputSchemas.find(x=>x.id===id);if(!schema)throw Error('缺少 schema '+id);return schema.artifacts.filter(a=>a.required).flatMap(a=>a.paths);});}
function contentHash(p){return p.endsWith('/tasks.json')?sha(JSON.stringify(json(p).map(({status,evidence,...rest})=>rest))):sha(fs.readFileSync(safe(p)));}
function fingerprint(s,id){
 const end=nodes.findIndex(n=>n.id===id),paths=nodes.slice(0,end+1).flatMap(files).map(p=>mapArt(s.changeId,p));
 const ui=changeDocDir(s.changeId)+'/ui.md';
 if(end>=nodes.findIndex(n=>n.id==='ui')&&!s.skipped?.ui&&fs.existsSync(safe(ui)))paths.push(...(parseUiScope(read(ui))?.prototypes||[]));
 return sha(JSON.stringify({changeId:s.changeId,protocol:s.protocolHash,files:[...new Set(paths)].map(p=>[p,fs.existsSync(safe(p))?contentHash(p):null])}));
}
function tasks(){const t=json(docDir()+'/tasks.json');if(!Array.isArray(t)||!t.length)throw Error('tasks.json 必须是非空数组');const ids=new Set(t.map(x=>x.id));if(ids.size!==t.length)throw Error('任务 ID 重复');for(const x of t){if(!x.id||!x.title||!Array.isArray(x.dependsOn)||!Array.isArray(x.acceptance)||!x.acceptance.length||!['pending','in_progress','blocked','done'].includes(x.status))throw Error('任务字段不完整 '+x.id);
 // modules 必须是非空字符串数组：证据输入绑定依赖它，留空等于让"证据过期"失效（见 README 机制边界）。
 if(!Array.isArray(x.modules)||!x.modules.length||x.modules.some(m=>typeof m!=='string'||!m.trim()))throw Error('任务 '+x.id+' 的 modules 必须是非空路径数组（证据输入绑定依赖它）');
 if(x.dependsOn.some(d=>!ids.has(d)||d===x.id))throw Error('任务依赖非法 '+x.id);}const seen=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('任务依赖循环');if(seen.has(id))return;active.add(id);t.find(x=>x.id===id).dependsOn.forEach(visit);active.delete(id);seen.add(id);}t.forEach(x=>visit(x.id));return t;}
// 读取某 id 的全部真实执行记录（attempts/<id>/<runId>.json），用于阶段隔离与留痕核对。
function attemptsOf(id){
 const dir=evDir()+'/attempts/'+id;if(!fs.existsSync(safe(dir)))return [];
 const out=[];
 for(const f of fs.readdirSync(safe(dir))){if(!f.endsWith('.json'))continue;try{out.push(json(dir+'/'+f));}catch{}}
 return out;
}
// 证据校验：既校验内容，也校验「这份内容确实来自它声称的那次执行」。
// 仅比对固定路径自身会恒等成立（e 就是该路径读出的对象），因此必须交叉核对：
//   1) 调用方传入的 evidencePath 中的 id      == 内容里的 e.id
//   2) attempts/<id>/<runId>.json 存在          （真实执行留痕）
//   3) 固定路径内容 == attempts 记录内容        （防止只改固定路径）
function validateEvidence(e,s,{path:evPath}={}){
 if(e.schemaVersion!==2)throw Error('旧版验证证据需重新运行 run');
 if(!e.id||!e.runId)throw Error('验证证据字段缺失或未通过');
 // (1) 路径 id 必须与内容 id 一致：否则是把 A 的证据复制成 B 的文件名冒充 B。
 if(evPath){
  const m=new RegExp('^'+CHANGES_BASE.replace(/\//g,'\\/')+'\\/([^/]+)\\/evidence\\/([^/]+)\\.json$').exec(evPath.split(path.sep).join('/'));
  if(!m||m[1]!==s.changeId)throw Error('证据路径必须是 '+CHANGES_BASE+'/<change-id>/evidence/<id>.json');
  if(m[2]!==e.id)throw Error('证据文件与内容 id 不一致（路径 '+m[2]+'，内容 '+e.id+'）：请重新运行 run '+m[2]);
 }
 // (2)(3) 必须有对应的 attempts 记录，且内容与固定路径一致。
 const ap=evDir()+'/attempts/'+e.id+'/'+e.runId+'.json';
 if(!fs.existsSync(safe(ap)))throw Error('缺少该证据的执行记录 '+ap+'：证据须由 run '+e.id+' 真实生成，不能复制或手写');
 let stored;try{stored=json(ap);}catch(err){throw Error('执行记录损坏 '+ap+': '+err.message);}
 if(json(evDir()+'/'+e.id+'.json').runId!==e.runId)throw Error('验证证据不是最新执行结果');
 if(e.changeId!==s.changeId||e.status!=='passed'||!e.command||!e.recordedAt||!e.inputs||!Object.keys(e.inputs).length)throw Error('验证证据字段缺失或未通过');
 for(const [p,entries]of Object.entries(e.directories||{})){
  if(JSON.stringify(expandInput(p).map(([rel])=>rel).sort())!==JSON.stringify(entries))throw Error('验证证据目录已变化: '+p);
 }
 for(const [p,h]of Object.entries(e.inputs)){if(sha(fs.readFileSync(safe(p)))!==h)throw Error('验证证据过期: '+p);}
 if(!e.log||!e.log.split(path.sep).join('/').startsWith(logsDir()+'/'))throw Error('证据日志必须位于 '+logsDir()+'/ 下');
 if(!isDeepStrictEqual(stored,e))throw Error('执行记录与证据不匹配: '+ap);
 if(!read(e.log).trim())throw Error('缺少验证日志');
 if(!e.logHash)throw Error('旧证据缺少日志摘要，请重新 run '+e.id);
 if(sha(fs.readFileSync(safe(e.log)))!==e.logHash)throw Error('验证日志已变化: '+e.log);
}
function testResult(s){const r=json(docDir()+'/test-results.json');if(r.changeId!==s.changeId||!Array.isArray(r.tests)||!r.tests.length)throw Error('缺少本次测试结果');if(new Set(r.tests.map(t=>t.id)).size!==r.tests.length)throw Error('用例 ID 重复');for(const t of r.tests){if(typeof t.required!=='boolean'||!['passed','failed','not_run'].includes(t.status))throw Error('测试结果非法');if(t.status==='failed')throw Error('测试失败 '+t.id);if(t.required&&t.status!=='passed')throw Error('必测项未通过 '+t.id);if(t.status==='passed'){
  // verify 用例必须由 verify 阶段自己执行：不得复用 execute 阶段的任务证据，
  // 否则"测试"可能从未作为测试运行过（历史缺陷）。
  // 判据是「被引用证据所属 id 的执行阶段」，且只看该 runId 那次执行，避免同一 id
  // 在两个阶段都被合法使用时误伤。
  const m=new RegExp('^'+CHANGES_BASE.replace(/\//g,'\\/')+'\\/([^/]+)\\/evidence\\/([^/]+)\\.json$').exec(String(t.evidence).split(path.sep).join('/'));
  if(m&&m[2]!==String(t.id))throw Error('用例 '+t.id+' 引用了 '+m[2]+' 的证据：请用 run '+t.id+' 执行该用例本身');
  const cur=m?json(evDir()+'/'+m[2]+'.json'):null;
  const rec=(m&&cur)?attemptsOf(m[2]).find(r=>r.runId===cur.runId):null;
  if(rec&&rec.node&&rec.node!=='verify')throw Error('用例 '+t.id+' 复用了 '+rec.node+' 阶段的证据（'+m[2]+'）：请在 verify 阶段用 run '+t.id+' 执行该用例本身');
  validateEvidence(json(t.evidence),s,{path:t.evidence});
 }}if(!r.tests.some(t=>t.required))throw Error('没有定义必测项');coverage(r);return r;}
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
  if(t.acceptance?.length&&!['static','unit','integration','manual','build'].includes(t.method))throw Error('用例 '+t.id+' 的 method 须明确验证方式（static/unit/integration/manual/build）');
  for(const ac of t.acceptance||[]){
   if(!criteria.has(ac))throw Error('用例 '+t.id+' 引用了未知验收标准 '+ac);
   if(t.required&&t.status==='passed')covered.add(ac);
  }
 }
 const missing=[...criteria].filter(ac=>!covered.has(ac));
 if(missing.length)throw Error('以下验收标准缺少已通过的必测用例: '+missing.join(', ')+'（在用例 acceptance 中逐条列出；未测不能计为通过）');
}

function syncResult(s){const p=docDir()+'/spec-sync.json';if(!fs.existsSync(safe(p))){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}const r=json(p);if(r.changeId!==s.changeId||!Array.isArray(r.files))throw Error('Spec 同步证据非法');if(!r.files.length){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}for(const f of r.files){if(!f.source.startsWith(docDir()+'/')||!f.target.startsWith(SPEC_PREFIX))throw Error('Spec 路径不正确（目标须以 '+SPEC_PREFIX+' 开头）');if(sha(read(f.source))!==f.sourceHash||sha(read(f.target))!==f.targetHash)throw Error('Spec 同步证据过期');}if(r.reviewed!==true)throw Error('Spec 合并未核对');}
function validate(s,id,{approval=true}={}){
 const n=node(id);for(const p of files(n).map(pp=>mapArt(s.changeId,pp))){if(p.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(p)))continue;if(!read(p).trim())throw Error('产物为空 '+p);}
 if(id==='ui'){uiScope();if(!s.uiSkill?.used)throw Error('请先询问用户是否跳过 UI，或选择设计 Skill，再用 ui-use <Skill名> 记录');}
 if(id==='plan')tasks();
 if(id==='execute'){for(const t of tasks()){if(t.status!=='done'||!t.evidence)throw Error('任务未完成 '+t.id);validateEvidence(json(t.evidence),s,{path:t.evidence});}}
 if(id==='verify'){validate(s,'execute',{approval:false});testResult(s);}
 if(id==='archive'){validate(s,'execute',{approval:false});testResult(s);syncResult(s);}
 if(approval&&APPROVAL_NODES.includes(id)&&s.approvals[id]?.fingerprint!==fingerprint(s,id))throw Error('需要用户确认或确认已失效: '+id);
}
function drift(s){for(const id of s.completedNodes){if(s.completedHashes[id]!==fingerprint(s,id))throw Error('已完成产物变化，请 reopen '+id);}}
// —— ui-scope：把「用户确认的界面」与真实文件绑定 ——
// ui.md 里形如：
//   ```ui-scope
//   mode: change            # new | change
//   files: [src/pages/Page1.vue]
//   affected: [src/pages/Page2.vue]
//   ```
// 目的：ui 门禁确认的是"关于界面的描述"，此前与真实交付物无绑定——确认的界面可以是 A，
// 实际交付的却是 B。声明后这些路径会被校验存在，并被强制计入证据输入。
const UI_SCOPE_BLOCK=UI_CHANGE?.declareBlock||'ui-scope';
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
function uiScope(){
 const p=docDir()+'/ui.md';
 if(!fs.existsSync(safe(p)))return null;
 const sc=parseUiScope(read(p));
 if(!sc){
  throw Error('ui.md 缺少 ```'+UI_SCOPE_BLOCK+' 声明块：需声明本次交付的界面文件（存量项目改造时另列 affected），把用户确认的界面与真实文件绑定。参见 templates/ui.md');
 }
 if(!['new','change'].includes(sc.mode))throw Error('ui-scope 的 mode 必须是 new 或 change（当前 '+(sc.mode||'<空>')+'）');
 if(!sc.files.length)throw Error('ui-scope 的 files 不能为空：至少列出本次交付/改动的界面文件或目录');
 for(const p of sc.prototypes){if(!p.startsWith(docDir()+'/')||!fs.existsSync(safe(p))||!fs.statSync(safe(p)).isFile())throw Error('原型须为本 change 内真实文件: '+p);}
 const bad=sc.files.concat(sc.affected,sc.prototypes).filter(f=>{try{return !fs.existsSync(safe(f));}catch{return true;}});
 if(bad.length)throw Error('ui-scope 声明的路径不存在或非法: '+bad.join(', ')+'（须为项目内真实相对路径）');
 if(sc.mode==='change'&&!sc.affected.length)throw Error('ui-scope 的 mode=change（存量改造）时必须用 affected 列出受影响的既有界面，供用户评估影响面与回归范围');
 return sc;
}
// 读取当前变更的 ui-scope（供 run 强制计入证据输入）。
function currentUiScope(s){if(s.skipped?.ui)return null;try{return fs.existsSync(safe(docDir()+'/ui.md'))?parseUiScope(read(docDir()+'/ui.md')):null;}catch{return null;}}
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
function archiveChange(s){
 const source=changeDocDir(s.changeId),destination=DOC_BASE+'/archive/'+s.changeId,jp=archiveJournal(s.changeId),stage=destination+'.pending';
 if(!fs.existsSync(safe(jp))){
  if(!s.currentNode){if(s.archivePath!==destination||!fs.existsSync(safe(destination+'/workflow-state.json')))throw Error('归档状态不完整，请 doctor');print(s);return;}
  if(s.currentNode!=='archive')throw Error('当前不是归档阶段');
  drift(s);validate(s,'archive');
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
 const previous=CLI_CHANGE;CLI_CHANGE=cid;
 try{
  const s=readState(cid),base=s.currentNode?changeDocDir(cid):s.archivePath;
  const ts=fs.existsSync(safe(base+'/tasks.json'))?json(base+'/tasks.json'):[];
  const row={changeId:cid,stage:s.currentNode||'archived',status:s.currentNode?'in_progress':'archived',
   progress:{done:new Set([...s.completedNodes,...Object.keys(s.skipped||{})]).size,total:nodes.length},
   tasks:{done:ts.filter(t=>t.status==='done').length,total:ts.length,blocked:ts.filter(t=>t.status==='blocked').length},
   stageProgress:{kind:'artifacts',done:0,total:0},reason:'',next:s.currentNode?'继续 '+s.currentNode:'已完成',updatedAt:s.updatedAt};
  if(!s.currentNode){row.stageProgress={kind:'archive',done:1,total:1};if(fs.existsSync(safe(archiveJournal(cid)))){row.status='archive_pending';row.next='archive（恢复清理）';}return row;}
  const required=files(node(s.currentNode)).map(p=>mapArt(cid,p)).filter(p=>SPEC_REQUIRED||!p.endsWith('/spec-sync.json'));
  row.stageProgress={kind:'artifacts',done:required.filter(p=>fs.existsSync(safe(p))&&read(p).trim()).length,total:required.length};
  if(s.currentNode==='execute')row.stageProgress={kind:'tasks',done:row.tasks.done,total:row.tasks.total};
  if(s.currentNode==='verify'){
   const rp=base+'/test-results.json',tests=fs.existsSync(safe(rp))?json(rp).tests.filter(t=>t.required):[];
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
 finally{CLI_CHANGE=previous;}
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
 console.log(JSON.stringify(s,null,2));
 if(cmd==='status')console.log('SUMMARY: '+JSON.stringify(changeSummary(s.changeId)));
 if(!s.currentNode){console.log('NEXT: done');return;}
 console.log('NEXT: '+s.currentNode+(APPROVAL_NODES.includes(s.currentNode)?'（用户确认门禁，approve 记录确认原文后才能 advance）':''));
 console.log('SKILL: t-flow-'+s.currentNode);
 if(s.currentNode==='ui'){
  if(s.uiSkill?.used)console.log('UI_SELECTED: '+s.uiSkill.used+'（已选择，继续设计；原型仍需用户确认）');
  else{
   console.log('UI_CHOICE: 请先询问用户：跳过 UI 设计，还是选择设计 Skill？等待明确选择后继续。');
   console.log('1. 跳过 UI（无界面需求或用户已明确要求跳过）：--change '+s.changeId+' skip ui <用户选择及原因>');
   console.log('2. '+(UI_ROUTING?.primary||'ui-ux-pro-max')+'（推荐）：--change '+s.changeId+' ui-use '+(UI_ROUTING?.primary||'ui-ux-pro-max'));
   console.log('3. '+(UI_ROUTING?.fallback||'frontend-design')+'：--change '+s.changeId+' ui-use '+(UI_ROUTING?.fallback||'frontend-design'));
  }
 }
}
const PRUNE_DIRS=new Set(['.git','node_modules']);
function expandInput(p){
 const f=safe(p);
 if(!fs.statSync(f).isDirectory())return [[p,sha(fs.readFileSync(f))]];
 const out=[];
 (function walkDir(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(PRUNE_DIRS.has(e.name))continue;const q=path.join(d,e.name);if(e.isDirectory())walkDir(q);else if(e.isFile())out.push(q);}})(f);
 return out.map(q=>[path.relative(root,q).split(path.sep).join('/'),sha(fs.readFileSync(q))]);
}
function boundInputs(s,extra,{strict=true}={}){
 const m={},idx=nodes.findIndex(n=>n.id===s.currentNode);
 for(const p of [...new Set(nodes.slice(0,idx).flatMap(files).map(pp=>mapArt(s.changeId,pp)))]){if(p.endsWith('/tasks.json'))continue;if(fs.existsSync(safe(p)))m[p]=sha(read(p));}
 for(const p of extra){if(!fs.existsSync(safe(p))){if(strict)throw Error('输入文件不存在 '+p);continue;}for(const [rel,h]of expandInput(p))m[rel]=h;}
 return m;
}
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
 for(const t of ['evidence.json','spec-sync.json','test-results.json'])if(!fs.existsSync(path.join(pkg,'templates',t)))problems.push('缺少模板 '+t);
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
  if(fs.existsSync(safe(docdir+'/tasks.json'))){try{for(const t of json(docdir+'/tasks.json'))if(t.evidence&&!fs.existsSync(safe(t.evidence)))problems.push(tag+'任务 '+t.id+' 的 evidence 文件缺失 '+t.evidence);}catch(e){problems.push(tag+'tasks.json 损坏: '+e.message);}}
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
 if(['init','approve','decide','skip','advance','task','run','ui-use','reopen','migrate','archive'].includes(cmd)){
  const cid=cmd==='init'?arg:cmd==='migrate'&&fs.existsSync(LEGACY_STATE)?JSON.parse(fs.readFileSync(LEGACY_STATE)).changeId:activeId();
  if(cid){lockChange(cid);if(cmd!=='archive'&&fs.existsSync(safe(archiveJournal(cid))))throw Error('归档尚未完成，请先 --change '+cid+' archive 恢复');}
 }
 if(['init','use','resume'].includes(cmd)&&CLI_CHANGE&&CLI_CHANGE!==arg)throw Error('--change 与目标 change 不一致');
 if(fs.existsSync(LEGACY_STATE)&&!['help','migrate','doctor','changes','list'].includes(cmd))throw Error('检测到旧布局，请先运行 migrate 迁移 current');
 if(cmd==='help'){console.log(`yt.mjs [--change <id>] init <change-id> | use <change-id> | resume <change-id> | changes [--json] | status [--all [--json]] | approve <node> [用户确认原文] | decide [用户决策原文] | skip <node> <原因> | check | advance | task <id> <status> [evidence] | run <id> [--input <路径>]... [--expect <正则>]... [--reject <正则>]... [--min-output <字符数>] [--timeout <秒>] -- <命令> | ensure-skills | ui-routing | ui-use <Skill名> | handoff | doctor | reopen <node> | migrate | archive
确认节点: ${APPROVAL_NODES.join('/')}（产物变化后确认自动失效；确认/决策原文可经 stdin 传入）。可跳过节点（协议声明）: ${nodes.filter(n=>n.skippable).map(n=>n.id).join('/')||'无'}；skip 记录原因并直接进入下一节点，reopen 前序节点会清除其后的跳过记录。
证据必须由 run 真实执行生成（限 execute/verify 阶段），禁止手写；execute 阶段证据 id 须为 tasks.json 中的任务 id，任务 modules 必须非空且路径真实存在、自动计入证据输入，--input 支持文件或目录（目录递归展开，跳过 .git/node_modules）。证据至少要绑定一个实现文件，只绑定本工作流文档会被拒绝。
证据不可复制冒用：校验会核对「证据路径中的 id 与文件内容 id 一致」，并要求存在对应的 attempts/<id>/<runId>.json 真实执行记录；verify 用例须在 verify 阶段自行执行，不得引用 execute 任务证据；证据日志必须位于 logs/ 下。只改一处文件无法伪造通过。
断言：--expect <正则> 要求输出命中（可重复多次，各项都必须命中）；--reject <正则> 任一命中即失败。直接调用 Bash 时自动启用 errexit/pipefail 并让嵌套 Bash 继承，不能让管道或 echo 成功标记吞掉失败；其他解释器需自行保证退出码。--min-output 要求输出不少于 N 字符；与退出码同时满足才算 passed。不用断言时脚本会告警——run 本身不校验命令语义，请自行确保命令真实覆盖被测内容。参数校验在命令执行前完成；固定证据路径记录最新结果，失败阻断推进；每次执行的证据与日志独立保留。
验收覆盖：PRD 声明 AC-NN-N 时，test-results.json 用例须用 acceptance 逐条覆盖全部 AC，并记录 method 验证方式；未测/可选用例不计覆盖。重复用例 ID 和未知 AC 会被拒绝。
需求覆盖：prd.md 里的需求编号（模式 ${REQ_PATTERN}）必须被 test-results.json 中已通过必测用例的 id 覆盖，缺项阻断 verify；不使用编号的项目置 config.requireCoverage:false。
从 verify 回退且存在 failed 测试才计验证-修复次数，超过 ${MAX_VERIFY_FAILURES} 次停止并要求用户决策，decide 记录用户决策原文后解除。协议文件变更后对每个未归档变更运行 --change <id> migrate。多 change：各变更独立目录 docs/t-flow/change/<id>/ 与状态，互不干扰、可并行推进；并行会话每条命令固定使用 --change <id> 前缀；init 新建、resume/use 选择继续目标、changes/list 查看进度和状态。
UI 设计 Skill：主 ${UI_ROUTING?UI_ROUTING.primary:'ui-ux-pro-max'}，兜底 ${UI_ROUTING?UI_ROUTING.fallback:'frontend-design'}（ui-routing 查看；ui-use <Skill名> 记录实际所用）。缺失时运行 ensure-skills 自动安装到项目 .agents/skills/ 并链接 .claude/skills/（Claude 与 agent 两条发现路径都可用）。
ui.md 须含 ${UI_SCOPE_BLOCK} 声明块（mode: new|change；files/affected 为真实界面路径），check 校验其存在，run 把 files 与 affected 强制计入证据输入——改动已声明的界面文件会使证据过期，避免"确认的界面≠交付的界面"。存量改造（mode: change）必须列 affected。UI 变更未绑定任何样式文件时 run 会告警。
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
  if(fs.existsSync(stateFileOf(arg)))throw Error('变更 '+arg+' 已存在（use '+arg+' 聚焦，或换一个 id）');
  const docdir=changeDocDir(arg);
  if(fs.existsSync(safe(DOC_BASE+'/archive/'+arg)))throw Error('归档目录已存在，请使用新的 change-id');
  if(fs.existsSync(safe(DOC_BASE+'/current')))throw Error('旧 current 尚未迁移，先核对其任务归属');
  if(fs.existsSync(safe(docdir)))throw Error(docdir+' 已存在，先检查已有文档，不自动覆盖');
  const s={schemaVersion:1,workflow:protocol.name,protocolHash:protocolHash(),changeId:arg,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0,history:[]};
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
  if(s.workflow!==protocol.name)throw Error('state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致，无法自动迁移');
  if(s.protocolHash===protocolHash())throw Error('协议未变化，无需迁移');
  const docBase=s.currentNode?changeDocDir(s.changeId):s.archivePath;
  for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(DOC_BASE+'/current/',docBase+'/'):p;if(ap.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(ap)))continue;if(!fs.existsSync(safe(ap))||!read(ap).trim())throw Error('产物缺失或为空 '+ap+'，修复后重新 migrate');}}
  // 先使用旧协议指纹检查原有绑定，避免迁移替改动过的产物重新背书。
  if(s.currentNode){
   const changed=nodes.findIndex(n=>{
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
  save(s,'migrate');print(s);
 }else{
  const s=state();
  if(cmd==='archive')archiveChange(s);
  else if(cmd==='status')print(s);
  else if(fs.existsSync(safe(archiveJournal(s.changeId))))throw Error('归档尚未完成，请先 archive 恢复');
  else if(cmd==='handoff'){
   if(!s.currentNode)throw Error('变更已归档');
   console.log('# handoff '+s.changeId+' @ '+s.currentNode);
   const idx=nodes.findIndex(n=>n.id===s.currentNode);
   for(const p of [...new Set(nodes.slice(0,idx+1).flatMap(files).map(pp=>mapArt(s.changeId,pp)))])console.log('- '+p+' '+(fs.existsSync(safe(p))?contentHash(p):'MISSING'));
  }
  else if(cmd==='reopen'){
   const i=nodes.findIndex(n=>n.id===arg);if(i<0||!s.currentNode)throw Error('无法重新打开');
   const currentIndex=nodes.findIndex(n=>n.id===s.currentNode);if(i>currentIndex)throw Error('不能跳过阶段');
   if(s.currentNode==='verify'&&i<currentIndex){
    let failed=true;try{failed=json(docDir()+'/test-results.json').tests?.some(t=>t.status==='failed')??true;}catch{}
    if(failed){s.verifyFailures=(s.verifyFailures||0)+1;if(s.verifyFailures>MAX_VERIFY_FAILURES){save(s,'verify-loop-blocked');throw Error('验证-修复循环已达 '+MAX_VERIFY_FAILURES+' 次：停止自动重试，向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除');}}
   }
   if(i<=nodes.findIndex(n=>n.id==='ui'))delete s.uiSkill;
   s.currentNode=arg;s.completedNodes=s.completedNodes.filter(id=>nodes.findIndex(n=>n.id===id)<i);for(const n of nodes.slice(i)){delete s.approvals[n.id];delete s.completedHashes[n.id];if(s.skipped)delete s.skipped[n.id];}save(s,'reopen '+arg);print(s);
  }else{
   drift(s);if(!s.currentNode)throw Error('变更已归档');
   if(cmd==='approve'){
    const quote=value??readStdin();
    if(arg!==s.currentNode||!APPROVAL_NODES.includes(arg)||!quote?.trim())throw Error('只可为当前确认节点记录用户确认原文（可经 stdin 传入）');
    validate(s,arg,{approval:false});s.approvals[arg]={quote:quote.trim(),fingerprint:fingerprint(s,arg),at:new Date().toISOString()};save(s,'approve '+arg);print(s);
   }else if(cmd==='decide'){
    const quote=arg??readStdin();
    if(!quote?.trim())throw Error('decide 需要用户决策原文（可经 stdin 传入）');
    if((s.verifyFailures||0)<=MAX_VERIFY_FAILURES)throw Error('验证-修复循环未超限，无需 decide');
    s.verifyFailures=0;(s.decisions=s.decisions||[]).push({quote:quote.trim(),at:new Date().toISOString()});save(s,'decide');print(s);
   }else if(cmd==='skip'){
    const n=node(arg);if(!n.skippable)throw Error('节点不可跳过 '+arg+'（可跳过: '+(nodes.filter(x=>x.skippable).map(x=>x.id).join('/')||'无')+'）');
    if(arg!==s.currentNode)throw Error('只能跳过当前节点 '+s.currentNode);
    if(!value?.trim())throw Error('skip 必须记录原因');
    if(arg==='ui')delete s.uiSkill;
    (s.skipped=s.skipped||{})[arg]={reason:value.trim(),at:new Date().toISOString()};delete s.approvals[arg];
    s.currentNode=nodes[nodes.findIndex(x=>x.id===arg)+1]?.id??null;save(s,'skip '+arg);print(s);
   }else if(cmd==='run'){
    if(!['execute','verify'].includes(s.currentNode))throw Error('只有 execute/verify 阶段可生成证据');
    if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(arg||''))throw Error('evidence-id 使用字母数字和连字符');
    const rest=_argv.slice(2),sep=rest.indexOf('--');
    if(sep<0||sep===rest.length-1)throw Error('用法: run <id> [--input <路径>]... [--expect <正则>]... [--reject <正则>]... [--min-output <字符数>] [--timeout <秒>] -- <命令>');
    const flags=rest.slice(0,sep),cmdArgs=rest.slice(sep+1),extraInputs=[];
    let timeoutMs=30*60*1000,expects=[],rejects=[],minOutput=0;
    for(let i=0;i<flags.length;i++){
     if(flags[i]==='--input'&&flags[i+1])extraInputs.push(flags[++i]);
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
    const runEnv=bash?{...process.env,SHELLOPTS:[...new Set([...(process.env.SHELLOPTS||'').split(':').filter(Boolean),'errexit','pipefail'])].join(':')}:process.env;
    const command=cmdArgs.map(shellQuote).join(' ');
    // 先算证据输入并校验，再执行命令：否则命令已产生副作用（写库、发请求、改文件）才因参数非法报错。
    const inputs=boundInputs(s,extraInputs),inputRoots=[...extraInputs];
    if(s.currentNode==='execute'){
     const ts=json(docDir()+'/tasks.json'),t=Array.isArray(ts)?ts.find(x=>x.id===arg):null;
     // execute 阶段证据 id 必须是已声明的任务：否则会生成无法登记、只污染证据目录的孤儿证据。
     if(!t)throw Error('execute 阶段的证据 id 必须是 tasks.json 中的任务 id：未找到任务 '+arg);
     {
      const bad=(t.modules||[]).filter(m=>{try{return !fs.existsSync(safe(m));}catch{return true;}});
      if(bad.length)throw Error('任务 '+arg+' 的 modules 路径不存在或非法: '+bad.join(', ')+'（modules 须为项目内真实相对路径，证据输入绑定依赖它）');
      Object.assign(inputs,boundInputs(s,t.modules));inputRoots.push(...t.modules);
     }
    }
    // ui-scope 声明的界面文件强制计入证据输入：用户确认的界面一旦变化，证据必须过期。
    // files（本次交付）与 affected（受影响的既有界面）都要绑定——否则"用户在 ui 门禁里
    // 确认过的影响面"可以被绕过：改了一个已声明的受影响页面却检测不到。
    const sc=currentUiScope(s);
    if(sc&&(sc.files.length||sc.affected.length||sc.prototypes.length)){
     const declared=[...new Set([...sc.files,...sc.affected,...sc.prototypes])];
     const bad=declared.filter(f=>{try{return !fs.existsSync(safe(f));}catch{return true;}});
     if(bad.length)throw Error('ui-scope 声明的界面文件不存在: '+bad.join(', ')+'（ui.md 与磁盘不一致，请修正或 reopen ui）');
     for(const f of declared){for(const [rel,h]of expandInput(f))inputs[rel]=h;inputRoots.push(f);}
    }
    // 证据输入必须至少覆盖一个非文档（源码/配置）文件，否则该证据无法反映实现变化。
    const docPrefix=DOC_BASE+'/';
    if(!Object.keys(inputs).some(p=>!p.startsWith(docPrefix)))throw Error('证据输入只包含本工作流文档，未绑定任何实现文件：请用 --input 指定相关源码，或检查任务 modules');
    if(!expects.length&&minOutput<=0)console.error('WARN: 未使用 --expect/--min-output，证据仅以退出码判定；命令语义无法被脚本校验。');
    // 存量项目 UI 变更：样式/主题改动若不在证据输入里，视觉变化不会被"证据过期"检出。
    if(STYLE_WARN&&!s.skipped?.ui&&fs.existsSync(safe(docDir()+'/ui.md'))){
     const styleBound=Object.keys(inputs).filter(p=>matchStyleGlob(p));
     if(!styleBound.length)console.error('WARN: 本次为 UI 变更（ui.md 存在），但证据未绑定任何样式/主题文件。若本次涉及样式或 design token，请把样式目录或主题文件加入任务 modules 或 --input——否则视觉改动不会使证据过期。');
    }
    const directories=Object.fromEntries([...new Set(inputRoots)].filter(p=>fs.statSync(safe(p)).isDirectory()).map(p=>[p,expandInput(p).map(([rel])=>rel).sort()]));
    const r=spawnSync(cmdArgs[0],cmdArgs.slice(1),{cwd:root,env:runEnv,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024});
    const out=(r.stdout||'')+'\n'+(r.stderr||'');
    // 断言：退出码 0 且全部 --expect 模式命中、输出量达标，才算 passed。
    const unmet=expects.filter((pat,i)=>!patterns[i].test(out));
    const rejected=rejects.filter((pat,i)=>rejectPatterns[i].test(out));
    const bodyLen=out.trim().length;
    const ok=r.status===0&&!unmet.length&&!rejected.length&&bodyLen>=minOutput;
    const runId=crypto.randomUUID(),log=logsDir()+'/'+arg+'-'+runId+'.log';
    writeRaw(log,['$ '+command,'',r.stdout||'',r.stderr||'',r.error?'[error] '+r.error.message:'','[exit] '+(r.status===null?'signal '+(r.signal||'?'):r.status),
     expects.length?'[expect] '+expects.map(p=>p+' -> '+(unmet.includes(p)?'MISS':'HIT')).join('; '):'',
     rejects.length?'[reject] '+rejects.map(p=>p+' -> '+(rejected.includes(p)?'HIT (failed)':'CLEAR')).join('; '):'',
     minOutput?'[min-output] '+minOutput+' (actual '+bodyLen+')':''].filter(Boolean).join('\n'));
    const ev={schemaVersion:2,id:arg,runId,node:s.currentNode,directories,changeId:s.changeId,status:ok?'passed':'failed',command,exitCode:r.status,signal:r.signal||null,...(bash?{shellOptions:['errexit','pipefail']}:{}),recordedAt:new Date().toISOString(),inputs,log,logHash:sha(fs.readFileSync(safe(log))),
     ...(expects.length?{expects}:{}),...(rejects.length?{rejects}:{}),...(minOutput?{minOutput}:{})};
    const ep=evDir()+'/'+arg+'.json';
    // 每次执行保存独立记录；固定路径始终指向最新结果，包括失败。
    write(evDir()+'/attempts/'+arg+'/'+runId+'.json',ev);
    write(ep,ev);
    save(s,'run '+arg+'='+ev.status);
    console.log('EVIDENCE: '+ep);console.log('STATUS: '+ev.status);if(!ok)process.exitCode=1;
   }else if(cmd==='task'){
    if(s.currentNode!=='execute')throw Error('只有执行阶段可更新任务');
    const ts=tasks(),t=ts.find(x=>x.id===arg);if(!t||!['pending','in_progress','blocked','done'].includes(value))throw Error('任务或状态非法');
    if(['in_progress','done'].includes(value)&&t.dependsOn.some(d=>ts.find(x=>x.id===d).status!=='done'))throw Error('任务依赖未完成');
    if(value==='done'){const expect=docDir()+'/evidence/'+arg+'.json';if(extra[0]!==expect)throw Error('证据须为 '+expect+'（先用 run '+arg+' 生成）');validateEvidence(json(extra[0]),s,{path:extra[0]});t.evidence=extra[0];}else delete t.evidence;
    if(t.status==='done'&&value!=='done'&&ts.some(x=>x.dependsOn.includes(t.id)&&x.status==='done'))throw Error('先重开依赖本任务的已完成任务');
    t.status=value;write(docDir()+'/tasks.json',ts);save(s,'task '+arg+'='+value);print(s);
   }else if(['check','advance'].includes(cmd)){
    validate(s,s.currentNode,{approval:cmd!=='check'});
    if(cmd==='check'){console.log(APPROVAL_NODES.includes(s.currentNode)&&s.approvals[s.currentNode]?.fingerprint!==fingerprint(s,s.currentNode)?'ARTIFACTS_READY: 等待用户确认':'READY');print(s);}
    else if(s.currentNode==='archive'){throw Error('归档请运行 archive');
    }else{
     const from=s.currentNode;if(from==='verify')s.verifyFailures=0;
     s.completedHashes[from]=fingerprint(s,from);s.completedNodes.push(from);s.currentNode=nodes[nodes.findIndex(n=>n.id===from)+1]?.id??null;save(s,'advance '+from);print(s);
    }
   }else throw Error('未知命令 '+cmd);
  }
 }
}catch(e){console.error('BLOCKED: '+e.message);process.exitCode=1;}
