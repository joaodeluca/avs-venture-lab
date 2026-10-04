'use strict';
(function(root){
 const core=typeof module!=='undefined'&&module.exports?require('./catalog.js'):null;
 const statuses={request_documentation:'Pedir documentação',retain_separate:'Manter registros separados',declared_reconciled:'Alinhamento declarado para revisão'};
 const encoder=new TextEncoder(),MAX_BYTES=4000000;
 const clone=value=>structuredClone(value);
 const missing=v=>v==null||typeof v==='string'&&!v.trim();
 function canonical(value,depth=0){if(depth>20)throw Error('Dados demasiado profundos.');if(value===null)return 'null';if(typeof value==='number'&&!Number.isFinite(value)||!['string','number','boolean','object'].includes(typeof value))throw Error('Valor não representável em JSON.');if(typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';}
 async function hash(rows){const bytes=encoder.encode(canonical(rows));const cryptoAPI=typeof crypto!=='undefined'?crypto:require('node:crypto').webcrypto;return Array.from(new Uint8Array(await cryptoAPI.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
 function strictJSON(text){
  if(typeof text!=='string'||encoder.encode(text).length>MAX_BYTES)throw Error('Pacote excede 4 MB.');let i=0;
  function ws(){while(/\s/.test(text[i]||'')&&i<text.length){if(!' \t\r\n'.includes(text[i]))throw Error('Espaço JSON inválido.');i++;}}
  function str(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i));}throw Error('Texto JSON não fechado.');}
  function value(depth){if(depth>20)throw Error('Pacote JSON demasiado profundo.');ws();const c=text[i];if(c==='"')return str();if(c==='{'){i++;const obj=Object.create(null),seen=new Set();ws();if(text[i]==='}'){i++;return obj;}while(true){ws();if(text[i]!=='"')throw Error('Chave JSON inválida.');const k=str();if(seen.has(k))throw Error('Chave JSON repetida: '+k);seen.add(k);ws();if(text[i++]!==':')throw Error('Separador JSON inválido.');obj[k]=value(depth+1);ws();const end=text[i++];if(end==='}')return obj;if(end!==',')throw Error('Objeto JSON inválido.');}}if(c==='['){i++;const arr=[];ws();if(text[i]===']'){i++;return arr;}while(true){arr.push(value(depth+1));if(arr.length>4000)throw Error('Array demasiado longo.');ws();const end=text[i++];if(end===']')return arr;if(end!==',')throw Error('Array JSON inválido.');}}const match=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!match)throw Error('Valor JSON inválido.');i+=match[0].length;const parsed=JSON.parse(match[0]);if(typeof parsed==='number'&&!Number.isFinite(parsed))throw Error('Número JSON não finito.');return parsed;}
  const parsed=value(0);ws();if(i!==text.length)throw Error('Conteúdo após JSON.');return parsed;
 }
 function boundedRows(input,validate){canonical(input);const serialized=JSON.stringify(input);if(encoder.encode(serialized).length>1000000)throw Error('Originais excedem 1 MB.');return validate(strictJSON(serialized));}
 const forbiddenClaims=new Set(['sources_authenticated','merge_approved','substitution_approved','authenticity_verified','completeness_verified','authenticated','approved','verified']);
 function rejectClaims(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(forbiddenClaims.has(key)&&item!==false)throw Error('Originais não podem declarar aprovação ou autenticação: '+key);rejectClaims(item);}}
 function targets(rows,summarize){const list=rows.map(r=>({key:'row:'+r.row_id,label:'Registro '+r.row_id,kind:'row',row_ids:[r.row_id]}));for(const g of summarize(rows).groups_to_review)list.push({key:'group:'+JSON.stringify(g.row_ids.slice().sort()),label:'Grupo '+g.manufacturer+' / '+g.code,kind:'group',row_ids:g.row_ids.slice().sort()});return list;}
 function declaredText(v,name,max){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(name+' precisa ser texto não vazio até '+max+' caracteres.');return v;}
 function validateDecision(d,available){if(!d||typeof d!=='object'||Array.isArray(d))throw Error('Decisão inválida.');const allowed=['target_key','status','justification','declared_reference'];if(Object.keys(d).some(k=>!allowed.includes(k)))throw Error('Campo não reconhecido na decisão.');if(!available.some(t=>t.key===d.target_key))throw Error('Decisão aponta para alvo inexistente neste lote.');if(!Object.hasOwn(statuses,d.status))throw Error('Status de revisão inválido.');return {target_key:d.target_key,status:d.status,justification:declaredText(d.justification,'Justificativa',3000),declared_reference:declaredText(d.declared_reference,'Referência declarada',1000)};}
 async function createWorkspace(doc,origin,validate=core.validateRows){
  const rows=boundedRows(doc,validate);rejectClaims(doc);
  const workspace={format:'avs.catalog.review.v1',batch_sha256:await hash(rows),origin:declaredText(origin,'Origem declarada',500),rows,decisions:[],sources_authenticated:false,merge_approved:false,substitution_approved:false};
  if(Object.keys(doc).some(key=>key!=='rows')){
   workspace.format='avs.catalog.review.v2';workspace.original_document=clone(doc);
   workspace.document_sha256=await hash(workspace.original_document);
  }
  canonical(workspace);return workspace;
 }
 function saveDecision(workspace,decision,summarize=core.summarizeCatalog){const validated=validateDecision(decision,targets(workspace.rows,summarize));return {...clone(workspace),decisions:[...workspace.decisions.filter(d=>d.target_key!==validated.target_key),validated]};}
 function removeDecision(workspace,key){return {...clone(workspace),decisions:workspace.decisions.filter(d=>d.target_key!==key).map(clone)};}
 function exportPackage(workspace){rejectClaims(workspace);const output=JSON.stringify(workspace,null,2)+'\n';if(encoder.encode(output).length>MAX_BYTES)throw Error('Pacote excede 4 MB.');return output;}
 async function importPackage(text,validate=core.validateRows,summarize=core.summarizeCatalog){
  const p=strictJSON(text),allowed=['format','batch_sha256','origin','rows','decisions','sources_authenticated','merge_approved','substitution_approved'];
  if(p?.format==='avs.catalog.review.v2')allowed.push('original_document','document_sha256');
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(p,k)))throw Error('Formato de pacote não reconhecido.');
  if(!['avs.catalog.review.v1','avs.catalog.review.v2'].includes(p.format)||p.sources_authenticated!==false||p.merge_approved!==false||p.substitution_approved!==false)throw Error('Pacote não pode autenticar fontes ou aprovar substituição/mesclagem.');
  const doc=p.format==='avs.catalog.review.v2'?p.original_document:{rows:p.rows};
  const workspace=await createWorkspace(doc,p.origin,validate);
  if(workspace.format!==p.format||p.batch_sha256!==workspace.batch_sha256)throw Error('Hash do lote diverge: revisões não pertencem a estes originais.');
  if(p.format==='avs.catalog.review.v2'&&(p.document_sha256!==workspace.document_sha256||canonical(p.rows)!==canonical(workspace.rows)))throw Error('Hash do documento completo ou registros divergem.');
  if(!Array.isArray(p.decisions)||p.decisions.length>2000)throw Error('Revisões inválidas ou excessivas.');const available=targets(workspace.rows,summarize),seen=new Set();
  workspace.decisions=p.decisions.map(d=>{const candidate=validateDecision(d,available);if(seen.has(candidate.target_key))throw Error('Revisão duplicada para o mesmo alvo.');seen.add(candidate.target_key);return candidate;});return workspace;
 }
 // Raw CSV preserves values; the separate spreadsheet copy prefixes dangerous
 // cells, including headers, with an apostrophe and records each transformation.
 const cellText=value=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
 const quoteCSV=value=>'"'+value.replaceAll('"','""')+'"';
 function csvText(headers,rows,safe,audit,label){
  const lines=[headers,...rows];return lines.map((row,index)=>row.map((value,col)=>{
   let text=cellText(value);if(safe&&(/^[\t\r\n]/.test(text)||/^\s*[=+\-@]/u.test(text))){audit.push({file:label,row:index,column:col+1,header:headers[col],original:text,exported:"'"+text});text="'"+text;}
   return quoteCSV(text);
  }).join(',')).join('\r\n')+'\r\n';
 }
 async function exportCsvDelivery(input,validate=core.validateRows,summarize=core.summarizeCatalog){
  const workspace=await importPackage(exportPackage(input),validate,summarize);
  const original=workspace.original_document||{rows:workspace.rows},keys=[...new Set(workspace.rows.flatMap(row=>Object.keys(row)))];
  let prefix='__avs_';while(keys.some(key=>key.startsWith(prefix)))prefix='_'+prefix;
  const metadataColumns={row_reference:prefix+'row_reference',review:prefix+'row_review_json',document_hash:prefix+'document_sha256'};
  const documentHash=workspace.document_sha256||await hash(original);
  const headers=[...keys,...Object.values(metadataColumns)],rows=workspace.rows.map((row,index)=>[...keys.map(key=>row[key]),'catalog-provenance.json#/original_document/rows/'+index,workspace.decisions.filter(d=>d.target_key==='row:'+row.row_id),documentHash]);
  const queue=summarize(workspace.rows),issues=[];
  for(const row_id of queue.incomplete_identity_ids)issues.push(['incomplete_identity',[row_id],'manufacturer/manufacturer_item_number_original',null,'Identidade incompleta na entrada']);
  for(const group of queue.groups_to_review){for(const field of group.conflicting_fields)issues.push(['input_conflict',group.row_ids,field,workspace.rows.filter(r=>group.row_ids.includes(r.row_id)).map(r=>({row_id:r.row_id,value:r[field],source_url:r.source_url??null})),'Valores divergentes; nenhuma correção ou fusão automática']);for(const field of group.unknown_fields)issues.push(['missing_field',group.row_ids,field,null,'Campo ausente na entrada']);}
  for(const finding of Array.isArray(original.findings)?original.findings:[])issues.push(['historical_documentary_finding',finding?.rows??[],finding?.id??'',finding,'Achado histórico declarado; não revalidado nesta exportação']);
  const issueHeaders=['type','row_ids_json','field_or_finding_id','observations_json','limitation'],neutralizations=[];
  const csv=csvText(headers,rows,false,[],''),spreadsheetCsv=csvText(headers,rows,true,neutralizations,'catalog-final-spreadsheet.csv');
  const conflictsCsv=csvText(issueHeaders,issues,true,neutralizations,'catalog-conflicts-spreadsheet.csv');
  const provenance={format:'avs.catalog.csv-delivery.v1',source_workspace_format:workspace.format,batch_sha256:workspace.batch_sha256,document_sha256:documentHash,hash_scope:'canonical_complete_document_not_original_file_bytes',original_document:original,origin:workspace.origin,decisions:workspace.decisions,metadata_columns:metadataColumns,row_count:workspace.rows.length,csv_columns:headers,neutralizations,sources_authenticated:false,merge_approved:false,substitution_approved:false,notice:'Preserved documentary declarations, not a fresh source consultation. Raw CSV retains original values; the separate spreadsheet CSV prefixes formula-like cells without changing originals. JSON preserves types/null/missing fields; import identifiers as text. No compatibility, customer acceptance or commercial result is established.'};
  const provenanceJson=JSON.stringify(provenance,null,2)+'\n';
  for(const output of [csv,spreadsheetCsv,conflictsCsv,provenanceJson])if(encoder.encode(output).length>MAX_BYTES)throw Error('Entrega excede 4 MB por arquivo.');
  return {csv,spreadsheetCsv,conflictsCsv,provenanceJson,rowCount:workspace.rows.length,neutralizationCount:neutralizations.length};
 }
 const escape=value=>String(value??'Não documentado').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function reportHTML(workspace,summarize=core.summarizeCatalog){const summary=summarize(workspace.rows),available=targets(workspace.rows,summarize);let body='<h1>Revisão documental de catálogo</h1><p>Decisões declaradas pelo operador. Fontes não autenticadas. Sem homologação, substituição ou mesclagem automática.</p><p>Origem declarada: '+escape(workspace.origin)+'</p><p>SHA-256 dos registros JSON canônicos: <code>'+escape(workspace.batch_sha256)+'</code>. O hash vincula o lote; não comprova origem nem preserva bytes do CSV original.</p><h2>Fila e lacunas</h2><p>'+summary.record_count+' registros; '+summary.incomplete_identity_ids.length+' identidades incompletas. IDs: '+escape(summary.incomplete_identity_ids.join(', ')||'nenhum observado')+'</p>';
 for(const g of summary.groups_to_review)body+='<p>'+escape(g.manufacturer)+' / '+escape(g.code)+' — '+escape(g.row_ids.join(', '))+'; conflitos: '+escape(g.conflicting_fields.join(', ')||'nenhum observado')+'; lacunas: '+escape(g.unknown_fields.join(', ')||'nenhuma observada')+'</p>';
 body+='<h2>Decisões declaradas</h2>';for(const t of available){const d=workspace.decisions.find(x=>x.target_key===t.key);body+='<section><h3>'+escape(t.label)+'</h3><p>'+escape(t.row_ids.join(', '))+' — '+escape(d?statuses[d.status]:'Sem revisão registrada')+'</p>';if(d)body+='<p>Justificativa: '+escape(d.justification)+'</p><p>Referência declarada: '+escape(d.declared_reference)+'</p>';body+='</section>';}
  if(workspace.format==='avs.catalog.review.v2')body+='<h2>Envelope documental preservado</h2><p>SHA-256 do documento JSON canônico completo: <code>'+escape(workspace.document_sha256)+'</code>. Inclui fontes, achados, ressalvas e metadados declarados; não autentica fontes nem conserva bytes do arquivo bruto.</p><pre>'+escape(JSON.stringify(workspace.original_document,null,2))+'</pre>';
  body+='<h2>Originais estruturados preservados</h2><p>As decisões não alteram os registros. Colunas extras são conservadas, sem avaliação automática.</p><pre>'+escape(JSON.stringify(workspace.rows,null,2))+'</pre><h2>Limites</h2><p>Sem verificação de quem revisou, autenticidade, completude do catálogo, disponibilidade, compatibilidade física ou efeito comercial. Arquivo local sem scripts ou recursos externos. Dados e referências podem ser confidenciais; compartilhe somente se autorizado.</p>';
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Revisão documental — declarada</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:0 20px;color:#152b26}section{border-top:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f4;padding:20px}code{overflow-wrap:anywhere}</style></head><body>'+body+'</body></html>';
 }
 const api={statuses,canonical,hash,strictJSON,targets,createWorkspace,saveDecision,removeDecision,exportPackage,importPackage,exportCsvDelivery,reportHTML,escape,MAX_BYTES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CatalogReview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
