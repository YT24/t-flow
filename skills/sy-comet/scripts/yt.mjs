#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
// 需求编号模式与覆盖校验：PRD 里的需求编号必须被 test-results.json 中已通过必测用例的 id 覆盖，
// 否则"必测项"完全由被测方自定义，需求与测试之间没有可追溯性（历史缺陷）。
const REQ_PATTERN=cfg.requirementIdPattern??'REQ-\\d+';
const REQ_COVERAGE=cfg.requireCoverage!==false;
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
// 读取某 id 的全部真实执行记录（attempts/<id>/<runId>.json），用于阶段隔离与留痕核对。
function attemptsOf(id){
 const dir=evDir+'/attempts/'+id;if(!fs.existsSync(safe(dir)))return [];
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
  const m=/^docs\/sy-comet\/current\/evidence\/([^/]+)\.json$/.exec(evPath.split(path.sep).join('/'));
  if(!m)throw Error('证据路径必须是 '+evDir+'/<id>.json');
  if(m[1]!==e.id)throw Error('证据文件与内容 id 不一致（路径 '+m[1]+'，内容 '+e.id+'）：请重新运行 run '+m[1]);
 }
 // (2)(3) 必须有对应的 attempts 记录，且内容与固定路径一致。
 const ap=evDir+'/attempts/'+e.id+'/'+e.runId+'.json';
 if(!fs.existsSync(safe(ap)))throw Error('缺少该证据的执行记录 '+ap+'：证据须由 run '+e.id+' 真实生成，不能复制或手写');
 let stored;try{stored=json(ap);}catch(err){throw Error('执行记录损坏 '+ap+': '+err.message);}
 if(stored.runId!==e.runId||stored.id!==e.id)throw Error('执行记录与证据不匹配: '+ap);
 if(json(evDir+'/'+e.id+'.json').runId!==e.runId)throw Error('验证证据不是最新执行结果');
 if(e.changeId!==s.changeId||e.status!=='passed'||!e.command||!e.recordedAt||!e.inputs||!Object.keys(e.inputs).length)throw Error('验证证据字段缺失或未通过');
 for(const [p,entries]of Object.entries(e.directories||{})){
  if(JSON.stringify(expandInput(p).map(([rel])=>rel).sort())!==JSON.stringify(entries))throw Error('验证证据目录已变化: '+p);
 }
 for(const [p,h]of Object.entries(e.inputs)){if(sha(fs.readFileSync(safe(p)))!==h)throw Error('验证证据过期: '+p);}
 if(!e.log||!e.log.split(path.sep).join('/').startsWith(logsDir+'/'))throw Error('证据日志必须位于 '+logsDir+'/ 下');
 if(!read(e.log).trim())throw Error('缺少验证日志');
}
function testResult(s){const r=json(current+'/test-results.json');if(r.changeId!==s.changeId||!Array.isArray(r.tests)||!r.tests.length)throw Error('缺少本次测试结果');for(const t of r.tests){if(typeof t.required!=='boolean'||!['passed','failed','not_run'].includes(t.status))throw Error('测试结果非法');if(t.status==='failed')throw Error('测试失败 '+t.id);if(t.required&&t.status!=='passed')throw Error('必测项未通过 '+t.id);if(t.status==='passed'){
  // verify 用例必须由 verify 阶段自己执行：不得复用 execute 阶段的任务证据，
  // 否则"测试"可能从未作为测试运行过（历史缺陷）。
  // 判据是「被引用证据所属 id 的执行阶段」，且只看该 runId 那次执行，避免同一 id
  // 在两个阶段都被合法使用时误伤。
  const m=/^docs\/sy-comet\/current\/evidence\/([^/]+)\.json$/.exec(String(t.evidence).split(path.sep).join('/'));
  if(m&&m[1]!==String(t.id))throw Error('用例 '+t.id+' 引用了 '+m[1]+' 的证据：请用 run '+t.id+' 执行该用例本身');
  const cur=m?json(evDir+'/'+m[1]+'.json'):null;
  const rec=(m&&cur)?attemptsOf(m[1]).find(r=>r.runId===cur.runId):null;
  if(rec&&rec.node&&rec.node!=='verify')throw Error('用例 '+t.id+' 复用了 '+rec.node+' 阶段的证据（'+m[1]+'）：请在 verify 阶段用 run '+t.id+' 执行该用例本身');
  validateEvidence(json(t.evidence),s,{path:t.evidence});
 }}if(!r.tests.some(t=>t.required))throw Error('没有定义必测项');coverage(r);return r;}
// 需求覆盖：每个需求至少有一个通过的必测用例。
function coverage(r){
 if(!REQ_COVERAGE)return;
 let re;try{re=new RegExp(REQ_PATTERN,'g');}catch(e){throw Error('requirementIdPattern 不是合法正则: '+REQ_PATTERN);}
 const prd=read(current+'/prd.md'),reqs=new Set(prd.match(re)||[]);
 if(!reqs.size)throw Error('PRD 未包含任何需求编号（模式 '+REQ_PATTERN+'）：无法建立需求与测试的对应关系；若本项目不使用编号，请在 protocol config 置 requireCoverage:false');
 const ids=r.tests.filter(t=>t.required&&t.status==='passed').map(t=>String(t.id));
 // 按编号边界匹配：REQ-011 不应被当作覆盖 REQ-01（后缀须结束或接非数字分隔符）。
 const uncovered=[...reqs].filter(q=>!ids.some(id=>new RegExp('(^|[^0-9A-Za-z])'+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^0-9])').test(id)));
 if(uncovered.length)throw Error('以下需求缺少已通过的必测用例: '+uncovered.join(', ')+'（用例 id 须包含需求编号，如 '+[...reqs][0]+' 或 '+[...reqs][0]+'-场景）');
}
function syncResult(s){const p=current+'/spec-sync.json';if(!fs.existsSync(safe(p))){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}const r=json(p);if(r.changeId!==s.changeId||!Array.isArray(r.files))throw Error('Spec 同步证据非法');if(!r.files.length){if(SPEC_REQUIRED)throw Error('缺少 Spec 同步证据');return;}for(const f of r.files){if(!f.source.startsWith(current+'/')||!f.target.startsWith(SPEC_PREFIX))throw Error('Spec 路径不正确（目标须以 '+SPEC_PREFIX+' 开头）');if(sha(read(f.source))!==f.sourceHash||sha(read(f.target))!==f.targetHash)throw Error('Spec 同步证据过期');}if(r.reviewed!==true)throw Error('Spec 合并未核对');}
function validate(s,id,{approval=true}={}){
 const n=node(id);for(const p of files(n)){if(p.endsWith('/spec-sync.json')&&!SPEC_REQUIRED&&!fs.existsSync(safe(p)))continue;if(!read(p).trim())throw Error('产物为空 '+p);}
 if(id==='plan')tasks();
 if(id==='execute'){for(const t of tasks()){if(t.status!=='done'||!t.evidence)throw Error('任务未完成 '+t.id);validateEvidence(json(t.evidence),s,{path:t.evidence});}}
 if(id==='verify'){validate(s,'execute',{approval:false});testResult(s);}
 if(id==='archive'){validate(s,'execute',{approval:false});testResult(s);syncResult(s);}
 if(approval&&APPROVAL_NODES.includes(id)&&s.approvals[id]?.fingerprint!==fingerprint(s,id))throw Error('需要用户确认或确认已失效: '+id);
}
function drift(s){for(const id of s.completedNodes){if(s.completedHashes[id]!==fingerprint(s,id))throw Error('已完成产物变化，请 reopen '+id);}}
function print(s){console.log(JSON.stringify(s,null,2));if(s.currentNode){console.log('NEXT: '+s.currentNode+(APPROVAL_NODES.includes(s.currentNode)?'（用户确认门禁，approve 记录确认原文后才能 advance）':''));console.log('SKILL: sy-comet-'+s.currentNode);}else console.log('NEXT: done');}
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
 for(const p of [...new Set(nodes.slice(0,idx).flatMap(files))]){if(p.endsWith('/tasks.json'))continue;if(fs.existsSync(safe(p)))m[p]=sha(read(p));}
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
   fs.symlinkSync(path.relative(path.dirname(dst),src),dst);
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
 for(const n of nodes){if(!fs.existsSync(path.join(pkg,'..','sy-comet-'+n.id,'SKILL.md')))problems.push('缺少节点 Skill: sy-comet-'+n.id);}
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
 if(fs.existsSync(safe(current+'/ui.md'))){
  let st=null;try{st=JSON.parse(fs.readFileSync(stateFile));}catch{}
  const rec=st?.uiSkill||null;
  const uiSkipped=!!st?.skipped?.ui;
  if(st&&st.currentNode&&!uiSkipped&&!rec&&nodes.findIndex(n=>n.id===st.currentNode)>nodes.findIndex(n=>n.id==='ui'))
   problems.push('ui.md 已产出但未记录所用设计 Skill：运行 ui-use <Skill名> 记录');
  if(rec&&!rec.used)problems.push('ui-use 记录缺少所用 Skill 名');
  if(rec&&rec.primaryAvailable===false&&!rec.used)
   problems.push('主 Skill 不可用时未记录实际所用 Skill');
 }
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
 if(cmd==='help'){console.log(`yt.mjs init <change-id> | status | approve <node> [用户确认原文] | decide [用户决策原文] | skip <node> <原因> | check | advance | task <id> <status> [evidence] | run <id> [--input <路径>]... [--expect <正则>]... [--min-output <字符数>] [--timeout <秒>] -- <命令> | ensure-skills | ui-routing | ui-use [Skill名] | handoff | doctor | reopen <node> | migrate | archive
确认节点: ${APPROVAL_NODES.join('/')}（产物变化后确认自动失效；确认/决策原文可经 stdin 传入）。可跳过节点（协议声明）: ${nodes.filter(n=>n.skippable).map(n=>n.id).join('/')||'无'}；skip 记录原因并直接进入下一节点，reopen 前序节点会清除其后的跳过记录。
证据必须由 run 真实执行生成（限 execute/verify 阶段），禁止手写；execute 阶段证据 id 须为 tasks.json 中的任务 id，任务 modules 必须非空且路径真实存在、自动计入证据输入，--input 支持文件或目录（目录递归展开，跳过 .git/node_modules）。证据至少要绑定一个实现文件，只绑定本工作流文档会被拒绝。
证据不可复制冒用：校验会核对「证据路径中的 id 与文件内容 id 一致」，并要求存在对应的 attempts/<id>/<runId>.json 真实执行记录；verify 用例须在 verify 阶段自行执行，不得引用 execute 任务证据；证据日志必须位于 logs/ 下。只改一处文件无法伪造通过。
断言：--expect <正则> 要求输出命中（可重复多次），--min-output 要求输出不少于 N 字符；与退出码同时满足才算 passed。不用断言时脚本会告警——run 本身不校验命令语义，请自行确保命令真实覆盖被测内容。参数校验在命令执行前完成；固定证据路径记录最新结果，失败阻断推进；每次执行的证据与日志独立保留。
需求覆盖：prd.md 里的需求编号（模式 ${REQ_PATTERN}）必须被 test-results.json 中已通过必测用例的 id 覆盖，缺项阻断 verify；不使用编号的项目置 config.requireCoverage:false。
从 verify 回退且存在 failed 测试才计验证-修复次数，超过 ${MAX_VERIFY_FAILURES} 次停止并要求用户决策，decide 记录用户决策原文后解除。协议文件变更后运行 migrate 迁移进行中的状态。
UI 设计 Skill：主 ${UI_ROUTING?UI_ROUTING.primary:'ui-ux-pro-max'}，兜底 ${UI_ROUTING?UI_ROUTING.fallback:'frontend-design'}（ui-routing 查看；ui-use [Skill名] 记录实际所用）。缺失时运行 ensure-skills 自动安装到项目 .agents/skills/ 并链接 .claude/skills/（Claude 与 agent 两条发现路径都可用）。
Spec 合并目标前缀: ${SPEC_PREFIX}（protocol config 可改；无正式 Spec 的项目置 specSyncRequired:false）。项目根: COMET_RUN_ROOT 或 cwd。归档前必须人工验收；不会自动提交或发布代码。`);}
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
  const used=arg?.trim()||(primaryOk?primary:fallback);
  if(!used)throw Error('ui-use 需要 Skill 名，或先配置 uiSkillRouting');
  if(used!==primary&&used!==fallback)throw Error('所用 Skill 须为 '+primary+' 或 '+fallback+'（协议 uiSkillRouting 可改，改了需 migrate）');
  if(!skillAvailable(used)){
   const res=ensureUiSkills({auto:true});
   const one=res.find(r=>r.name===used);
   console.log('AUTO: '+(one?one.action:'已尝试自动安装 '+used));
   if(!skillAvailable(used))throw Error('Skill '+used+' 仍不可用：'+((one||{}).action||'请手动放置'));
  }
  s.uiSkill={used,primary,primaryAvailable:primaryOk,at:new Date().toISOString()};
  save(s,'ui-use '+used);print(s);
  console.log('USED: '+used+(used===primary?'（主 Skill）':'（兜底 Skill；主 Skill '+primary+(primaryOk?'可用但你选择了兜底':'不可用')+'）'));
  if(used!==primary)console.log('WARN: 未使用主 Skill '+primary+'，请在 ui.md 说明原因并自行补齐五态与实测结论');
 }
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
  // 先使用旧协议指纹检查原有绑定，避免迁移替改动过的产物重新背书。
  if(s.currentNode){
   const changed=nodes.findIndex(n=>{
    if(!s.completedNodes.includes(n.id)&&!s.approvals[n.id])return false;
    try{return (s.completedNodes.includes(n.id)&&s.completedHashes[n.id]!==fingerprint(s,n.id)) || (s.approvals[n.id]&&s.approvals[n.id].fingerprint!==fingerprint(s,n.id)) || (s.completedNodes.includes(n.id)&&n.approval&&!s.approvals[n.id]);}catch{return true;}
   });
   if(changed>=0){
    s.currentNode=nodes[changed].id;s.completedNodes=s.completedNodes.filter(id=>nodes.findIndex(n=>n.id===id)<changed);
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
    if(sep<0||sep===rest.length-1)throw Error('用法: run <id> [--input <路径>]... [--expect <正则>]... [--min-output <字符数>] [--timeout <秒>] -- <命令>');
    const flags=rest.slice(0,sep),cmdArgs=rest.slice(sep+1),extraInputs=[];
    let timeoutMs=30*60*1000,expects=[],minOutput=0;
    for(let i=0;i<flags.length;i++){
     if(flags[i]==='--input'&&flags[i+1])extraInputs.push(flags[++i]);
     else if(flags[i]==='--expect'&&flags[i+1])expects.push(flags[++i]);
     else if(flags[i]==='--min-output'&&flags[i+1]){const n=Number(flags[++i]);if(!Number.isSafeInteger(n)||n<0)throw Error('--min-output 需为非负数');minOutput=n;}
     else if(flags[i]==='--timeout'&&flags[i+1]){const sec=Number(flags[++i]);if(!Number.isFinite(sec)||!Number.isSafeInteger(sec*1000)||sec<=0)throw Error('--timeout 需为正数秒');timeoutMs=sec*1000;}
     else throw Error('无法识别的参数 '+flags[i]);
    }
    const patterns=expects.map(pat=>{try{return new RegExp(pat,'m');}catch(e){throw Error('--expect 不是合法正则: '+pat+' ('+e.message+')');}});
    const command=cmdArgs.map(shellQuote).join(' ');
    // 先算证据输入并校验，再执行命令：否则命令已产生副作用（写库、发请求、改文件）才因参数非法报错。
    const inputs=boundInputs(s,extraInputs),inputRoots=[...extraInputs];
    if(s.currentNode==='execute'){
     const ts=json(current+'/tasks.json'),t=Array.isArray(ts)?ts.find(x=>x.id===arg):null;
     // execute 阶段证据 id 必须是已声明的任务：否则会生成无法登记、只污染证据目录的孤儿证据。
     if(!t)throw Error('execute 阶段的证据 id 必须是 tasks.json 中的任务 id：未找到任务 '+arg);
     {
      const bad=(t.modules||[]).filter(m=>{try{return !fs.existsSync(safe(m));}catch{return true;}});
      if(bad.length)throw Error('任务 '+arg+' 的 modules 路径不存在或非法: '+bad.join(', ')+'（modules 须为项目内真实相对路径，证据输入绑定依赖它）');
      Object.assign(inputs,boundInputs(s,t.modules));inputRoots.push(...t.modules);
     }
    }
    // 证据输入必须至少覆盖一个非文档（源码/配置）文件，否则该证据无法反映实现变化。
    const docPrefix=current+'/';
    if(!Object.keys(inputs).some(p=>!p.startsWith(docPrefix)))throw Error('证据输入只包含本工作流文档，未绑定任何实现文件：请用 --input 指定相关源码，或检查任务 modules');
    if(!expects.length&&minOutput<=0)console.error('WARN: 未使用 --expect/--min-output，证据仅以退出码判定；命令语义无法被脚本校验。');
    const directories=Object.fromEntries([...new Set(inputRoots)].filter(p=>fs.statSync(safe(p)).isDirectory()).map(p=>[p,expandInput(p).map(([rel])=>rel).sort()]));
    const r=spawnSync(command,{shell:true,cwd:root,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024});
    const out=(r.stdout||'')+'\n'+(r.stderr||'');
    // 断言：退出码 0 且全部 --expect 模式命中、输出量达标，才算 passed。
    const unmet=expects.filter((pat,i)=>!patterns[i].test(out));
    const bodyLen=out.trim().length;
    const ok=r.status===0&&!unmet.length&&bodyLen>=minOutput;
    const runId=crypto.randomUUID(),log=logsDir+'/'+arg+'-'+runId+'.log';
    writeRaw(log,['$ '+command,'',r.stdout||'',r.stderr||'',r.error?'[error] '+r.error.message:'','[exit] '+(r.status===null?'signal '+(r.signal||'?'):r.status),
     expects.length?'[expect] '+expects.map(p=>p+' -> '+(unmet.includes(p)?'MISS':'HIT')).join('; '):'',
     minOutput?'[min-output] '+minOutput+' (actual '+bodyLen+')':''].filter(Boolean).join('\n'));
    const ev={schemaVersion:2,id:arg,runId,node:s.currentNode,directories,changeId:s.changeId,status:ok?'passed':'failed',command,recordedAt:new Date().toISOString(),inputs,log,
     ...(expects.length?{expects}:{}),...(minOutput?{minOutput}:{})};
    const ep=evDir+'/'+arg+'.json';
    // 每次执行保存独立记录；固定路径始终指向最新结果，包括失败。
    write(evDir+'/attempts/'+arg+'/'+runId+'.json',ev);
    write(ep,ev);
    save(s,'run '+arg+'='+ev.status);
    console.log('EVIDENCE: '+ep);console.log('STATUS: '+ev.status);if(!ok)process.exitCode=1;
   }else if(cmd==='task'){
    if(s.currentNode!=='execute')throw Error('只有执行阶段可更新任务');
    const ts=tasks(),t=ts.find(x=>x.id===arg);if(!t||!['pending','in_progress','blocked','done'].includes(value))throw Error('任务或状态非法');
    if(['in_progress','done'].includes(value)&&t.dependsOn.some(d=>ts.find(x=>x.id===d).status!=='done'))throw Error('任务依赖未完成');
    if(value==='done'){const expect=current+'/evidence/'+arg+'.json';if(extra[0]!==expect)throw Error('证据须为 '+expect+'（先用 run '+arg+' 生成）');validateEvidence(json(extra[0]),s,{path:extra[0]});t.evidence=extra[0];}else delete t.evidence;
    if(t.status==='done'&&value!=='done'&&ts.some(x=>x.dependsOn.includes(t.id)&&x.status==='done'))throw Error('先重开依赖本任务的已完成任务');
    t.status=value;write(current+'/tasks.json',ts);save(s,'task '+arg+'='+value);print(s);
   }else if(['check','advance','archive'].includes(cmd)){
    validate(s,s.currentNode,{approval:cmd!=='check'});
    if(cmd==='check'){console.log(APPROVAL_NODES.includes(s.currentNode)&&s.approvals[s.currentNode]?.fingerprint!==fingerprint(s,s.currentNode)?'ARTIFACTS_READY: 等待用户确认':'READY');print(s);}
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
