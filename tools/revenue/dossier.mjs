import {parseStrict,reconcile} from './reconcile.mjs';
const LIMIT=2_000_000,utf8=s=>new TextEncoder().encode(s).byteLength;
const fail=message=>{throw new Error(message);};
const exact=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==keys.slice().sort().join('|'))fail(label+': campos incompatíveis.');};
export function eventTrail(contract,events,report){
 if(report.errors.some(e=>e.code==='invalid_schema'))return{version:1,status:'schema_blocked',rows:[],notice:'Esquema recusado. Nenhum evento foi classificado como contribuição válida.'};
 const seen=new Map(),issues=new Map();
 for(const issue of [...report.errors,...report.warnings]){if(!issue.ref)continue;const list=issues.get(issue.ref)||[];list.push(issue.code);issues.set(issue.ref,list);}
 const blocked=report.status==='blocked';
 const rows=events.events.map((event,index)=>{
  const previous=seen.get(event.event_id);let state;
  if(previous){state=Object.keys(event).every(k=>event[k]===previous[k])?'duplicate_excluded':'conflicting_id';}
  else{seen.set(event.event_id,event);const flags=issues.get(event.event_id)||[];
   state=flags.includes('conflicting_event_id')?'conflicting_id':flags.includes('unknown_meter')?'unknown_meter':flags.includes('unit_mismatch')?'unit_mismatch':flags.includes('outside_period_excluded')?'outside_period':flags.includes('late_event_requires_review')?'after_cutoff':flags.includes('invalid_refund_reference')?'invalid_refund_reference':flags.includes('refund_exceeds_original')?'refund_exceeds_original':blocked?'comparison_blocked':event.kind==='refund'?'refund_applied':'usage_included';
  }
  const included=['usage_included','refund_applied'].includes(state);
  return{input_row:index+1,event_id:event.event_id,meter_id:event.meter_id,unit:event.unit,kind:event.kind,declared_quantity:event.quantity,occurred_at:event.occurred_at,received_at:event.received_at,reverses:event.reverses,evaluation:state,included_in_final_comparison:included,signed_quantity:included?(event.kind==='refund'?'-':'')+event.quantity:null};
 });
 return{version:1,status:blocked?'comparison_blocked':'classified',period_start:contract.period_start,period_end_exclusive:contract.period_end,invoice_cutoff:contract.invoice_cutoff,rows,notice:'A trilha explica as linhas da base declarada; não calcula valores por evento. Arredondamento ocorre por total de medidor. Base bloqueada não tem contribuições monetárias ou quantidades finais emitidas.'};
}
export const trailLabels={usage_included:'Uso incluído',refund_applied:'Estorno aplicado ao uso referenciado',duplicate_excluded:'Repetição idêntica excluída',conflicting_id:'ID conflitante: comparação bloqueada',unknown_meter:'Medidor desconhecido',unit_mismatch:'Unidade divergente',outside_period:'Fora do período: excluído',after_cutoff:'Recebido depois do corte',invalid_refund_reference:'Referência de estorno inválida',refund_exceeds_original:'Estorno excede uso original',comparison_blocked:'Base bloqueada: contribuição não concluída'};
export function createDossier(raw,report){
 exact(raw,['contract','events','invoice'],'Entradas');
 if(report?.schema_version!==1||report?.report_version!==2)fail('Relatório v2 é obrigatório no dossiê.');
 const inputs={};for(const name of ['contract','events','invoice']){parseStrict(raw[name]);inputs[name]=raw[name];}
 const dossier={format:'avs-usage-dossier',version:1,report_version:2,authenticity_verified:false,inputs,archived_report:structuredClone(report)};
 const encoded=JSON.stringify(dossier,null,2)+'\n';if(utf8(encoded)>LIMIT)fail('Dossiê excede 2 MB. Preserve os três arquivos individuais e o relatório separadamente.');return encoded;
}
export function parseDossier(raw){
 const value=parseStrict(raw);exact(value,['format','version','report_version','authenticity_verified','inputs','archived_report'],'Dossiê');
 if(value.format!=='avs-usage-dossier'||value.version!==1||value.report_version!==2||value.authenticity_verified!==false)fail('Formato/versão do dossiê incompatível.');
 exact(value.inputs,['contract','events','invoice'],'Entradas');const docs={};
 for(const name of ['contract','events','invoice'])docs[name]=parseStrict(value.inputs[name]);
 if(!value.archived_report||typeof value.archived_report!=='object'||Array.isArray(value.archived_report)||value.archived_report.schema_version!==1||value.archived_report.report_version!==2)fail('Relatório arquivado inválido.');
 // Archived claims are never applied. Running the normal motor anew preserves
 // complete:false and all original declarations; no acceptance or trust upgrade.
 const recomputed=reconcile(docs.contract,docs.events,docs.invoice);
 return{raw:structuredClone(value.inputs),docs,recomputed,archived_status:typeof value.archived_report.status==='string'?value.archived_report.status:'não reconhecido',notice:'Relatório arquivado não é prova. As três entradas serão conferidas novamente; complete permanece uma declaração original.'};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const columns=['meter_id','unit','contractual_quantity','invoice_quantity','expected_amount','invoice_amount','signed_delta'];
export function reportHtml(report){
 const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const t=report.event_trail;
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Conferência linear local</title><style>body{font:15px/1.6 system-ui;max-width:1200px;margin:32px auto;padding:20px;color:#152b37}.table{overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #d6dfe3;text-align:left}td,pre,code{overflow-wrap:anywhere}pre{white-space:pre-wrap}details{margin:20px 0;padding:16px;border:1px solid #d6dfe3}.notice{padding:16px;background:#fff3dd}</style></head><body><h1>Conferência linear local · relatório v2</h1><p>Classe: ${esc(report.data_class??'não validada')} · Estado: ${esc(report.status)} · Moeda: ${esc(report.currency??'não validada')}</p><p class="notice">Base normalizada declarada pelo usuário. Diferenças exigem revisão; não são recuperação de receita ou autorização de cobrança. Completude, autenticidade e aceite externo não verificados.</p>${report.status==='blocked'?'<h2>Base bloqueada</h2><p>Nenhuma comparação monetária emitida.</p>':table(columns,report.comparison.map(row=>columns.map(k=>row[k])))}<h2>Trilha de eventos</h2><p>${esc(t?.notice??'Trilha não disponível')}</p>${t?.period_start?`<p>UTC: ${esc(t.period_start)} → ${esc(t.period_end_exclusive)} (fim excluído). Corte: ${esc(t.invoice_cutoff)}</p>`:''}${t?.rows?.length?[...new Set(t.rows.map(r=>r.meter_id))].map(id=>`<details><summary>Medidor ${esc(id)} · ${t.rows.filter(r=>r.meter_id===id).length} linhas</summary>${table(['Linha','Evento','Tipo / referência','Quantidade declarada','Situação','Contribuição final','Ocorrência / recebimento'],t.rows.filter(r=>r.meter_id===id).map(r=>[r.input_row,r.event_id,r.kind+(r.reverses?' → '+r.reverses:''),r.declared_quantity+' '+r.unit,trailLabels[r.evaluation]??r.evaluation,r.signed_quantity??'Não emitida',r.occurred_at+' / '+r.received_at]))}</details>`).join(''):'<p>Nenhum evento classificado.</p>'}<details><summary>Relatório completo e hashes dos textos das entradas</summary><pre>${esc(JSON.stringify(report,null,2))}</pre></details><footer>O dossiê JSON preserva as três entradas e permite retomada manual. Hash identifica texto e não comprova origem. Não compartilhe dados pessoais, identificadores de clientes ou segredos.</footer></body></html>`;
}
