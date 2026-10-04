'use strict';
// Regression for envelope loss and final documentary delivery; no customer data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('./review.js'),core=require('./catalog.js');
const sample=()=>JSON.parse(fs.readFileSync(__dirname+'/sample.json','utf8'));
const decision={target_key:'row:R01',status:'retain_separate',justification:'Ensaio interno: conservar identidade documental histórica.',declared_reference:'Fonte declarada S01; nenhuma nova consulta.'};

function readCsv(text){
 const result=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'){row.push(cell);result.push(row);row=[];cell='';i++;}else cell+=c;}
 assert.equal(quoted,false);assert.equal(cell,'');assert.equal(row.length,0);return result;
}

test('historical eight-row envelope survives v2 roundtrip with all 8 sources, 5 findings and 5 caveats',async()=>{
 const doc=sample(),before=structuredClone(doc);let w=await R.createWorkspace(doc,'Amostra pública histórica — não cliente');
 assert.equal(w.format,'avs.catalog.review.v2');assert.equal(w.original_document.sources.length,8);assert.equal(w.original_document.findings.length,5);assert.equal(w.original_document.global_gaps.length,5);
 w=R.saveDecision(w,decision);const restored=await R.importPackage(R.exportPackage(w));assert.deepEqual(restored.original_document,before);assert.deepEqual(restored.rows,before.rows);assert.equal(restored.document_sha256,await R.hash(before));assert.equal(restored.decisions.length,1);
 doc.sources[0].url='https://example.invalid/changed';assert.equal(w.original_document.sources[0].url,before.sources[0].url);
 const html=R.reportHTML(restored);assert.ok(html.includes('Envelope documental preservado'));assert.ok(html.includes(before.global_gaps[0]));
});

test('tampering with sources, findings, global limits or unclassified metadata invalidates full-document hash',async()=>{
 const w=await R.createWorkspace(sample(),'histórico');
 for(const change of [d=>d.sources[0].url='https://example.invalid',d=>d.findings.pop(),d=>d.global_gaps.push('new'),d=>d.observed_on='2099-01-01',d=>d.rows[0].packing_quantity=999]){
  const p=JSON.parse(R.exportPackage(w));change(p.original_document);await assert.rejects(R.importPackage(JSON.stringify(p)),/Hash/);
 }
 const p=JSON.parse(R.exportPackage(w));p.rows[0].packing_quantity=999;await assert.rejects(R.importPackage(JSON.stringify(p)),/Hash/);
});

test('v1 remains compatible and gains no claimed envelope provenance during CSV export',async()=>{
 const w=await R.createWorkspace({rows:[{row_id:'SYNTHETIC',manufacturer_item_number_original:'00001'}]},'synthetic');assert.equal(w.format,'avs.catalog.review.v1');
 assert.deepEqual(await R.importPackage(R.exportPackage(w)),w);const result=await R.exportCsvDelivery(w),provenance=JSON.parse(result.provenanceJson);assert.equal(provenance.source_workspace_format,'avs.catalog.review.v1');assert.deepEqual(provenance.original_document,{rows:w.rows});assert.equal(provenance.sources_authenticated,false);
});

test('approval/authentication claims cannot be smuggled through preserved metadata',async()=>{
 for(const key of ['sources_authenticated','merge_approved','substitution_approved','authenticity_verified','completeness_verified','authenticated','approved','verified']){
  const doc=sample();doc.sources[0][key]=true;await assert.rejects(R.createWorkspace(doc,'synthetic adversarial'),/aprovação|autenticação/);
 }
 const w=await R.createWorkspace(sample(),'histórico');w.original_document.sources_authenticated=true;assert.throws(()=>R.exportPackage(w),/aprovação|autenticação/);await assert.rejects(R.exportCsvDelivery(w));
});

test('final CSV includes every existing documentary field and references full provenance without changing originals',async()=>{
 const doc=sample(),before=structuredClone(doc);const w=await R.createWorkspace(doc,'histórico');const result=await R.exportCsvDelivery(w),[headers,...rows]=readCsv(result.csv),p=JSON.parse(result.provenanceJson);
 assert.equal(result.rowCount,8);assert.ok(result.rowCount<=20);assert.equal(rows.length,8);assert.deepEqual(w.original_document,before);assert.deepEqual(p.original_document,before);
 for(const [index,row]of doc.rows.entries())for(const [key,value]of Object.entries(row)){assert.ok(headers.includes(key),key);assert.equal(rows[index][headers.indexOf(key)],value==null?'':typeof value==='object'?JSON.stringify(value):String(value),key);}
 assert.ok(headers.includes('conductor_pcb_direction_deg'));assert.ok(headers.includes('locking_clip_documented'));assert.equal(rows[7][headers.indexOf('conductor_pcb_direction_deg')],'-45');
 assert.equal(rows[0][headers.indexOf(p.metadata_columns.row_reference)],'catalog-provenance.json#/original_document/rows/0');assert.equal(rows[0][headers.indexOf(p.metadata_columns.document_hash)],w.document_sha256);
 const issues=readCsv(result.conflictsCsv);assert.equal(issues.length,6);assert.ok(issues.slice(1).every(row=>row[0]==='historical_documentary_finding'));assert.equal(p.original_document.sources.length,8);
});

test('spreadsheet copy neutralizes formula-like cells and headers with explicit audit; raw CSV and JSON remain exact',async()=>{
 const values=['=1+1','+SUM(A1)','-5','@SUM(A1)','\t=1','\r=2','\n=3','  =4','"quoted",cell\nnext'];
 const doc={nature:'SYNTHETIC CSV safety fixture',rows:values.map((value,index)=>({row_id:'S'+index,manufacturer_item_number_original:'000'+index,designation_original:value,'=header':'unchanged'}))};
 const w=await R.createWorkspace(doc,'synthetic');const result=await R.exportCsvDelivery(w),raw=readCsv(result.csv),safe=readCsv(result.spreadsheetCsv),p=JSON.parse(result.provenanceJson),field=raw[0].indexOf('designation_original');
 assert.equal(safe[0][raw[0].indexOf('=header')],"'=header");
 values.forEach((value,index)=>{assert.equal(raw[index+1][field],value);assert.equal(safe[index+1][field],index<8?"'"+value:value);assert.equal(w.rows[index].designation_original,value);});
 assert.equal(p.neutralizations.filter(n=>n.file==='catalog-final-spreadsheet.csv').length,9);assert.deepEqual(p.original_document,doc);assert.equal(raw[1][raw[0].indexOf('manufacturer_item_number_original')],'0000');
});

test('extra JSON fields and reserved-looking input columns survive without metadata collisions',async()=>{
 const doc={notes:{arbitrary:'preserve'},rows:[{row_id:'S1',manufacturer:'Synthetic',manufacturer_item_number_original:'0001',csv_extra_fields:{quoted:'a,"b"\nc'},__avs_row_reference:'original column',metadata:{declaration:true}}]};
 const result=await R.exportCsvDelivery(await R.createWorkspace(doc,'synthetic')),p=JSON.parse(result.provenanceJson),[headers,row]=readCsv(result.csv);
 assert.notEqual(p.metadata_columns.row_reference,'__avs_row_reference');assert.equal(row[headers.indexOf('__avs_row_reference')],'original column');assert.equal(row[headers.indexOf('csv_extra_fields')],JSON.stringify(doc.rows[0].csv_extra_fields));assert.deepEqual(p.original_document,doc);
});

test('actual CSV conflicts preserve all duplicate records and stay distinct from historical findings',async()=>{
 const doc={nature:'SYNTHETIC',rows:[{row_id:'A',manufacturer:'Synthetic',manufacturer_item_number_original:'0001',positions:2},{row_id:'B',manufacturer:'Synthetic',manufacturer_item_number_original:'0001',positions:4},{row_id:'C'}]};
 const w=await R.createWorkspace(doc,'synthetic'),result=await R.exportCsvDelivery(w),issues=readCsv(result.conflictsCsv);
 assert.equal(readCsv(result.csv).length,4);assert.ok(issues.some(row=>row[0]==='input_conflict'&&row[2]==='positions'));assert.ok(issues.some(row=>row[0]==='incomplete_identity'));assert.deepEqual(w.rows,doc.rows);
});

test('v2 metadata size/depth and corrupted export are refused instead of silently losing envelope',async()=>{
 const large={rows:[{row_id:'S'}],metadata:'x'.repeat(1000000)};await assert.rejects(R.createWorkspace(large,'synthetic'),/1 MB/);
 const w=await R.createWorkspace(sample(),'historical');w.document_sha256='0'.repeat(64);await assert.rejects(R.exportCsvDelivery(w),/Hash/);
});

// Finite integration harness: actual bootstrap/import/export scripts, no browser claim.
test('catalog bootstrap and JSON import retain envelope through review buttons and restored lot export',async()=>{
 class Element{
  constructor(id=''){this.id=id;this.value='';this.children=[];this.listeners={};this.files=[];this.disabled=false;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  replaceChildren(){this.children=[];if(['left','right','review-target'].includes(this.id))this.value='';}
  append(...items){this.children.push(...items);if(['left','right','review-target'].includes(this.id)&&!this.value&&items[0]?.value)this.value=items[0].value;}
  set selectedIndex(i){this.value=this.children[i]?.value||'';}
  scrollIntoView(){} click(){} async fire(type){return this.listeners[type]?.();}
 }
 const elements=new Map(),events={},pending=[],downloads=[];
 const document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},createElement:()=>new Element(),createTextNode:text=>({textContent:text}),addEventListener:(type,fn)=>{(events[type]??=[]).push(fn);},dispatchEvent:event=>{for(const fn of events[event.type]||[]){const result=fn(event);if(result?.then)pending.push(result);}}};
 class CustomEvent{constructor(type,args){this.type=type;this.detail=args?.detail;}}
 class LocalURL extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:fixture';}static revokeObjectURL(){}}
 const context=vm.createContext({document,CatalogReview:R,catalogSample:sample(),CustomEvent,Event:CustomEvent,structuredClone,TextDecoder,TextEncoder,Blob,URL:LocalURL,setTimeout:()=>0});
 for(const file of ['review-ui.js','catalog.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
 const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0));};await flush();
 const el=document.getElementById;
 await el('review-package').fire('click');assert.deepEqual(JSON.parse(await downloads.at(-1).text()).original_document,sample());
 const deliveryButton=label=>el('review-list').children.flatMap(x=>x.children||[]).find(x=>x.textContent===label);
 await deliveryButton('Baixar CSV fiel — importar como texto').fire('click');assert.equal(readCsv(await downloads.at(-1).text()).length,9);
 const changed=sample();changed.sources[0].operator_note='SYNTHETIC metadata mutation for lifecycle regression only';
 el('file').files=[{name:'synthetic-envelope.json',size:JSON.stringify(changed).length,arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(changed)).buffer}];await el('file').fire('change');await flush();
 await deliveryButton('Baixar proveniência integral JSON').fire('click');assert.deepEqual(JSON.parse(await downloads.at(-1).text()).original_document,changed);
 await el('data-export').fire('click');assert.deepEqual(JSON.parse(await downloads.at(-1).text()),changed);
 const originalWorkspace=await R.createWorkspace(sample(),'Historical sample; no customer');
 el('review-file').files=[{size:100,arrayBuffer:async()=>new TextEncoder().encode(R.exportPackage(originalWorkspace)).buffer}];await el('review-file').fire('change');await flush();
 await el('data-export').fire('click');assert.deepEqual(JSON.parse(await downloads.at(-1).text()),sample());
 await deliveryButton('Baixar CSV final para planilha').fire('click');const safe=readCsv(await downloads.at(-1).text());assert.equal(safe[8][safe[0].indexOf('conductor_pcb_direction_deg')],"'-45");
});
