// A conservative offline screen. No conversion, evaluation or network execution.
export const MAX_BYTES = 1048576;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const plain = v => obj(v) && Object.keys(v).length === 0;
const known = new Map([
 ['n8n-nodes-base.manualTrigger', [1]], ['n8n-nodes-base.noOp', [1]],
 ['n8n-nodes-base.set', [3,3.1,3.2,3.3,3.4]],
 ['n8n-nodes-base.httpRequest', [4,4.1,4.2,4.3]],
]);
export function inspectText(text) {
 if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error('Arquivo excede 1 MiB.');
 let workflow; try { workflow = JSON.parse(text); } catch { throw Error('JSON inválido. Nenhum workflow executado.'); }
 return inspect(workflow);
}
export function inspect(w) {
 const findings = [], rows = [], edges = [], order = [];
 const seen = new Set();
 const issue = (level,code,node=null) => { const key=`${level}:${code}:${node}`; if (!seen.has(key)) { seen.add(key); findings.push({level,code,node}); } };
 const unknownKeys = (v, allowed, node) => { if (Object.keys(v).some(k=>!allowed.includes(k))) issue('review','UNRECOGNIZED_FIELDS',node); };
 if (!obj(w)||!Array.isArray(w.nodes)||!obj(w.connections)) throw Error('Selecione um único objeto workflow com nodes e connections.');
 if (w.nodes.length<1||w.nodes.length>8) issue('block','NODE_COUNT');
 if (w.nodes.length>100) throw Error('Workflow fora do limite de inspeção.');
 unknownKeys(w,['name','id','nodes','connections','active','settings','staticData','pinData','tags','versionId','meta','createdAt','updatedAt','versionCounter','triggerCount','isArchived'],null);
 if (w.active === true) issue('review','ACTIVE_WORKFLOW');
 if (w.active!==undefined && typeof w.active!=='boolean') issue('review','INVALID_ACTIVE_FLAG');
 for (const k of ['staticData','pinData']) if (w[k]!==undefined && w[k]!==null && !plain(w[k])) issue('block','PERSISTED_OR_PINNED_DATA');
 if (w.settings!==undefined && !plain(w.settings)) issue('review','WORKFLOW_SETTINGS');
 // Inspect keys/values without putting their contents in the downloadable report.
 const scan = [{value:w,depth:0}]; let count=0;
 while(scan.length){
  const {value,depth}=scan.pop();
  if (++count>30000 || depth>32) { issue('review','STRUCTURE_LIMIT'); break; }
  if(typeof value==='string'){
   if (/\{\{|\}\}|\$(?:json|node|env|vars|input|items|execution|workflow)\b/.test(value)) issue('block','DYNAMIC_EXPRESSION');
   if (/\b(?:bearer\s+\S+|sk-[a-zA-Z0-9]{12,})/i.test(value)) issue('block','POSSIBLE_SECRET');
  } else if(value!==null && typeof value==='object'){
   for(const [key,v] of Object.entries(value)){
    if(/^(?:__proto__|prototype|constructor)$/.test(key)) issue('block','UNSAFE_KEY');
    if(/(?:password|secret|api.?key|access.?token|authorization|cookie|credentials)/i.test(key) && v!==null && v!=='' && !plain(v)) issue('block','CREDENTIAL_OR_SECRET_FIELD');
    scan.push({value:v,depth:depth+1});
   }
  }
 }
 const names=new Map(), ids=new Set();
 w.nodes.forEach((n,i)=>{
  const alias=`N${String(i+1).padStart(2,'0')}`;
  if(!obj(n)){ issue('block','INVALID_NODE',alias); rows.push({node:alias,kind:'unsupported',version:null}); return; }
  if(typeof n.name!=='string'||!n.name.trim()||names.has(n.name)) issue('block','INVALID_OR_DUPLICATE_NODE_NAME',alias);
  else names.set(n.name,{alias,index:i});
  if(typeof n.id!=='string'||!n.id.trim()||ids.has(n.id)) issue('review','MISSING_OR_DUPLICATE_NODE_ID',alias); else ids.add(n.id);
  const type=typeof n.type==='string'?n.type:'';
  rows.push({node:alias,kind:known.has(type)?type.split('.').at(-1):'unsupported',version:typeof n.typeVersion==='number'?n.typeVersion:null});
  if(!known.has(type)) issue('block',/(?:code|function)/i.test(type)?'EXECUTABLE_CODE':'UNSUPPORTED_NODE',alias);
  else if(!known.get(type).includes(n.typeVersion)) issue('review','UNREVIEWED_NODE_VERSION',alias);
  unknownKeys(n,['id','name','type','typeVersion','position','parameters','disabled','notes','notesInFlow','credentials','retryOnFail','maxTries','waitBetweenTries','continueOnFail','alwaysOutputData','executeOnce','onError'],alias);
  if(n.disabled!==undefined && n.disabled!==false) issue('review','DISABLED_OR_INVALID_NODE_FLAG',alias);
  for(const k of ['retryOnFail','continueOnFail','alwaysOutputData','executeOnce']) if(n[k]!==undefined && n[k]!==false) issue('review','RUNTIME_NODE_BEHAVIOR',alias);
  for(const k of ['maxTries','waitBetweenTries','onError']) if(has(n,k)) issue('review','RUNTIME_NODE_BEHAVIOR',alias);
  if(!obj(n.parameters)){ issue('review','INVALID_PARAMETERS',alias); return; }
  const p=n.parameters;
  if(type.endsWith('.manualTrigger')||type.endsWith('.noOp')) { if(!plain(p)) issue('review','UNRECOGNIZED_PARAMETERS',alias); }
  if(type==='n8n-nodes-base.httpRequest'){
   unknownKeys(p,['url','method','authentication','options','sendQuery','sendHeaders','sendBody'],alias);
   if(p.method!==undefined && p.method!=='GET') issue('block','NON_GET_REQUEST',alias);
   if(p.authentication!==undefined && p.authentication!=='none') issue('block','AUTHENTICATED_REQUEST',alias);
   if(p.options!==undefined && !plain(p.options)) issue('review','HTTP_OPTIONS',alias);
   for(const k of ['sendQuery','sendHeaders','sendBody']) if(p[k]!==undefined && p[k]!==false) issue('block','HTTP_EXTRA_PAYLOAD',alias);
   try {
    if(typeof p.url!=='string'||!p.url.trim()) throw Error('Invalid URL type');
    const u=new URL(p.url);
    const host=u.hostname.replace(/\.+$/,'');
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!host.includes('.')||/^\d+\./.test(host)||host.startsWith('[')||/(?:localhost|\.local|\.internal|\.test|\.invalid|\.example|\.onion)$/.test(host)) issue('review','URL_REQUIRES_REVIEW',alias);
   } catch { issue('review','INVALID_URL',alias); }
  }
  if(type==='n8n-nodes-base.set'){
   unknownKeys(p,['mode','assignments','options','includeOtherFields'],alias);
   if(p.mode!==undefined && p.mode!=='manual') issue('block','NON_LITERAL_SET_MODE',alias);
   if(p.options!==undefined && !plain(p.options)) issue('review','SET_OPTIONS',alias);
   if(p.includeOtherFields!==undefined && typeof p.includeOtherFields!=='boolean') issue('review','INVALID_SET_RETENTION',alias);
   const a=p.assignments;
   if(!obj(a)||Object.keys(a).some(k=>k!=='assignments')||!Array.isArray(a.assignments)||!a.assignments.length||a.assignments.length>30) issue('review','INVALID_ASSIGNMENTS',alias);
   else {
    const fieldNames=new Set();
    for(const v of a.assignments){
     if(!obj(v)){issue('review','INVALID_ASSIGNMENT',alias); continue;}
     unknownKeys(v,['id','name','type','value'],alias);
     if(typeof v.name!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v.name)||fieldNames.has(v.name)) issue('review','INVALID_OR_DUPLICATE_ASSIGNMENT_NAME',alias); else fieldNames.add(v.name);
     if(!['string','number','boolean'].includes(v.type)||typeof v.value!==v.type||(v.type==='number'&&!Number.isFinite(v.value))) issue('review','NON_LITERAL_ASSIGNMENT',alias);
    }
   }
  }
 });
 const indegree=new Array(w.nodes.length).fill(0), outgoing=w.nodes.map(()=>[]);
 for(const [from,ports] of Object.entries(w.connections)){
  const src=names.get(from);
  if(!src||!obj(ports)){issue('block','INVALID_CONNECTION_SOURCE'); continue;}
  if(Object.keys(ports).some(k=>k!=='main')) issue('block','NON_MAIN_CONNECTION',src.alias);
  if(!Array.isArray(ports.main)){issue('block','INVALID_CONNECTION_PORT',src.alias); continue;}
  ports.main.forEach((links,output)=>{
   if(!Array.isArray(links)){issue('block','INVALID_CONNECTION_PORT',src.alias);return;}
   if(output!==0&&links.length) issue('block','MULTIPLE_OUTPUT_PORTS',src.alias);
   for(const e of links){
    if(!obj(e)){issue('block','INVALID_CONNECTION_TARGET',src.alias);continue;}
    const dst=names.get(e.node);
    if(!dst||e.type!=='main'||e.index!==0||Object.keys(e).some(k=>!['node','type','index'].includes(k))){issue('block','INVALID_CONNECTION_TARGET',src.alias);continue;}
    outgoing[src.index].push(dst.index); indegree[dst.index]++;
    edges.push({from:src.alias,to:dst.alias});
   }
  });
 }
 if(outgoing.some(x=>x.length>1)||indegree.some(x=>x>1)) issue('block','BRANCH_OR_MERGE');
 const triggers=w.nodes.map((n,i)=>obj(n)&&n.type==='n8n-nodes-base.manualTrigger'?i:-1).filter(i=>i>=0);
 if(triggers.length!==1||indegree[triggers[0]]!==0) issue('block','MANUAL_START_REQUIRED');
 const visited=new Set(); let cur=triggers[0];
 while(cur!==undefined){if(visited.has(cur)){issue('block','CYCLE'); break;}visited.add(cur);order.push(rows[cur].node);cur=outgoing[cur][0];}
 if(visited.size!==w.nodes.length) issue('block','DISCONNECTED_NODES');
 const blocked=findings.some(x=>x.level==='block'), review=findings.some(x=>x.level==='review');
 return {
  schema:'exitforge-screen-v1',status:blocked?'OUT_OF_SCOPE':review?'REVIEW_REQUIRED':'STRUCTURAL_CANDIDATE',
  eligible_for_automatic_migration:false,executed:false,network_calls:0,
  nodes:rows,edges,linear_order:order,findings,
  losses:['Agendamento e execução contínua não transferidos.','Credenciais/OAuth, estado durável e histórico operacional não implementados.','Cardinalidade, defaults, erros HTTP, redirects e versão de runtime exigem confronto separado.'],
  next_checks:['Conferir parâmetros e versão com o dono do workflow.','Preparar entradas e saídas sanitizadas do mesmo fluxo, incluindo falhas.','Comparar a reescrita com execução autorizada no runtime original antes de afirmar equivalência.','Medir custo de operação, teste e manutenção frente a manter o runtime.'],
  limitations:['Triagem estrutural conservadora, não conversão ou execução.','Ausência de alertas não certifica ausência de segredos, estado ou efeitos externos.','Export JSON fornecido não autentica origem; chaves JSON repetidas não são certificadas por JSON.parse.','Relatório omite nomes, URLs, valores e identificadores de credenciais. Hash ainda pode identificar o arquivo.'],
 };
}
export const sample={name:'Exemplo fictício: início e etiqueta',active:false,nodes:[{id:'s1',name:'Inicio',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},{id:'s2',name:'Etiqueta',type:'n8n-nodes-base.set',typeVersion:3.4,position:[200,0],parameters:{mode:'manual',assignments:{assignments:[{id:'a1',name:'report_type',type:'string',value:'example'}]},options:{}}}],connections:{Inicio:{main:[[{node:'Etiqueta',type:'main',index:0}]]}},settings:{}};
