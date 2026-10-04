'use strict';
const fields=[['manufacturer','Fabricante'],['manufacturer_item_number_original','Código original'],['positions','Posições'],['pitch_mm','Passo (mm)'],['housing_color_pt','Cor'],['connection_method_pt','Conexão'],['locking_mechanism_pt','Travamento'],['mounting_method_pt','Montagem'],['packing_quantity','Quantidade por embalagem']];
const csvFields=['row_id',...fields.map(x=>x[0]),'designation_original','source_url','source_locator','consulted_on'];
const missing=value=>value==null||typeof value==='string'&&!value.trim();
function validateRows(doc){
 if(!doc||!Array.isArray(doc.rows)||!doc.rows.length||doc.rows.length>1000)throw Error('Esperado rows com 1 a 1.000 registros.');
 const ids=new Set();
 return doc.rows.map((r,index)=>{
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Registro inválido.');
  if(typeof r.row_id!=='string'||!r.row_id.trim()||r.row_id.length>200)throw Error(`Registro ${index+1}: row_id precisa ser texto não vazio.`);
  if(ids.has(r.row_id))throw Error('row_id repetido: '+r.row_id);ids.add(r.row_id);
  for(const [f] of fields){if(r[f]!=null&&!['string','number'].includes(typeof r[f]))throw Error('Campo estruturado inválido: '+f);if(typeof r[f]==='number'&&!Number.isFinite(r[f]))throw Error('Número inválido.');if(typeof r[f]==='string'&&r[f].length>1000)throw Error('Texto demasiado longo: '+f);}
  for(const f of ['manufacturer','manufacturer_item_number_original'])if(!missing(r[f])&&(typeof r[f]!=='string'||r[f].length>200))throw Error('Identidade e código precisam ser texto até 200 caracteres; ausências permanecem desconhecidas.');
  for(const f of ['positions','packing_quantity'])if(!missing(r[f])&&(!Number.isSafeInteger(r[f])||r[f]<=0))throw Error('Posições e embalagem precisam ser inteiros positivos.');
  if(!missing(r.pitch_mm)&&(typeof r.pitch_mm!=='number'||r.pitch_mm<=0))throw Error('Passo deve ser um número positivo em mm.');
  for(const f of ['designation_original','source_url','source_locator','consulted_on'])if(r[f]!=null&&(typeof r[f]!=='string'||r[f].length>1000))throw Error('Metadado documental inválido: '+f);
  return structuredClone(r);
 });
}
// Strict finite CSV parser; no spreadsheet execution or inferred number/code conversion.
function parseCSV(text,delimiter=','){
 if(![',',';'].includes(delimiter))throw Error('Separador CSV precisa ser vírgula ou ponto e vírgula.');
 if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>1000000)throw Error('Arquivo excede 1MB.');
 text=text.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false,started=false;
 function pushCell(){if(cell.length>1000)throw Error('Célula excede 1.000 caracteres.');row.push(cell);if(row.length>50)throw Error('CSV limitado a 50 colunas.');cell='';closed=false;started=false;}
 function pushRow(){pushCell();if(row.some(v=>v!==''))rows.push(row);if(rows.length>1001)throw Error('CSV limitado a 1.000 registros e cabeçalho.');row=[];}
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===delimiter){pushCell();continue;}if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();continue;}
  if(closed)throw Error('Caractere após fechamento de aspas; use o separador imediatamente.');
  if(c==='"'){if(started)throw Error('Aspas fora do início da célula.');quoted=true;started=true;}else{cell+=c;started=true;}
 }
 if(quoted)throw Error('CSV contém aspas não fechadas.');if(cell||row.length||started||closed)pushRow();
 if(rows.length<2)throw Error('CSV precisa de cabeçalho e pelo menos um registro.');
 const headers=rows.shift();if(headers.some(h=>!h.trim())||new Set(headers).size!==headers.length)throw Error('Cabeçalhos vazios ou repetidos.');
 if(!headers.includes('row_id'))throw Error('Falta a coluna obrigatória row_id; baixe o modelo.');
 const extra=headers.filter(h=>!csvFields.includes(h));
 const records=rows.map((values,n)=>{
  if(values.length!==headers.length)throw Error(`Linha de dados ${n+1}: número de células diferente do cabeçalho.`);
  const r=Object.create(null),additional=Object.create(null);
  headers.forEach((h,i)=>{if(csvFields.includes(h))r[h]=values[i]===''?null:values[i];else additional[h]=values[i];});
  if(extra.length)r.csv_extra_fields=additional;
  for(const f of ['positions','pitch_mm','packing_quantity'])if(!missing(r[f])){if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(r[f]))throw Error(`Linha de dados ${n+1}: ${f} precisa usar número positivo com ponto decimal; não convertemos texto silenciosamente.`);r[f]=Number(r[f]);}
  return r;
 });
 return {rows:validateRows({rows:records}),extra_columns:extra};
}
function compareRows(a,b){
 const rows=fields.map(([field,label])=>{const av=a[field],bv=b[field];return{field,label,left:missing(av)?null:av,right:missing(bv)?null:bv,state:missing(av)||missing(bv)?'desconhecido':av===bv?'coincide_na_entrada':'diverge_na_entrada'};});
 const identityMissing=['manufacturer','manufacturer_item_number_original'].some(f=>missing(a[f])||missing(b[f]));
 const same=!identityMissing&&a.manufacturer===b.manufacturer&&a.manufacturer_item_number_original===b.manufacturer_item_number_original;
 const differences=rows.filter(x=>x.state==='diverge_na_entrada').length,unknowns=rows.filter(x=>x.state==='desconhecido').length;
 return {status:identityMissing?'identidade_incompleta':!same?'identificadores_distintos':differences?'conflito_de_campos':unknowns?'informacao_incompleta':'campos_coincidem_na_entrada',left_id:a.row_id,right_id:b.row_id,source_references:[a.source_url??null,b.source_url??null],sources_authenticated:false,substitution_approved:false,merge_approved:false,rows};
}
function summarizeCatalog(records){
 const groups=new Map(),incomplete=[];
 for(const r of records){if(missing(r.manufacturer)||missing(r.manufacturer_item_number_original)){incomplete.push(r.row_id);continue;}const key=JSON.stringify([r.manufacturer,r.manufacturer_item_number_original]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const reviewGroups=[];
 for(const members of groups.values())if(members.length>1){const conflicts=fields.filter(([f])=>new Set(members.filter(r=>!missing(r[f])).map(r=>r[f])).size>1).map(([f])=>f);const unknowns=fields.filter(([f])=>members.some(r=>missing(r[f]))).map(([f])=>f);let pair=[members[0],members[1]];if(conflicts.length){const f=conflicts[0],known=members.filter(r=>!missing(r[f]));pair=[known[0],known.find(r=>r[f]!==known[0][f])];}reviewGroups.push({comparison_pair:pair.map(r=>r.row_id),row_ids:members.map(r=>r.row_id),manufacturer:members[0].manufacturer,code:members[0].manufacturer_item_number_original,conflicting_fields:conflicts,unknown_fields:unknowns,decision:conflicts.length?'conflito_de_campos':unknowns.length?'informacao_incompleta':'campos_coincidem_na_entrada'});}
 return{record_count:records.length,incomplete_identity_ids:incomplete,groups_to_review:reviewGroups,merge_approved:false,sources_authenticated:false};
}
const labels={identidade_incompleta:'Identidade ausente — não inferir que os códigos são iguais',identificadores_distintos:'Identificadores distintos — conservar registros separados',conflito_de_campos:'Mesmo identificador, campos em conflito',informacao_incompleta:'Faltam informações — não concluir alinhamento',campos_coincidem_na_entrada:'Campos coincidem nesta entrada — fontes não verificadas'};
if(typeof document!=='undefined'){
 let records=validateRows(catalogSample),sourceDocument=structuredClone(catalogSample),result,loadRevision=0;
 const el=id=>document.getElementById(id);
 const download=(content,name)=>{const url=URL.createObjectURL(new Blob([content],{type:name.endsWith('.csv')?'text/csv;charset=utf-8':'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function selections(){const filter=el('filter').value.toLocaleLowerCase('pt-BR');const shown=records.filter(r=>[r.row_id,r.manufacturer,r.manufacturer_item_number_original,r.designation_original].some(x=>String(x??'').toLocaleLowerCase('pt-BR').includes(filter)));for(const id of ['left','right']){const previous=el(id).value;el(id).replaceChildren();for(const r of shown){const o=document.createElement('option');o.value=r.row_id;o.textContent=r.row_id+' · '+(r.manufacturer_item_number_original||'Código ausente')+' · '+(r.designation_original||r.manufacturer||'Fabricante ausente');el(id).append(o);}if(shown.some(r=>r.row_id===previous))el(id).value=previous;}if(shown.length>1&&el('left').value===el('right').value)el('right').selectedIndex=1;el('compare').disabled=!shown.length;el('export').disabled=!shown.length;if(shown.length)run();else{result=null;el('status').textContent='Nenhum registro corresponde ao filtro.';el('differences').replaceChildren();el('sources').replaceChildren();}}
 function announce(origin,workspace){document.dispatchEvent(new CustomEvent('catalog:dataset',{detail:{rows:structuredClone(records),document:structuredClone(sourceDocument),origin,workspace}}));}
 function batch(){const summary=summarizeCatalog(records);el('batch-status').textContent=`${summary.record_count} registros · ${summary.incomplete_identity_ids.length} com identidade incompleta · ${summary.groups_to_review.length} grupos com identidade declarada repetida.`;el('groups').replaceChildren();if(summary.incomplete_identity_ids.length){const p=document.createElement('p');p.textContent='Rever fabricante/código ausente: '+summary.incomplete_identity_ids.join(', ');el('groups').append(p);}for(const group of summary.groups_to_review){const p=document.createElement('p');p.textContent=`${group.manufacturer} / ${group.code} — ${group.row_ids.join(', ')} — ${labels[group.decision]}. Conflitos: ${group.conflicting_fields.join(', ')||'nenhum observado'}. Ausências: ${group.unknown_fields.join(', ')||'nenhuma observada'}. `;const b=document.createElement('button');b.className='light';b.textContent='Abrir dois registros';b.addEventListener('click',()=>{el('filter').value='';selections();el('left').value=group.comparison_pair[0];el('right').value=group.comparison_pair[1];run();});const reviewButton=document.createElement('button');reviewButton.className='light';reviewButton.textContent='Revisar este grupo';reviewButton.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('catalog:select-target',{detail:{key:'group:'+JSON.stringify(group.row_ids.slice().sort())}})));p.append(b,document.createTextNode(' '),reviewButton);el('groups').append(p);}}
 function run(){const a=records.find(r=>r.row_id===el('left').value),b=records.find(r=>r.row_id===el('right').value);if(!a||!b)return;result=compareRows(a,b);el('status').textContent=labels[result.status];el('differences').replaceChildren();for(const row of result.rows){const tr=document.createElement('tr');for(const v of [row.label,row.left??'Não documentado',row.right??'Não documentado',row.state.replaceAll('_',' ')]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}el('differences').append(tr);}el('sources').replaceChildren();for(const [i,url] of result.source_references.entries()){try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)continue;const a=document.createElement('a');a.href=parsed.href;a.textContent='Referência '+(i+1)+' ↗';a.target='_blank';a.rel='noopener noreferrer';el('sources').append(a,document.createTextNode(' · '));}catch{}}}
 el('filter').addEventListener('input',selections);el('compare').addEventListener('click',run);for(const id of ['left','right'])el(id).addEventListener('change',run);
 el('export').addEventListener('click',()=>{if(result)download(JSON.stringify(result,null,2)+'\n','catalog-diagnostic.json');});
 el('batch-export').addEventListener('click',()=>download(JSON.stringify(summarizeCatalog(records),null,2)+'\n','catalog-review-queue.json'));
 el('data-export').addEventListener('click',()=>download(JSON.stringify(sourceDocument,null,2)+'\n','catalog-local-records.json'));
 el('template').addEventListener('click',()=>download(csvFields.join(',')+'\r\nR01,Fabricante fictício,000123,4,5.08,verde,parafuso,,,100,Exemplo sintético,,,\r\n','catalog-template-synthetic.csv'));
 el('demo').addEventListener('click',()=>{loadRevision++;records=validateRows(catalogSample);sourceDocument=structuredClone(catalogSample);el('filter').value='';selections();batch();el('import-status').textContent='Amostra pública restaurada; revisões anteriores invalidadas. Nenhuma consulta de fonte foi realizada.';announce('Amostra pública inicial — não é lote de cliente');});
 el('file').addEventListener('change',async()=>{const token=++loadRevision;document.dispatchEvent(new Event('catalog:loading'));try{const file=el('file').files[0];if(!file){document.dispatchEvent(new Event('catalog:failed'));return;}if(file.size>1000000)throw Error('Arquivo excede 1MB.');const separator=el('delimiter').value;const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());let candidate,documentInput,extras=[];if(file.name.toLowerCase().endsWith('.csv')){const parsed=parseCSV(text,separator);candidate=parsed.rows;extras=parsed.extra_columns;documentInput={rows:candidate};}else{documentInput=CatalogReview.strictJSON(text);candidate=validateRows(documentInput);}const prepared=await CatalogReview.createWorkspace(documentInput,'Arquivo declarado: '+file.name,validateRows);if(token!==loadRevision)return;records=candidate;sourceDocument=structuredClone(documentInput);el('filter').value='';selections();batch();announce('Arquivo declarado: '+file.name,prepared);el('import-status').textContent=records.length+' registros carregados localmente; células vazias são desconhecidas. '+(extras.length?'Colunas extras conservadas em csv_extra_fields e não comparadas: '+extras.join(', ')+'.':'')+' Fontes declaradas não autenticadas.';}catch(e){if(token===loadRevision){el('import-status').textContent='Importação recusada; dados anteriores preservados: '+e.message;document.dispatchEvent(new Event('catalog:failed'));}}finally{if(token===loadRevision)el('file').value='';}});
 document.addEventListener('catalog:cancel-load',()=>{loadRevision++;});
 document.addEventListener('catalog:restore',event=>{loadRevision++;records=validateRows({rows:event.detail.rows});sourceDocument=structuredClone(event.detail.document||{rows:records});el('filter').value='';selections();batch();el('import-status').textContent='Pacote de revisão restaurado; originais mantidos. Fontes não autenticadas.';});
 selections();batch();announce('Amostra pública inicial — não é lote de cliente');
}
if(typeof module!=='undefined')module.exports={validateRows,compareRows,parseCSV,summarizeCatalog,csvFields};
