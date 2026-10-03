import {timestamp, reconcile} from './reconcile.mjs';

export const EVENT_COLUMNS = ['event_id','meter_id','unit','kind','quantity','occurred_at','received_at','reverses'];
export const EVENT_CSV_TEMPLATE = EVENT_COLUMNS.join(',')+'\n';
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const DECIMAL=/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const AMOUNT=/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const fail=message=>{throw new Error(message);};
const need=(ok,message)=>{if(!ok)fail(message);};
const identifier=(value,label)=>{need(typeof value==='string'&&ID.test(value),`${label}: informe um ID de 1 a 80 caracteres (letras, números, _ ou -), sem nomes/e-mails.`);return value;};
const decimal=(value,label,amount=false)=>{need(typeof value==='string'&&(amount?AMOUNT:DECIMAL).test(value),`${label}: use texto decimal com ponto, sem sinal/notação científica; ${amount?'exatamente 2 casas':'até 12 dígitos inteiros e 6 casas'}.`);return value;};
const utc=(value,label)=>{try{timestamp(value);}catch{fail(`${label}: informe uma data UTC real, com segundos, como 2026-09-01T00:00:00Z. Não há conversão automática de fuso.`);}return value;};

/** Strict comma CSV. No type coercion, dropped columns, inferred dates or inferred completeness. */
export function parseEventCsv(text){
 need(typeof text==='string','Eventos: texto CSV ausente.');
 need(new TextEncoder().encode(text).length<=2000000,'Eventos: CSV excede 2 MB.');
 const bomRemoved=text.startsWith('\uFEFF');if(bomRemoved)text=text.slice(1);
 need(text.length>0,'Eventos: cole o cabeçalho e os registros CSV ou use o template vazio.');
 const rows=[];let row=[],cell='',state='start',pos=0;
 const pushCell=()=>{need(cell.length<=4096,`Eventos: campo muito longo no registro ${rows.length+1}.`);row.push(cell);cell='';};
 const pushRow=()=>{pushCell();need(row.length===EVENT_COLUMNS.length,`Eventos: registro ${rows.length+1} tem ${row.length} colunas; exige 8. Nenhuma coluna será descartada.`);rows.push(row);row=[];need(rows.length<=10001,'Eventos: limite de 10 mil registros.');};
 while(pos<text.length){
  const ch=text[pos++];
  if(state==='quoted'){
   if(ch==='"'){if(text[pos]==='"'){cell+='"';pos++;}else state='closed';}else cell+=ch;
  }else if(ch===','){pushCell();state='start';}
  else if(ch==='\n'||ch==='\r'){
   if(ch==='\r'){need(text[pos]==='\n',`Eventos: quebra CR isolada no registro ${rows.length+1}; use LF ou CRLF.`);pos++;}
   pushRow();state='start';
  }else if(ch==='"'){
   need(state==='start',`Eventos: aspas fora do início do campo no registro ${rows.length+1}.`);state='quoted';
  }else{
   need(state!=='closed',`Eventos: caracteres depois de aspas fechadas no registro ${rows.length+1}.`);cell+=ch;state='unquoted';
  }
  need(cell.length<=4096,`Eventos: campo muito longo no registro ${rows.length+1}.`);
  need(row.length<EVENT_COLUMNS.length||pos===text.length,`Eventos: colunas extras no registro ${rows.length+1}.`);
 }
 need(state!=='quoted',`Eventos: aspas não fechadas no registro ${rows.length+1}.`);
 if(cell!==''||row.length||state!=='start')pushRow();
 need(rows.length>0,'Eventos: cabeçalho CSV ausente.');
 const headers=rows.shift();
 need(new Set(headers).size===8&&headers.every(name=>EVENT_COLUMNS.includes(name)),'Eventos: cabeçalho exige exatamente event_id,meter_id,unit,kind,quantity,occurred_at,received_at,reverses (ordem livre). Sem colunas extras ou repetidas.');
 const events=rows.map((values,index)=>{
  const event=Object.fromEntries(headers.map((name,col)=>[name,values[col]])),label=`Evento ${index+1}`;
  for(const key of ['event_id','meter_id','unit'])identifier(event[key],`${label} / ${key}`);
  need(['usage','refund'].includes(event.kind),`${label}: kind exige usage ou refund, sem inferência.`);
  decimal(event.quantity,`${label} / quantity`);
  need(/[1-9]/.test(event.quantity),`${label}: quantidade precisa ser positiva.`);
  utc(event.occurred_at,`${label} / occurred_at`);utc(event.received_at,`${label} / received_at`);
  need(timestamp(event.occurred_at)<=timestamp(event.received_at),`${label}: recebimento anterior à ocorrência.`);
  if(event.kind==='usage'){need(event.reverses==='',`${label}: uso não pode referenciar estorno; reverses deve ficar vazio.`);event.reverses=null;}
  else identifier(event.reverses,`${label} / reverses`);
  return event;
 });
 return {events,bomRemoved};
}

export function eventsToCsv(events){
 const quote=value=>{const text=value===null?'':String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
 return EVENT_CSV_TEMPLATE+events.map(event=>EVENT_COLUMNS.map(key=>quote(event[key])).join(',')).join('\n')+(events.length?'\n':'');
}

export function serializeInputs(bundle){
 return Object.fromEntries(Object.entries(bundle).map(([name,doc])=>{
  let text=JSON.stringify(doc,null,2)+'\n';
  if(new TextEncoder().encode(text).length>2000000)text=JSON.stringify(doc)+'\n';
  need(new TextEncoder().encode(text).length<=2000000,`${name}.json: a base normalizada excede 2 MB, mesmo sem espaços. Use um período menor com exports completos próprios; não descarte registros para forçar a comparação.`);
  return [name,text];
 }));
}

/** The form is a declaration of existing facts, never evidence that those facts are complete. */
export function buildGuidedBundle(form){
 need(['USER_SUPPLIED','SIMULATED'].includes(form.data_class),'Selecione a classe da base: fornecida ou fictícia.');
 const customer=identifier(form.customer_id,'Cliente comum aos três documentos');
 need(['BRL','USD','EUR'].includes(form.currency),'Selecione a moeda do contrato.');
 need(['BRL','USD','EUR'].includes(form.invoice_currency),'Selecione a moeda realmente informada na fatura.');
 const start=utc(form.period_start,'Início do contrato'),end=utc(form.period_end,'Fim do contrato'),cutoff=utc(form.invoice_cutoff,'Corte do export');
 need(timestamp(start)<timestamp(end)&&timestamp(end)<=timestamp(cutoff),'Contrato: exige início < fim ≤ corte.');
 need(timestamp(end)-timestamp(start)<=31*86400000,'Contrato: este recorte aceita até 31 dias.');
 const invoiceStart=utc(form.invoice_period_start,'Início da fatura'),invoiceEnd=utc(form.invoice_period_end,'Fim da fatura');
 need(Array.isArray(form.meters)&&form.meters.length>0&&form.meters.length<=100,'Contrato: informe de 1 a 100 medidores.');
 const meterIDs=new Set();
 const meters=form.meters.map((row,index)=>{
  const label=`Medidor ${index+1}`,meter_id=identifier(row.meter_id,`${label} / ID`);
  need(!meterIDs.has(meter_id),`${label}: ID de medidor repetido no contrato.`);meterIDs.add(meter_id);
  return {meter_id,unit:identifier(row.unit,`${label} / unidade`),unit_price:decimal(row.unit_price,`${label} / preço por unidade`)};
 });
 need(Array.isArray(form.invoice_lines)&&form.invoice_lines.length<=100,'Fatura: limite de 100 linhas.');
 const lineIDs=new Set();
 const lines=form.invoice_lines.map((row,index)=>{
  const label=`Linha de fatura ${index+1}`,line_id=identifier(row.line_id,`${label} / ID`);
  need(!lineIDs.has(line_id),`${label}: ID de linha repetido.`);lineIDs.add(line_id);
  return {line_id,meter_id:identifier(row.meter_id,`${label} / medidor`),unit:identifier(row.unit,`${label} / unidade`),quantity:decimal(row.quantity,`${label} / quantidade`),amount:decimal(row.amount,`${label} / valor`,true)};
 });
 for(const key of ['events_completeness','invoice_completeness'])need(['unknown','incomplete','complete'].includes(form[key]),'Escolha explicitamente a situação de completude dos dois exports.');
 const parsed=parseEventCsv(form.events_csv);
 const contract={schema_version:1,data_class:form.data_class,customer_id:customer,currency:form.currency,period_start:start,period_end:end,invoice_cutoff:cutoff,pricing:'linear',rounding:'meter_total_half_up',meters};
 const events={schema_version:1,data_class:form.data_class,customer_id:customer,complete:form.events_completeness==='complete',events:parsed.events};
 const invoice={schema_version:1,data_class:form.data_class,customer_id:customer,currency:form.invoice_currency,period_start:invoiceStart,period_end:invoiceEnd,complete:form.invoice_completeness==='complete',lines};
 const bundle={contract,events,invoice};
 return {bundle,inputs:serializeInputs(bundle),report:reconcile(contract,events,invoice),preparation:{adapter:'guided-form-v1',event_rows:parsed.events.length,utf8_bom_removed:parsed.bomRemoved,declarations:{events:form.events_completeness,invoice:form.invoice_completeness},completeness:'user_asserted_not_verified',notice:'Unknown/incomplete declarations export complete:false. No IDs, units, prices, dates, amounts or completeness inferred.'}};
}

export function formFromBundle(bundle){
 const {contract:c,events:e,invoice:i}=bundle;
 return {data_class:c.data_class,customer_id:c.customer_id,currency:c.currency,period_start:c.period_start,period_end:c.period_end,invoice_cutoff:c.invoice_cutoff,meters:c.meters,events_csv:eventsToCsv(e.events),events_completeness:e.complete===true?'complete':'incomplete',invoice_currency:i.currency,invoice_period_start:i.period_start,invoice_period_end:i.period_end,invoice_completeness:i.complete===true?'complete':'incomplete',invoice_lines:i.lines};
}
