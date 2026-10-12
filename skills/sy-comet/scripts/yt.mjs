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
const [cmd='help',arg,value,...extra]=process.argv.slice(2);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const APPROVAL_NODES=['clarify','ui','design','archive'], MAX_VERIFY_FAILURES=3;
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
function writeRaw(rel,data,binary){const f=safe(rel);fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,f);}
function write(rel,data){writeRaw(rel,JSON.stringify(data,null,2)+'\n');}
function state(){if(!fs.existsSync(stateFile))throw Error('尚未初始化，运行 init <change-id>');const s=JSON.parse(fs.readFileSync(stateFile));if(s.workflow!==protocol.name||s.protocolHash!==sha(JSON.stringify(protocol)))throw Error('状态与工作流版本不一致，请先迁移');return s;}
function save(s,action){if(action)s.history.push({action,at:new Date().toISOString()});s.updatedAt=new Date().toISOString();write(protocol.state.statePath,s);}
function node(id){const n=nodes.find(n=>n.id===id);if(!n)throw Error('未知节点 '+id);return n;}
function files(n){return n.outputSchemas.flatMap(id=>{const schema=protocol.outputSchemas.find(x=>x.id===id);if(!schema)throw Error('缺少 schema '+id);return schema.artifacts.filter(a=>a.required).flatMap(a=>a.paths);});}
function contentHash(p){return p.endsWith('/tasks.json')?sha(JSON.stringify(json(p).map(({status,evidence,...rest})=>rest))):sha(read(p));}
function fingerprint(s,id){const end=nodes.findIndex(n=>n.id===id);const paths=[...new Set(nodes.slice(0,end+1).flatMap(files))];return sha(JSON.stringify({changeId:s.changeId,protocol:s.protocolHash,files:paths.map(p=>[p,fs.existsSync(safe(p))?contentHash(p):null])}));}
function tasks(){const t=json(current+'/tasks.json');if(!Array.isArray(t)||!t.length)throw Error('tasks.json 必须是非空数组');const ids=new Set(t.map(x=>x.id));if(ids.size!==t.length)throw Error('任务 ID 重复');for(const x of t){if(!x.id||!x.title||!Array.isArray(x.dependsOn)||!Array.isArray(x.acceptance)||!x.acceptance.length||!['pending','in_progress','blocked','done'].includes(x.status))throw Error('任务字段不完整 '+x.id);if(x.dependsOn.some(d=>!ids.has(d)||d===x.id))throw Error('任务依赖非法 '+x.id);}const seen=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('任务依赖循环');if(seen.has(id))return;active.add(id);t.find(x=>x.id===id).dependsOn.forEach(visit);active.delete(id);seen.add(id);}t.forEach(x=>visit(x.id));return t;}
function validateEvidence(e,s){if(e.changeId!==s.changeId||e.status!=='passed'||!e.command||!e.recordedAt||!e.inputs||!Object.keys(e.inputs).length)throw Error('验证证据字段缺失或未通过');for(const [p,h]of Object.entries(e.inputs)){if(sha(read(p))!==h)throw Error('验证证据过期: '+p);}if(!e.log||!read(e.log).trim())throw Error('缺少验证日志');}
function testResult(s){const r=json(current+'/test-results.json');if(r.changeId!==s.changeId||!Array.isArray(r.tests)||!r.tests.length)throw Error('缺少本次测试结果');for(const t of r.tests){if(typeof t.required!=='boolean'||!['passed','failed','not_run'].includes(t.status))throw Error('测试结果非法');if(t.required&&t.status!=='passed')throw Error('必测项未通过 '+t.id);if(t.status==='passed')validateEvidence(json(t.evidence),s);}if(!r.tests.some(t=>t.required))throw Error('没有定义必测项');return r;}
function syncResult(s){const r=json(current+'/spec-sync.json');if(r.changeId!==s.changeId||!Array.isArray(r.files)||!r.files.length)throw Error('缺少 Spec 同步证据');for(const f of r.files){if(!f.source.startsWith(current+'/')||!f.target.startsWith('openspec/specs/'))throw Error('Spec 路径不正确');if(sha(read(f.source))!==f.sourceHash||sha(read(f.target))!==f.targetHash)throw Error('Spec 同步证据过期');}if(r.reviewed!==true)throw Error('Spec 合并未核对');}
function validate(s,id,{approval=true}={}){
 const n=node(id);for(const p of files(n)){if(!read(p).trim())throw Error('产物为空 '+p);}
 if(id==='plan')tasks();
 if(id==='execute'){for(const t of tasks()){if(t.status!=='done'||!t.evidence)throw Error('任务未完成 '+t.id);validateEvidence(json(t.evidence),s);}}
 if(id==='verify'){validate(s,'execute',{approval:false});testResult(s);}
 if(id==='archive'){validate(s,'execute',{approval:false});testResult(s);syncResult(s);}
 if(approval&&APPROVAL_NODES.includes(id)&&s.approvals[id]?.fingerprint!==fingerprint(s,id))throw Error('需要用户确认或确认已失效: '+id);
}
function drift(s){for(const id of s.completedNodes){if(s.completedHashes[id]!==fingerprint(s,id))throw Error('已完成产物变化，请 reopen '+id);}}
function print(s){console.log(JSON.stringify(s,null,2));console.log('NEXT: '+(s.currentNode?'auto':'done'));if(s.currentNode)console.log('SKILL: sy-comet-'+s.currentNode);}
function boundInputs(s,extra){
 const m={},idx=nodes.findIndex(n=>n.id===s.currentNode);
 for(const p of [...new Set(nodes.slice(0,idx+1).flatMap(files))]){if(p.endsWith('/tasks.json'))continue;if(fs.existsSync(safe(p)))m[p]=sha(read(p));}
 for(const p of extra){if(!fs.existsSync(safe(p)))throw Error('输入文件不存在 '+p);m[p]=sha(read(p));}
 return m;
}
function doctor(){
 const problems=[];
 for(const n of nodes){if(!fs.existsSync(path.join(pkg,'..','sy-comet-'+n.id,'SKILL.md')))problems.push('缺少节点 Skill: sy-comet-'+n.id);}
 for(const t of ['evidence.json','spec-sync.json','test-results.json'])if(!fs.existsSync(path.join(pkg,'templates',t)))problems.push('缺少模板 '+t);
 if(!fs.existsSync(stateFile))console.log('state: 未初始化（可 init 新变更）');
 else{
  let s=null;try{s=JSON.parse(fs.readFileSync(stateFile));}catch(e){problems.push('state.json 损坏: '+e.message+'；人工修复 JSON 或删除后重开');}
  if(s){
   if(s.workflow!==protocol.name)problems.push('state.workflow ('+s.workflow+') 与协议 ('+protocol.name+') 不一致');
   if(s.protocolHash!==sha(JSON.stringify(protocol)))problems.push('protocolHash 不匹配：协议已变更，需迁移 state');
   if(s.currentNode&&!nodes.some(n=>n.id===s.currentNode))problems.push('currentNode 非法: '+s.currentNode);
   if(s.currentNode&&!fs.existsSync(safe(current)))problems.push('currentNode 非空但 '+current+' 目录缺失');
   if(!s.currentNode&&fs.existsSync(safe(current)))problems.push('已归档但 '+current+' 残留（上次归档清理中断），核实后手动删除');
   const docBase=s.currentNode?current:s.archivePath;
   for(const id of s.completedNodes||[]){if(!nodes.some(n=>n.id===id))continue;for(const p of files(node(id))){const ap=docBase?p.replace(current,docBase):p;if(!fs.existsSync(safe(ap)))problems.push('已完成节点 '+id+' 缺产物 '+ap);}}
   if(fs.existsSync(safe(current+'/tasks.json'))){try{for(const t of json(current+'/tasks.json'))if(t.evidence&&!fs.existsSync(safe(t.evidence)))problems.push('任务 '+t.id+' 的 evidence 文件缺失 '+t.evidence);}catch(e){problems.push('tasks.json 损坏: '+e.message);}}
  }
 }
 if(problems.length){console.log('PROBLEMS:');for(const p of problems)console.log('- '+p);process.exitCode=1;}else console.log('OK');
}
try{
 if(cmd==='help'){console.log('yt.mjs init <change-id> | status | approve <node> <用户确认原文> | check | advance | task <id> <status> [evidence] | run <id> [--input <path>]... -- <命令> | handoff | doctor | reopen <node> | archive\n确认节点: '+APPROVAL_NODES.join('/')+'（产物变化后确认自动失效）。验证-修复循环超过 '+MAX_VERIFY_FAILURES+' 次将停止并要求用户决策。证据必须由 run 真实执行生成，禁止手写。\n项目根: COMET_RUN_ROOT 或 cwd。归档前必须 Spec 合并与人工验收；不会自动提交或发布代码。');}
 else if(cmd==='doctor'){doctor();}
 else if(cmd==='init'){
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(arg||''))throw Error('change-id 使用小写字母数字和连字符');
  if(fs.existsSync(stateFile)){const old=state();if(old.currentNode)throw Error('已有进行中变更 '+old.changeId);}
  if(fs.existsSync(safe(current)))throw Error('current 已存在，先检查已有文档，不自动覆盖');
  const s={schemaVersion:1,workflow:protocol.name,protocolHash:sha(JSON.stringify(protocol)),changeId:arg,currentNode:nodes[0].id,completedNodes:[],completedHashes:{},approvals:{},verifyFailures:0,history:[]};
  fs.mkdirSync(safe(current),{recursive:true});save(s,'init');print(s);
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
   if(s.currentNode==='verify'&&i<currentIndex){s.verifyFailures=(s.verifyFailures||0)+1;if(s.verifyFailures>MAX_VERIFY_FAILURES){save(s,'verify-loop-blocked');throw Error('验证-修复循环已达 '+MAX_VERIFY_FAILURES+' 次：停止自动重试，向用户展示失败历史并等待方向选择（继续修复/调整需求/停止）');}}
   s.currentNode=arg;s.completedNodes=s.completedNodes.filter(id=>nodes.findIndex(n=>n.id===id)<i);for(const n of nodes.slice(i)){delete s.approvals[n.id];delete s.completedHashes[n.id];}save(s,'reopen '+arg);print(s);
  }else{
   drift(s);if(!s.currentNode)throw Error('变更已归档');
   if(cmd==='approve'){
    if(arg!==s.currentNode||!APPROVAL_NODES.includes(arg)||!value?.trim())throw Error('只可为当前确认节点记录用户确认原文');
    validate(s,arg,{approval:false});s.approvals[arg]={quote:value,fingerprint:fingerprint(s,arg),at:new Date().toISOString()};save(s,'approve '+arg);print(s);
   }else if(cmd==='run'){
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(arg||''))throw Error('evidence-id 使用小写字母数字和连字符');
    const rest=process.argv.slice(4),sep=rest.indexOf('--');
    if(sep<0||sep===rest.length-1)throw Error('用法: run <id> [--input <path>]... -- <命令>');
    const flags=rest.slice(0,sep),command=rest.slice(sep+1).join(' '),extraInputs=[];
    for(let i=0;i<flags.length;i++){if(flags[i]==='--input'&&flags[i+1])extraInputs.push(flags[++i]);else throw Error('无法识别的参数 '+flags[i]);}
    const r=spawnSync(command,{shell:true,cwd:root,encoding:'utf8',timeout:30*60*1000,maxBuffer:64*1024*1024});
    const log=logsDir+'/'+arg+'.log';
    writeRaw(log,['$ '+command,'',r.stdout||'',r.stderr||'',r.error?'[error] '+r.error.message:'','[exit] '+(r.status===null?'signal '+(r.signal||'?'):r.status)].join('\n'));
    const ev={changeId:s.changeId,status:r.status===0?'passed':'failed',command,recordedAt:new Date().toISOString(),inputs:boundInputs(s,extraInputs),log};
    const ep=evDir+'/'+arg+'.json';write(ep,ev);save(s,'run '+arg+'='+ev.status);
    console.log('EVIDENCE: '+ep);console.log('STATUS: '+ev.status);if(ev.status!=='passed')process.exitCode=1;
   }else if(cmd==='task'){
    if(s.currentNode!=='execute')throw Error('只有执行阶段可更新任务');
    const ts=tasks(),t=ts.find(x=>x.id===arg);if(!t||!['pending','in_progress','blocked','done'].includes(value))throw Error('任务或状态非法');
    if(['in_progress','done'].includes(value)&&t.dependsOn.some(d=>ts.find(x=>x.id===d).status!=='done'))throw Error('任务依赖未完成');
    if(value==='done'){validateEvidence(json(extra[0]),s);t.evidence=extra[0];}else delete t.evidence;
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
