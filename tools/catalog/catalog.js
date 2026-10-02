'use strict';
const fields=[['manufacturer','Fabricante'],['manufacturer_item_number_original','Código original'],['positions','Posições'],['pitch_mm','Passo (mm)'],['housing_color_pt','Cor'],['connection_method_pt','Conexão'],['locking_mechanism_pt','Travamento'],['mounting_method_pt','Montagem'],['packing_quantity','Quantidade por embalagem']];
function validateRows(doc){
 if(!doc||!Array.isArray(doc.rows)||!doc.rows.length||doc.rows.length>1000)throw Error('Esperado rows com 1 a 1.000 registros.');
 const ids=new Set();
 for(const r of doc.rows){
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Registro inválido.');
  for(const f of ['row_id','manufacturer','manufacturer_item_number_original'])if(typeof r[f]!=='string'||!r[f].trim()||r[f].length>200)throw Error('Identidade e código precisam ser texto não vazio.');
  if(ids.has(r.row_id))throw Error('row_id repetido.');ids.add(r.row_id);
  for(const [f] of fields){if(r[f]!=null&&!['string','number'].includes(typeof r[f]))throw Error('Campo estruturado inválido.');if(typeof r[f]==='number'&&!Number.isFinite(r[f]))throw Error('Número inválido.');if(typeof r[f]==='string'&&r[f].length>1000)throw Error('Texto demasiado longo.');}
  for(const f of ['positions','packing_quantity'])if(r[f]!=null&&(!Number.isSafeInteger(r[f])||r[f]<=0))throw Error('Posições e embalagem precisam ser inteiros positivos.');
  if(r.pitch_mm!=null&&(typeof r.pitch_mm!=='number'||r.pitch_mm<=0))throw Error('Passo deve ser um número positivo em mm.');
 }
 return doc.rows;
}
function compareRows(a,b){
 const rows=fields.map(([field,label])=>{const av=a[field],bv=b[field];return {field,label,left:av??null,right:bv??null,state:av==null||bv==null?'desconhecido':av===bv?'coincide_na_entrada':'diverge_na_entrada'};});
 const same=a.manufacturer===b.manufacturer&&a.manufacturer_item_number_original===b.manufacturer_item_number_original;
 const differences=rows.filter(x=>x.state==='diverge_na_entrada').length,unknowns=rows.filter(x=>x.state==='desconhecido').length;
 return {status:!same?'identificadores_distintos':differences?'conflito_de_campos':unknowns?'informacao_incompleta':'campos_coincidem_na_entrada',left_id:a.row_id,right_id:b.row_id,source_references:[a.source_url??null,b.source_url??null],sources_authenticated:false,substitution_approved:false,merge_approved:false,rows};
}
if(typeof document!=='undefined'){
 let records=validateRows(catalogSample),result;
 const el=id=>document.getElementById(id);
 function selections(){for(const id of ['left','right']){el(id).replaceChildren();for(const r of records){const o=document.createElement('option');o.value=r.row_id;o.textContent=r.manufacturer_item_number_original+' · '+(r.designation_original||r.row_id);el(id).append(o);}}if(records.length>1)el('right').selectedIndex=1;run();}
 function run(){const a=records.find(r=>r.row_id===el('left').value),b=records.find(r=>r.row_id===el('right').value);result=compareRows(a,b);el('status').textContent={identificadores_distintos:'Identificadores distintos — conservar registros separados',conflito_de_campos:'Mesmo identificador, campos em conflito',informacao_incompleta:'Faltam informações — não concluir alinhamento',campos_coincidem_na_entrada:'Campos coincidem nesta entrada — fontes não verificadas'}[result.status];el('differences').replaceChildren();for(const row of result.rows){const tr=document.createElement('tr');for(const v of [row.label,row.left??'Não documentado',row.right??'Não documentado',row.state.replaceAll('_',' ')]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}el('differences').append(tr);}el('sources').replaceChildren();for(const [i,url] of result.source_references.entries()){try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)continue;const a=document.createElement('a');a.href=parsed.href;a.textContent='Referência '+(i+1)+' ↗';a.target='_blank';a.rel='noopener noreferrer';el('sources').append(a,document.createTextNode(' · '));}catch{}}}
 el('compare').addEventListener('click',run);
 el('export').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='catalog-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 el('file').addEventListener('change',async()=>{try{const file=el('file').files[0];if(!file)return;if(file.size>1000000)throw Error('Arquivo excede 1MB.');records=validateRows(JSON.parse(await file.text()));selections();el('import-status').textContent=records.length+' registros carregados localmente; fontes declaradas não autenticadas.';}catch(e){el('import-status').textContent='Importação recusada: '+e.message;}});selections();
}
if(typeof module!=='undefined')module.exports={validateRows,compareRows};
