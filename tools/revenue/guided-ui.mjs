import {buildGuidedBundle,formFromBundle,parseEventCsv,EVENT_COLUMNS,EVENT_CSV_TEMPLATE} from './guided.mjs';

const scalarFields=['data_class','customer_id','currency','period_start','period_end','invoice_cutoff','events_completeness','invoice_currency','invoice_period_start','invoice_period_end','invoice_completeness'];
const meterFields=[['meter_id','ID do medidor','api_calls'],['unit','Unidade','call'],['unit_price','Preço por unidade','0.03']];
const lineFields=[['line_id','ID da linha','line_api'],['meter_id','Medidor','api_calls'],['unit','Unidade','call'],['quantity','Quantidade faturada','1200'],['amount','Valor faturado','36.00']];
const element=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
export function setupGuided({invalidate,applyBundle,download}){
 const $=id=>document.getElementById(id);let active=true,lastPrepared=null,readRevision=0;
 const message=(text,error=false)=>{const panel=$('guided-message');panel.textContent=text;panel.hidden=false;panel.classList.toggle('is-error',error);};
 const dirty=event=>{
  const target=event?.target,id=target?.id??'';
  // A declaration belongs to the current base: changing its facts requires reaffirmation.
  if(!['guided-events_completeness','guided-invoice_completeness'].includes(id)){
   if(id==='guided-events_csv'||id==='file-events-csv')$('guided-events_completeness').value='unknown';
   else if(id.startsWith('guided-invoice_')||target?.closest('#guided-lines'))$('guided-invoice_completeness').value='unknown';
   else{$('guided-events_completeness').value='unknown';$('guided-invoice_completeness').value='unknown';}
  }
  lastPrepared=null;readRevision++;invalidate();for(const button of document.querySelectorAll('[data-download-input]'))button.disabled=true;$('guided-message').hidden=true;$('event-preview').replaceChildren();
 };
 function setMode(mode){active=mode==='guided';$('guided-inputs').hidden=!active;$('raw-inputs').hidden=active;$('mode-guided').setAttribute('aria-pressed',String(active));$('mode-raw').setAttribute('aria-pressed',String(!active));$('mode-guided').classList.toggle('selected',active);$('mode-raw').classList.toggle('selected',!active);invalidate();}
 const collection=type=>$(type==='meter'?'guided-meters':'guided-lines');
 function addRow(type,values={}){
  const host=collection(type);if(host.children.length>=100){message('Limite de 100 linhas neste recorte.',true);return;}
  const fields=type==='meter'?meterFields:lineFields,row=element('div',undefined,'guided-row '+(type==='meter'?'meter-row':'invoice-row'));
  for(const[key,label,hint]of fields){const wrapper=element('label',label),input=element('input');input.type='text';input.autocomplete='off';input.spellcheck=false;input.placeholder=hint;input.value=values[key]??'';input.dataset.field=key;input.maxLength=80;if(['unit_price','quantity','amount'].includes(key))input.inputMode='decimal';wrapper.append(input);row.append(wrapper);}
  const remove=element('button','Remover','remove-row');remove.type='button';remove.setAttribute('aria-label',type==='meter'?'Remover medidor':'Remover linha de fatura');remove.addEventListener('click',()=>{row.remove();dirty();});row.append(remove);host.append(row);
 }
 function values(type){return [...collection(type).children].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(input=>[input.dataset.field,input.value])));}
 function read(){const form=Object.fromEntries(scalarFields.map(name=>[name,$('guided-'+name).value]));form.meters=values('meter');form.invoice_lines=values('line');form.events_csv=$('guided-events_csv').value;return form;}
 function prepare(){
  try{
   const prepared=buildGuidedBundle(read());lastPrepared=prepared;applyBundle(prepared.bundle,prepared.preparation,prepared.inputs);for(const button of document.querySelectorAll('[data-download-input]'))button.disabled=false;
   const state=prepared.report.status==='blocked'?'A base continua bloqueada: confira as declarações, período e avisos no resultado.':'Base preparada. Confira os valores e avisos antes de qualquer ação.';
   message(`${prepared.preparation.event_rows} eventos e ${prepared.bundle.invoice.lines.length} linhas de fatura preparados como JSONs. ${state} Nenhuma declaração foi verificada externamente.`);return prepared;
  }catch(error){lastPrepared=null;invalidate();for(const button of document.querySelectorAll('[data-download-input]'))button.disabled=true;message(error.message,true);return null;}
 }
 function hydrate(bundle){
  const form=formFromBundle(bundle);for(const name of scalarFields)$('guided-'+name).value=form[name];$('guided-events_csv').value=form.events_csv;
  for(const type of ['meter','line'])collection(type).replaceChildren();for(const row of form.meters)addRow('meter',row);for(const row of form.invoice_lines)addRow('line',row);
  lastPrepared=null;for(const button of document.querySelectorAll('[data-download-input]'))button.disabled=true;$('guided-message').hidden=true;$('event-preview').replaceChildren();readRevision++;
 }
 function reset(){
  for(const name of scalarFields)$('guided-'+name).value=['events_completeness','invoice_completeness'].includes(name)?'unknown':'';
  $('guided-events_csv').value=EVENT_CSV_TEMPLATE;$('file-events-csv').value='';collection('meter').replaceChildren();collection('line').replaceChildren();addRow('meter');addRow('line');dirty();setMode('guided');
 }
 $('mode-guided').addEventListener('click',()=>setMode('guided'));$('mode-raw').addEventListener('click',()=>setMode('raw'));
 $('guided-inputs').addEventListener('input',dirty);$('guided-inputs').addEventListener('change',event=>{if(event.target.id!=='file-events-csv')dirty(event);});
 $('add-meter').addEventListener('click',()=>{addRow('meter');dirty();});$('add-line').addEventListener('click',()=>{addRow('line');dirty();});
 $('copy-invoice-period').addEventListener('click',()=>{for(const part of ['start','end'])$('guided-invoice_period_'+part).value=$('guided-period_'+part).value;dirty();message('Período copiado por sua ação. Confira se as datas constam exatamente assim na fatura. A moeda é informada separadamente.');});
 $('download-event-template').addEventListener('click',()=>download('events-normalized-template.csv',EVENT_CSV_TEMPLATE,'text/csv;charset=utf-8'));
 $('preview-events').addEventListener('click',()=>{
  const host=$('event-preview');host.replaceChildren();
  try{const {events,bomRemoved}=parseEventCsv($('guided-events_csv').value);host.append(element('p',`${events.length} registros lidos sem conversão decimal${bomRemoved?' (BOM UTF-8 removido)':''}. Prévia dos primeiros 10; isso não comprova completude.`));
   if(events.length){const table=element('table'),thead=element('thead'),head=element('tr');for(const name of EVENT_COLUMNS)head.append(element('th',name));thead.append(head);table.append(thead);const body=element('tbody');for(const event of events.slice(0,10)){const row=element('tr');for(const name of EVENT_COLUMNS)row.append(element('td',event[name]??'—'));body.append(row);}table.append(body);host.append(table);}
  }catch(error){host.append(element('p',error.message,'preview-error'));}
 });
 $('file-events-csv').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;dirty(event);$('guided-data_class').value='';$('guided-events_csv').value='';const version=readRevision;
  if(file.size>2000000){message('Eventos: CSV excede 2 MB.',true);return;}
  try{const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(version!==readRevision)return;$('guided-events_csv').value=raw;message('CSV carregado em memória. Confira a prévia e declare a situação de completude; não foi inferida.');}
  catch{if(version===readRevision)message('Não foi possível ler este arquivo como UTF-8 válido.',true);}
 });
 $('prepare-inputs').addEventListener('click',prepare);
 for(const button of document.querySelectorAll('[data-download-input]'))button.addEventListener('click',()=>{if(lastPrepared){const name=button.dataset.downloadInput;download(name+'.json',lastPrepared.inputs[name],'application/json;charset=utf-8');}});
 reset();
 return {reset,hydrate,prepare,setMode,isActive:()=>active};
}
