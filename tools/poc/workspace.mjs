export const LIMITS=Object.freeze({requirements:5,checks:20,jsonBytes:1_000_000,evidenceBytes:20_000_000});
export const STATUSES=Object.freeze(['NOT_EXECUTED','PASS','FAIL','UNKNOWN']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=message=>{throw new Error(message);};
const object=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label}: objeto esperado.`);};
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${label}: campo não permitido ${key}.`);for(const key of allowed)if(!own(value,key))fail(`${label}: falta ${key}.`);}
function text(value,label,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(`${label}: texto não vazio, até ${max} caracteres, sem controles.`);return value.trim();}
function id(value,label){if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,40}$/.test(value))fail(`${label}: use 1–40 letras ASCII, números, _ ou -.`);return value;}
export function validatePlan(input){
 keys(input,['schema_version','title','requirements','checks'],'Plano');
 if(input.schema_version!==1)fail('Versão de esquema não suportada.');
 const title=text(input.title,'Nome do plano',200);
 if(!Array.isArray(input.requirements)||input.requirements.length<1||input.requirements.length>LIMITS.requirements)fail('Use 1–5 requisitos.');
 if(!Array.isArray(input.checks)||input.checks.length<1||input.checks.length>LIMITS.checks)fail('Use 1–20 verificações.');
 const allIds=new Set(),requirementIds=new Set();
 const requirements=input.requirements.map((r,index)=>{
  const label=`Requisito ${index+1}`;keys(r,['id','text','source'],label);const rid=id(r.id,label+' ID');if(allIds.has(rid))fail('IDs precisam ser únicos: '+rid);allIds.add(rid);requirementIds.add(rid);
  keys(r.source,['reference','locator'],label+' fonte');
  return{id:rid,text:text(r.text,label+' texto'),source:{reference:text(r.source.reference,label+' referência',1000),locator:text(r.source.locator,label+' localização',300)}};
 });
 const counts=new Map();
 const checks=input.checks.map((c,index)=>{
  const label=`Verificação ${index+1}`;keys(c,['id','requirement_id','procedure','expected','declared_status','observation','evidence'],label);const cid=id(c.id,label+' ID');if(allIds.has(cid))fail('IDs precisam ser únicos: '+cid);allIds.add(cid);
  if(!requirementIds.has(c.requirement_id))fail(label+': requisito de origem inexistente.');counts.set(c.requirement_id,(counts.get(c.requirement_id)||0)+1);
  if(!STATUSES.includes(c.declared_status))fail(label+': status declarado inválido.');
  if(typeof c.observation!=='string'||c.observation.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(c.observation))fail(label+': observação inválida.');
  if(c.declared_status!=='NOT_EXECUTED'&&!c.observation.trim())fail(label+': explique a observação ou a razão do status.');
  if(!Array.isArray(c.evidence)||c.evidence.length>5)fail(label+': no máximo 5 referências de arquivo.');
  const evidence=c.evidence.map((e,n)=>{
   const el=label+` arquivo ${n+1}`;keys(e,['filename','bytes','sha256'],el);
   const filename=text(e.filename,el+' nome',255);if(!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>LIMITS.evidenceBytes)fail(el+': tamanho inválido.');
   if(typeof e.sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256))fail(el+': SHA256 inválido.');
   return{filename,bytes:e.bytes,sha256:e.sha256};
  });
  return{id:cid,requirement_id:c.requirement_id,procedure:text(c.procedure,label+' procedimento'),expected:text(c.expected,label+' resultado esperado'),declared_status:c.declared_status,observation:c.observation.trim(),evidence};
 });
 for(const rid of requirementIds)if(!counts.has(rid))fail('Cada requisito precisa de uma verificação: '+rid);
 return{schema_version:1,title,requirements,checks};
}
export function createValidationGate(){let snapshot=null;return{invalidate(){snapshot=null;},validate(input){snapshot=null;snapshot=validatePlan(input);return this.get();},get(){return snapshot?structuredClone(snapshot):null;},get available(){return snapshot!==null;}};}
export function parsePlan(raw){if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>LIMITS.jsonBytes)fail('JSON limitado a 1 MB.');let value;try{value=JSON.parse(raw);}catch{fail('JSON inválido.');}return validatePlan(value);}
export function summarize(plan){const valid=validatePlan(plan),counts=Object.fromEntries(STATUSES.map(s=>[s,0]));for(const check of valid.checks)counts[check.declared_status]++;return{requirements:valid.requirements.length,checks:valid.checks.length,declared_counts:counts,execution_authenticated:false,sources_authenticated:false,hash_proves_execution:false};}
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return'"'+s.replaceAll('"','""')+'"';}
export function toCSV(input){const plan=validatePlan(input);const cols=['requirement_id','requirement','source_reference','source_locator','check_id','procedure','expected','declared_status','observation','file_names','file_sha256','execution_authenticated'];const req=new Map(plan.requirements.map(r=>[r.id,r]));const rows=plan.checks.map(c=>{const r=req.get(c.requirement_id);return[c.requirement_id,r.text,r.source.reference,r.source.locator,c.id,c.procedure,c.expected,c.declared_status,c.observation,c.evidence.map(e=>e.filename).join(' | '),c.evidence.map(e=>e.sha256).join(' | '),'false'];});return[cols,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export async function sha256(bytes,subtle=globalThis.crypto?.subtle){if(!(bytes instanceof ArrayBuffer))fail('Hash requer bytes de arquivo.');if(bytes.byteLength>LIMITS.evidenceBytes)fail('Arquivo limitado a 20 MB.');if(!subtle)fail('SHA256 requer contexto seguro HTTPS ou localhost.');const digest=await subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
export function createSyntheticDemo(){return{schema_version:1,title:'DEMO SINTÉTICA — permissões de um sistema fictício',requirements:[{id:'R01',text:'Um perfil leitor fictício pode consultar um registro e não pode alterá-lo.',source:{reference:'Especificação fictícia criada para demonstrar o workspace',locator:'Critério sintético 1; não é requisito de cliente'}}],checks:[{id:'C01',requirement_id:'R01',procedure:'Em um ambiente de teste autorizado, entrar com o perfil leitor e tentar consultar o registro fictício.',expected:'A consulta permite leitura do registro previsto.',declared_status:'NOT_EXECUTED',observation:'',evidence:[]},{id:'C02',requirement_id:'R01',procedure:'Com o mesmo perfil, tentar alterar o registro fictício e conferir seu estado posterior.',expected:'A alteração é recusada e o estado original é preservado.',declared_status:'NOT_EXECUTED',observation:'',evidence:[]}]};}

if(typeof document!=='undefined'){
 let plan=createSyntheticDemo(),revision=0,operation=0;const gate=createValidationGate();
 const $=id=>document.getElementById(id),editor=$('requirements'),error=$('error'),result=$('result');
 function invalidate(message='Plano alterado. Valide antes de exportar.') {revision++;gate.invalidate();$('json-export').disabled=true;$('csv-export').disabled=true;result.replaceChildren();$('validation-status').textContent=message;error.textContent='';}
 function reportError(e){invalidate('Nenhuma exportação validada disponível.');error.textContent=e.message||String(e);}
 function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
 function field(label,value,update,options={}){const wrap=el('label',undefined,'field'),caption=el('span',label);wrap.append(caption);const input=document.createElement(options.multiline?'textarea':'input');input.value=value;input.maxLength=options.max||2000;input.readOnly=Boolean(options.readonly);if(!options.multiline)input.type='text';if(options.rows)input.rows=options.rows;input.addEventListener('input',()=>{update(input.value);invalidate();});wrap.append(input);return wrap;}
 function button(text,fn,cls='secondary'){const node=el('button',text,cls);node.type='button';node.addEventListener('click',fn);return node;}
 function nextId(prefix){let n=1;const used=new Set([...plan.requirements,...plan.checks].map(x=>x.id));while(used.has(prefix+String(n).padStart(2,'0')))n++;return prefix+String(n).padStart(2,'0');}
 function newCheck(requirementId){return{id:nextId('C'),requirement_id:requirementId,procedure:'',expected:'',declared_status:'NOT_EXECUTED',observation:'',evidence:[]};}
 function render(){
  $('title').value=plan.title;editor.replaceChildren();$('count').textContent=`${plan.requirements.length}/5 requisitos · ${plan.checks.length}/20 verificações`;
  $('add-requirement').disabled=plan.requirements.length>=LIMITS.requirements;
  for(const req of plan.requirements){
   const section=el('section',undefined,'requirement');const head=el('div',undefined,'row-head');head.append(el('h3','Requisito '+req.id),button('Remover requisito e verificações',()=>{plan.requirements=plan.requirements.filter(r=>r!==req);plan.checks=plan.checks.filter(c=>c.requirement_id!==req.id);invalidate();render();},'quiet'));section.append(head);
   const grid=el('div',undefined,'fields-grid');grid.append(field('ID do requisito (preservado)',req.id,()=>{},{max:40,readonly:true}),field('Referência da fonte',req.source.reference,v=>req.source.reference=v,{max:1000}),field('Localização na fonte',req.source.locator,v=>req.source.locator=v,{max:300}),field('O que precisa ser demonstrado',req.text,v=>req.text=v,{multiline:true,rows:3}));section.append(grid);
   const checkList=el('div',undefined,'checks');for(const check of plan.checks.filter(c=>c.requirement_id===req.id)){
    const card=el('article',undefined,'check');const chead=el('div',undefined,'row-head');chead.append(el('h4','Verificação '+check.id),button('Remover',()=>{plan.checks=plan.checks.filter(c=>c!==check);invalidate();render();},'quiet'));card.append(chead);
    const cg=el('div',undefined,'fields-grid');cg.append(field('ID da verificação (preservado)',check.id,()=>{},{max:40,readonly:true}),field('Procedimento',check.procedure,v=>check.procedure=v,{multiline:true,rows:3}),field('Resultado esperado',check.expected,v=>check.expected=v,{multiline:true,rows:3}));
    const statusLabel=el('label',undefined,'field');statusLabel.append(el('span','Status declarado por você'));const select=el('select');for(const status of STATUSES){const o=el('option',status);o.value=status;select.append(o);}select.value=check.declared_status;select.addEventListener('change',()=>{check.declared_status=select.value;invalidate();});statusLabel.append(select);cg.append(statusLabel,field('Observação / motivo (obrigatório salvo NOT_EXECUTED)',check.observation,v=>check.observation=v,{multiline:true,rows:3}));card.append(cg);
    const evidence=el('div',undefined,'evidence');evidence.append(el('h5','Referências de arquivos locais'),el('p','O hash identifica bytes. Não comprova execução, origem, interpretação ou autenticidade. Conteúdo do arquivo não é exportado.','small'));
    for(const file of check.evidence){const fileRow=el('div',undefined,'file-row');fileRow.append(el('span',`${file.filename} · ${file.bytes} bytes`),el('code',file.sha256),button('Remover referência',()=>{check.evidence=check.evidence.filter(x=>x!==file);invalidate();render();},'quiet'));evidence.append(fileRow);}
    const fileLabel=el('label',undefined,'file-label');fileLabel.append(el('span','Vincular arquivo e calcular SHA256 (até 20 MB)'));const input=el('input');input.type='file';input.disabled=check.evidence.length>=5;input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;const capturedPlan=plan,token=++operation;invalidate('Calculando hash local; exportação indisponível.');const startRevision=revision;input.disabled=true;try{if(file.size>LIMITS.evidenceBytes)fail('Arquivo limitado a 20 MB.');if(!file.name||file.name.length>255)fail('Nome de arquivo inválido.');const bytes=await file.arrayBuffer();const digest=await sha256(bytes);if(token!==operation||plan!==capturedPlan||revision!==startRevision||!plan.checks.includes(check))fail('Plano mudou durante o cálculo. Selecione o arquivo novamente.');check.evidence.push({filename:file.name,bytes:file.size,sha256:digest});invalidate('Hash vinculado. Valide o plano antes de exportar.');render();}catch(e){if(plan===capturedPlan&&token===operation)reportError(e);}finally{input.disabled=false;input.value='';}});fileLabel.append(input);evidence.append(fileLabel);card.append(evidence);checkList.append(card);
   }section.append(checkList);const add=button('+ Adicionar verificação',()=>{if(plan.checks.length>=LIMITS.checks)return;plan.checks.push(newCheck(req.id));invalidate();render();});add.disabled=plan.checks.length>=LIMITS.checks;section.append(add);editor.append(section);
  }
 }
 $('title').addEventListener('input',()=>{plan.title=$('title').value;invalidate();});
 $('add-requirement').addEventListener('click',()=>{if(plan.requirements.length>=LIMITS.requirements)return;const req={id:nextId('R'),text:'',source:{reference:'',locator:''}};plan.requirements.push(req);if(plan.checks.length<LIMITS.checks)plan.checks.push(newCheck(req.id));invalidate();render();});
 $('demo').addEventListener('click',()=>{operation++;plan=createSyntheticDemo();invalidate('Exemplo sintético carregado. Nenhuma verificação foi executada.');render();});
 $('blank').addEventListener('click',()=>{operation++;plan={schema_version:1,title:'',requirements:[{id:'R01',text:'',source:{reference:'',locator:''}}],checks:[]};plan.checks.push(newCheck('R01'));invalidate('Plano em branco. Preencha fonte, procedimento e resultado esperado.');render();});
 $('import').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;operation++;const token=operation;invalidate('Importação em conferência. Nenhum resultado anterior pode ser exportado.');const importRevision=revision;try{if(file.size>LIMITS.jsonBytes)fail('JSON limitado a 1 MB.');const raw=await file.text();if(token!==operation||revision!==importRevision)fail('Plano mudou durante a importação. Tente novamente.');const candidate=parsePlan(raw);plan=candidate;invalidate('Plano importado. Status e hashes importados são declarações não autenticadas.');render();}catch(err){if(token===operation)reportError(err);}finally{e.target.value='';}});
 $('validate').addEventListener('click',()=>{invalidate('Conferindo estrutura do plano…');try{const snapshot=gate.validate(plan);const summary=summarize(snapshot);$('json-export').disabled=false;$('csv-export').disabled=false;$('validation-status').textContent='Estrutura válida. Isso não autentica o ensaio ou os arquivos.';result.append(el('h3',`${summary.requirements} requisitos · ${summary.checks} verificações`));const badges=el('div',undefined,'badges');for(const [status,count]of Object.entries(summary.declared_counts))badges.append(el('span',`${status}: ${count}`));result.append(badges,el('p','Todos os status são declarados. Execução autenticada: NÃO · Fontes autenticadas: NÃO.','small'));const table=el('table');const thead=el('thead'),hr=el('tr');for(const h of ['Verificação','Requisito','Status declarado','Arquivos referenciados'])hr.append(el('th',h));thead.append(hr);table.append(thead);const tbody=el('tbody');for(const c of snapshot.checks){const tr=el('tr');for(const v of [c.id,c.requirement_id,c.declared_status,String(c.evidence.length)])tr.append(el('td',v));tbody.append(tr);}table.append(tbody);const wrap=el('div',undefined,'table-wrap');wrap.append(table);result.append(wrap);}catch(e){reportError(e);}});
 function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('json-export').addEventListener('click',()=>{if(!gate.available)return;try{const snapshot=gate.get();download(JSON.stringify(snapshot,null,2)+'\n','application/json','poc-plan-declared.json');}catch(e){reportError(e);}});
 $('csv-export').addEventListener('click',()=>{if(!gate.available)return;try{download(toCSV(gate.get()),'text/csv;charset=utf-8','poc-checklist-declared.csv');}catch(e){reportError(e);}});
 invalidate('Exemplo sintético: plano de ensaio, sem execução. Preencha ou valide para inspecionar.');render();
}
