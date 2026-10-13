#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(process.env.COMET_RUN_ROOT || process.cwd());
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const protocol=JSON.parse(fs.readFileSync(path.join(pkg,'reference/workflow-protocol.json')));
const nodes=protocol.nodes.filter(n=>!n.disabled);
const cfg=protocol.config||{};
const SPEC_PREFIX=cfg.specTargetPrefix??'openspec/specs/';
const SPEC_REQUIRED=cfg.specSyncRequired!==false;
const [cmd='help',arg,value,...extra]=process.argv.slice(2);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// 确认门禁与验证-修复上限均由协议声明（改动这些值会改变 protocolHash，进行中变更需 migrate）。
const APPROVAL_NODES=nodes.filter(n=>n.approval).map(n=>n.id), MAX_VERIFY_FAILURES=cfg.maxVerifyFailures??3;
function safe(rel){
 if(!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw Error('路径必须在项目内');
 const full=path.resolve(root,rel); let cursor=root;
 for(const part of path.relative(root,full).split(path.sep)){ cursor=path.join(cursor,part); if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('不允许符号链接: '+rel); }
 return full;
}
const stateFile=safe(protocol.state.statePath), current='docs/sy-comet/current';
const logsDir=current+'/logs', evDir=current+'/evidence';
function read(rel){return fs.readFileSync(safe(rel),'utf8');}
function json(rel){return JSON.parse(read(rel));}
function writeRaw(rel,data){const f=safe(rel);fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,f);}
function write(rel,data){writeRaw(rel,JSON.stringify(data,null,2)+'\n');}
function protocolHash(){return sha(JSON.stringify(protocol));}
function state(){if(!fs.existsSync(stateFile))throw Error('尚未初始化，运行 init <change-id>');const s=JSON.parse(fs.readFileSync(stateFile));if(s.workflow!==protocol.name||s.protocolHash!==protocolHash())throw Error('状态与工作流版本不一致，请运行 migrate');return s;}
function save(s,action){if(action)s.history.push({action,at:new Date().toISOString()});s.updatedAt=new Date().toISOString();write(protocol.state.statePath,s);}
function node(id){const n=nodes.find(n=>n.id===id);if(!n)throw Error('未知节点 '+id);return n;}
function files(n){return n.outputSchemas.flatMap(id=>{const schema=protocol.outputSchemas.find(x=>x.id===id);if(!schema)throw Error('缺少 schema '+id);return schema.artifacts.filter(a=>a.required).flatMap(a=>a.paths);});}
function contentHash(p){return p.endsWith('/tasks.json')?sha(JSON.stringify(json(p).map(({status,evidence,...rest})=>rest))):sha(read(p));}
function fingerprint(s,id){const end=nodes.findIndex(n=>n.id===id);const paths=[...new Set(nodes.slice(0,end+1).flatMap(files))];return sha(JSON.stringify({changeId:s.changeId,protocol:s.protocolHash,files:paths.map(p=>[p,fs.existsSync(safe(p))?contentHash(p):null])}));}
function tasks(){const t=json(current+'/tasks.json');if(!Array.isArray(t)||!t.length)throw Error('tasks.json 必须是非空数组');const ids=new Set(t.map(x=>x.id));if(ids.size!==t.length)throw Error('任务 ID 重复');for(const x of t){if(!x.id||!x.title||!Array.isArray(x.dependsOn)||!Array.isArray(x.acceptance)||!x.acceptance.length||!['pending','in_progress','blocked','done'].includes(x.status))throw Error('任务字段不完整 '+x.id);
 // modules 必须是非空字符串数组：证据输入绑定依赖它，留空等于让"证据过期"失效（见 README 机制边界）。
 if(!Array.isArray(x.modules)||!x.modules.length||x.modules.some(m=>typeof m!=='string'||!m.trim()))throw Error('任务 '+x.id+' 的 modules 必须是非空路径数组（证据输入绑定依赖它）');
 if(x.dependsOn.some(d=>!ids.has(d)||d===x.id))throw Error('任务依赖非法 '+x.id);}const seen=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('任务依赖循环');if(seen.has(id))return;active.add(id);t.find(x=>x.id===id).dependsOn.forEach(visit);active.delete(id);seen.add(id);}t.forEach(x=>visit(x.id));return t;}
function validateEvidence(e,s){if(e.changeId!==s.changeId||e.status!=='passed'||!e.command||!e.recordedAt||!e.inputs||!Object.keys(e.inputs).length)throw Error('验证证据字段缺失或未通过');for(const [p,h]of Object.entries(e.inputs)){if(sha(read(p))!==h)throw Error('验证证据过期: '+p);}if(!e.log||!read(e.log).trim())throw Error('缺少验证日志');}
function testResult(s){const r=json(current+'/test-results.json');if(r.changeId!==s.changeId||!Array.isArray(r.tests)||!r.tests.length)throw Error('缺少本次测试结果');for(const t of r.tests){if(typeof t.required!=='boolean'||!['passed','failed','not_run'].includes(t.status))throw Error('测试结果非法');if(t.status==='failed')throw Error('测试失败 '+t.id);if(t.required&&t.status!=='passed')throw Error('必测项未通过 '+t.id);if(t.status==='passed')validateEvidence(json(t.evidence),s);}if(!r.tests.some(t=>t.required))throw Error('没有定义必测项');return r;}
function syncResult(s){const p=current+'/spec-sync.json';if(!fs.existsSync(safe(p))){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}const r=json(p);if(r.changeId!==s.changeId||!Array.isArray(r.files))throw Error('Spec 同步证据非法');if(!r.files.length){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}for(const f of r.files){if(!f.source.startsWith(current+'/')||!f.target.startsWith(SPEC_PREFIX))throw Error('Spec 路径不正确（目标须以 '+SPEC_PREFIX+' 开头）');if(sha(read(f.source))!==f.sourceHash||sha(read(f.target))!==f.targetHash)throw Error('Spec 同步证据过期');}if(r.reviewed!==true)throw Error('Spec 合并未核对');}
function validate(s,id,{approval=true}={}){
 const n=node(id);for(const p of files(n)){if(p.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(p)))continue;if(!read(p).trim())throw Error('产物为空 '+p);}
 if(id==='plan')tasks();
 if(id==='execute'){for(const t of tasks()){if(t.status!=='done'||!t.evidence)throw Error('任务未完成 '+t.id);validateEvidence(json(t.evidence),s);}}
 if(id==='verify'){validate(s,'execute',{approval:false});testResult(s);}
 if(id==='archive'){validate(s,'execute',{approval:false});testResult(s);syncResult(s);}
 if(approval&&APPROVAL_NODES.includes(id)&&s.approvals[id]?.fingerprint!==fingerprint(s,id))throw Error('需要用户确认或确认已失效: '+id);
}
function drift(s){for(const id of s.completedNodes){if(s.completedHashes[id]!==fingerprint(s,id))throw Error('已完成产物变化，请 reopen '+id);}}
function print(s){console.log(JSON.stringify(s,null,2));if(s.currentNode){console.log('NEXT: '+s.currentNode+(APPROVAL_NODES.includes(s.currentNode)?'（用户确认门禁，approve 记录确认原文后才能 advance）':''));console.log('SKILL: sy-comet-'+s.currentNode);}else console.log('NEXT: done');}
const PRUNE_DIRS=new Set(['.git','node_modules']);
function expandInput(p){
 const f=safe(p);
 if(!fs.statSync(f).isDirectory())return [[p,sha(read(p))]];
 const out=[];
 (function walkDir(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(PRUNE_DIRS.has(e.name))continue;const q=path.join(d,e.name);if(e.isDirectory())walkDir(q);else if(e.isFile())out.push(q);}})(f);
 return out.map(q=>[path.relative(root,q).split(path.sep).join('/'),sha(fs.readFileSync(q))]);
}
function boundInputs(s,extra,{strict=true}={}){
 const m={},idx=nodes.findIndex(n=>n.id===s.currentNode);
 for(const p of [...new Set(nodes.slice(0,idx).flatMap(files))]){if(p.endsWith('/tasks.json'))continue;if(fs.existsSync(safe(p)))m[p]=sha(read(p));}
 for(const p of extra){if(!fs.existsSync(safe(p))){if(strict)throw Error('输入文件不存在 '+p);continue;}for(const [rel,h]of expandInput(p))m[rel]=h;}
 return m;
}
function shellQuote(a){return /^[\w@%+=:,./-]+$/.test(a)?a:"'"+a.replace(/'/g,"'\\''")+"'";}
function readStdin(){try{if(!fs.fstatSync(0).isCharacterDevice())return fs.readFileSync(0,'utf8');}catch{}return null;}
function doctor(){
 const problems=[];
 for(const n of nodes){if(!fs.existsSync(path.join(pkg,'..','sy-comet-'+n.id,'SKILL.md')))problems.push('缺少节点 Skill: sy-comet-'+n.id);}
 for(const t of ['evidence.json','spec-sync.json','test-results.json'])if(!fs.existsSync(path.join(pkg,'templates',t)))problems.push('缺少模板 '+t);
 if(!fs.existsSync(stateFile))console.log('state: 未初始化（可 init 新变更）');
 else{
  let s=null;try{s=JSON.parse(fs.readFileSync(stateFile));}catch(e){problems.push('state.json 损坏: '+e.message+'；人工修复 JSON 或删除后重开');}
  if(s){
   const hashOk=s.workflow===protocol.name&&s.protocolHash===protocolHash();
   if(s.workflow!==protocol.name)problems.push('state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致');
   if(s.protocolHash!==protocolHash())problems.push('protocolHash 不匹配：协议已变更，运行 yt.mjs migrate 迁移');
   if(s.currentNode&&!nodes.some(n=>n.id===s.currentNode))problems.push('currentNode 非法: '+s.currentNode);
   if((s.verifyFailures||0)>MAX_VERIFY_FAILURES)problems.push('验证-修复循环已超限（'+s.verifyFailures+' 次）：向用户展示失败历史，用户决策后用 decide <用户决策原文> 解除');
   for(const id of Object.keys(s.skipped||{})){const sn=nodes.find(n=>n.id===id);if(!sn)problems.push('跳过记录指向未知节点 '+id);else if(!sn.skippable)problems.push('不可跳过的节点存在跳过记录: '+id);}
   if(s.currentNode&&s.skipped?.[s.currentNode])problems.push('当前节点存在跳过记录: '+s.currentNode);
   if(s.currentNode&&!fs.existsSync(safe(current)))problems.push('currentNode 非空但 '+current+' 目录缺失');
   if(!s.currentNode&&fs.existsSync(safe(current)))problems.push('已归档但 '+current+' 残留（上次归档清理中断），核实后手动删除');
   const docBase=s.currentNode?current:s.archivePath;
   for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(current,docBase):p;if(ap.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(ap)))continue;if(!fs.existsSync(safe(ap)))problems.push('已完成节点 '+id+' 缺产物 '+ap);}}
   if(hashOk&&s.currentNode){
    for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;try{if(s.completedHashes?.[id]!==fingerprint(s,id))problems.push('已完成节点 '+id+' 的产物已变化，需 reopen '+id);}catch(e){problems.push('节点 '+id+' 指纹计算失败: '+e.message);}}
    for(const id of Object.keys(s.approvals||{})){if(!APPROVAL_NODES.includes(id))continue;try{if(s.approvals[id]?.fingerprint!==fingerprint(s,id))problems.push('节点 '+id+' 的用户确认已失效，需重新确认');}catch{}}
   }
   if(fs.existsSync(safe(current+'/tasks.json'))){try{for(const t of json(current+'/tasks.json'))if(t.evidence&&!fs.existsSync(safe(t.evidence)))problems.push('任务 '+t.id+' 的 evidence 文件缺失 '+t.evidence);}catch(e){problems.push('tasks.json 损坏: '+e.message);}}
  }
 }
 if(problems.length){console.log('PROBLEMS:');for(const p of problems)console.log('- '+p);process.exitCode=1;}else console.log('OK');
}
try{
 if(cmd==='help'){console.log(`yt.mjs init <change-id> | status | approve <node> [用户确认原文] | decide [用户决策原文] | skip <node> <原因> | check | advance | task <id> <status> [evidence] | run <id> [--input <路径>]... [--timeout <秒>] -- <命令> | handoff | doctor | reopen <node> | migrate | archive
确认节点: ${APPROVAL_NODES.join('/')}（产物变化后确认自动失效；确认/决策原文可经 stdin 传入）。可跳过节点（协议声明）: ${nodes.filter(n=>n.skippable).map(n=>n.id).join('/')||'无'}；skip 记录原因并直接进入下一节点，reopen 前序节点会清除其后的跳过记录。
证据必须由 run 真实执行生成（限 execute/verify 阶段），禁止手写；execute 阶段证据 id 须为任务 id，任务 modules 必须非空且路径真实存在、自动计入证据输入，--input 支持文件或目录（目录递归展开，跳过 .git/node_modules）。证据至少要绑定一个实现文件，只绑定本工作流文档会被拒绝；run 只看退出码，不校验命令语义，请自行确保命令真实覆盖被测内容。
从 verify 回退且存在 failed 测试才计验证-修复次数，超过 ${MAX_VERIFY_FAILURES} 次停止并要求用户决策，decide 记录用户决策原文后解除。协议文件变更后运行 migrate 迁移进行中的状态。
Spec 合并目标前缀: ${SPEC_PREFIX}（protocol config 可改；无正式 Spec 的项目置 specSyncRequired:false）。项目根: COMET_RUN_ROOT 或 cwd。归档前必须人工验收；不会自动提交或发布代码。`);}
 else if(cmd==='doctor'){doctor();}
 else if(cmd==='init'){
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(arg||''))throw Error('change-id 使用小写字母数字和连字符');
  if(fs.existsSync(stateFile)){const old=state();if(old.currentNode)throw Error('已有进行中变更 '+old.changeId);}
  if(fs.existsSync(safe(current)))throw Error('current 已存在，先检查已有文档，不自动覆盖');
  const s={schemaVersion:1,workflow:protocol.name,protocolHash:protocolHash(),changeId:arg,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},skipped:{},verifyFailures:0,history:[]};
  fs.mkdirSync(safe(current),{recursive:true});save(s,'init');print(s);
 }else if(cmd==='migrate'){
  if(!fs.existsSync(stateFile))throw Error('尚未初始化，无状态可迁移');
  const s=JSON.parse(fs.readFileSync(stateFile));
  if(s.workflow!==protocol.name)throw Error('state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致，无法自动迁移');
  if(s.protocolHash===protocolHash())throw Error('协议未变化，无需迁移');
  const docBase=s.currentNode?current:s.archivePath;
  for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(current,docBase):p;if(ap.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(ap)))continue;if(!fs.existsSync(safe(ap))||!read(ap).trim())throw Error('产物缺失或为空 '+ap+'，修复后重新 migrate');}}
  s.protocolHash=protocolHash();
  if(s.currentNode){
   for(const id of s.completedNodes||[]){if(nodes.some(n=>n.id===id))s.completedHashes[id]=fingerprint(s,id);}
   for(const id of Object.keys(s.approvals||{})){if(nodes.some(n=>n.id===id))s.approvals[id].fingerprint=fingerprint(s,id);}
  }
  save(s,'migrate');print(s);
 }else{
  const s=state();
  if(cmd==='status')print(s);
  else if(cmd==='handoff'){
   if(!s.currentNode)throw Error('变更已归档');
   console.log('# handoff '+s.changeId+' @ '+s.currentNode);
   const idx=nodes.findIndex(n=>n.id===s.currentNode);
   for(const p of [...new Set(nodes.slice(0,idx+1).flatMap(files))])console.log('- '+p+' '+(fs.existsSync(safe(p))?contentHash(p):'MISSING'));
  }
  else if(cmd==='reopen'){
   const i=nodes.findIndex(n=>n.id===arg);if(i<0||!s.currentNode)throw Error('无法重新打开');
   const currentIndex=nodes.findIndex(n=>n.id===s.currentNode);if(i>currentIndex)throw Error('不能跳过阶段');
   if(s.currentNode==='verify'&&i<currentIndex){
    let failed=true;try{failed=json(current+'/test-results.json').tests?.some(t=>t.status==='failed')??true;}catch{}
    if(failed){s.verifyFailures=(s.verifyFailures||0)+1;if(s.verifyFailures>MAX_VERIFY_FAILURES){save(s,'verify-loop-blocked');throw Error('验证-修复循环已达 '+MAX_VERIFY_FAILURES+' 次：停止自动重试，向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除');}}
   }
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
    (s.skipped=s.skipped||{})[arg]={reason:value.trim(),at:new Date().toISOString()};delete s.approvals[arg];
    s.currentNode=nodes[nodes.findIndex(x=>x.id===arg)+1]?.id??null;save(s,'skip '+arg);print(s);
   }else if(cmd==='run'){
    if(!['execute','verify'].includes(s.currentNode))throw Error('只有 execute/verify 阶段可生成证据');
    if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(arg||''))throw Error('evidence-id 使用字母数字和连字符');
    const rest=process.argv.slice(4),sep=rest.indexOf('--');
    if(sep<0||sep===rest.length-1)throw Error('用法: run <id> [--input <路径>]... [--timeout <秒>] -- <命令>');
    const flags=rest.slice(0,sep),cmdArgs=rest.slice(sep+1),extraInputs=[];
    let timeoutMs=30*60*1000;
    for(let i=0;i<flags.length;i++){if(flags[i]==='--input'&&flags[i+1])extraInputs.push(flags[++i]);else if(flags[i]==='--timeout'&&flags[i+1]){const sec=Number(flags[++i]);if(!(sec>0))throw Error('--timeout 需为正数秒');timeoutMs=sec*1000;}else throw Error('无法识别的参数 '+flags[i]);}
    const command=cmdArgs.map(shellQuote).join(' ');
    const r=spawnSync(command,{shell:true,cwd:root,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024});
    const log=logsDir+'/'+arg+'.log';
    writeRaw(log,['$ '+command,'',r.stdout||'',r.stderr||'',r.error?'[error] '+r.error.message:'','[exit] '+(r.status===null?'signal '+(r.signal||'?'):r.status)].join('\n'));
    const inputs=boundInputs(s,extraInputs);
    if(s.currentNode==='execute'){
     // 任务 modules 必须真实存在并计入证据输入：modules 里的路径既不存在也不报错时，
     // 证据就只绑定上游文档，源码改动不会使证据过期（历史缺陷）。此处强制校验。
     const ts=json(current+'/tasks.json'),t=Array.isArray(ts)?ts.find(x=>x.id===arg):null;
     if(t){
      const bad=(t.modules||[]).filter(m=>{try{return !fs.existsSync(safe(m));}catch{return true;}});
      if(bad.length)throw Error('任务 '+arg+' 的 modules 路径不存在或非法: '+bad.join(', ')+'（modules 须为项目内真实相对路径，证据输入绑定依赖它）');
      Object.assign(inputs,boundInputs(s,t.modules));
     }
    }
    // 证据输入必须至少覆盖一个非文档（源码/配置）文件，否则该证据无法反映实现变化。
    const docPrefix=current+'/';
    if(!Object.keys(inputs).some(p=>!p.startsWith(docPrefix)))throw Error('证据输入只包含本工作流文档，未绑定任何实现文件：请用 --input 指定相关源码，或检查任务 modules');
    const ev={changeId:s.changeId,status:r.status===0?'passed':'failed',command,recordedAt:new Date().toISOString(),inputs,log};
    const ep=evDir+'/'+arg+'.json';write(ep,ev);save(s,'run '+arg+'='+ev.status);
    console.log('EVIDENCE: '+ep);console.log('STATUS: '+ev.status);if(ev.status!=='passed')process.exitCode=1;
   }else if(cmd==='task'){
    if(s.currentNode!=='execute')throw Error('只有执行阶段可更新任务');
    const ts=tasks(),t=ts.find(x=>x.id===arg);if(!t||!['pending','in_progress','blocked','done'].includes(value))throw Error('任务或状态非法');
    if(['in_progress','done'].includes(value)&&t.dependsOn.some(d=>ts.find(x=>x.id===d).status!=='done'))throw Error('任务依赖未完成');
    if(value==='done'){const expect=current+'/evidence/'+arg+'.json';if(extra[0]!==expect)throw Error('证据须为 '+expect+'（先用 run '+arg+' 生成）');validateEvidence(json(extra[0]),s);t.evidence=extra[0];}else delete t.evidence;
    if(t.status==='done'&&value!=='done'&&ts.some(x=>x.dependsOn.includes(t.id)&&x.status==='done'))throw Error('先重开依赖本任务的已完成任务');
    t.status=value;write(current+'/tasks.json',ts);save(s,'task '+arg+'='+value);print(s);
   }else if(['check','advance','archive'].includes(cmd)){
    validate(s,s.currentNode);
    if(cmd==='check'){console.log('READY');print(s);}
    else if(s.currentNode==='archive'){
     if(cmd!=='archive')throw Error('归档请运行 archive');
     const destination='docs/sy-comet/archive/'+s.changeId;if(fs.existsSync(safe(destination)))throw Error('归档目录已存在');
     s.completedNodes.push('archive');s.completedHashes.archive=fingerprint(s,'archive');s.currentNode=null;s.archivePath=destination;
     // Copy first: interruption preserves current and never loses source documents.
     fs.mkdirSync(path.dirname(safe(destination)),{recursive:true});fs.cpSync(safe(current),safe(destination),{recursive:true,errorOnExist:true,force:false});
     write(destination+'/workflow-state.json',s);save(s,'archive');
     try{fs.rmSync(safe(current),{recursive:true});}catch{console.error('WARN: 已归档但 '+current+' 清理失败，请核实后手动删除');}
     print(s);
    }else{
     if(cmd==='archive')throw Error('当前不是归档阶段');
     const from=s.currentNode;if(from==='verify')s.verifyFailures=0;
     s.completedHashes[from]=fingerprint(s,from);s.completedNodes.push(from);s.currentNode=nodes[nodes.findIndex(n=>n.id===from)+1]?.id??null;save(s,'advance '+from);print(s);
    }
   }else throw Error('未知命令 '+cmd);
  }
 }
}catch(e){console.error('BLOCKED: '+e.message);process.exitCode=1;}
