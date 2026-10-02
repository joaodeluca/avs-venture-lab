'use strict';
const examples = {
 normal:{traffic:{status:200,json:{date:'2026-10-01',visits:1200}},revenue:{status:200,json:{date:'2026-10-01',revenue_brl:4800}}},
 timeout:{traffic:{status:200,json:{visits:1200}},revenue:{error:'timeout'}},
 invalid:{traffic:{status:200,json:[{visits:1200}]},revenue:{status:200,json:{revenue_brl:4800}}}
};
function isObject(x){return x!==null && typeof x==='object' && !Array.isArray(x);}
function finiteJson(x){if(typeof x==='number')return Number.isFinite(x);if(x!==null&&typeof x==='object')return Object.values(x).every(finiteJson);return true;}
function aggregate(input){
 const fail=(source,code,unknown=false)=>({status:unknown?'unknown':'failed',items:[],error:{source,code},network_calls:0});
 if(!isObject(input)||Object.keys(input).some(k=>!['traffic','revenue'].includes(k)))return fail('input','INVALID_INPUT');
 if(!finiteJson(input))return fail('input','NON_FINITE_JSON');
 const objects=[];
 for(const name of ['traffic','revenue']){
  if(!Object.prototype.hasOwnProperty.call(input,name))return fail(name,'MISSING_SOURCE');
  const x=input[name];
  if(!isObject(x))return fail(name,'INVALID_RESPONSE');
  if(x.error==='timeout')return fail(name,'TIMEOUT',true);
  if(Object.keys(x).sort().join(',')!=='json,status')return fail(name,'INVALID_RESPONSE');
  if(!Number.isInteger(x.status)||x.status<100||x.status>599)return fail(name,'INVALID_STATUS');
  if(x.status<200||x.status>=300)return fail(name,'HTTP_'+x.status);
  if(!isObject(x.json))return fail(name,'EXPECTED_OBJECT');
  objects.push({...JSON.parse(JSON.stringify(x.json)),report_type:'daily-kpi'});
 }
 return {status:'completed_offline',items:objects,network_calls:0};
}
if(typeof document!=='undefined'){
 const input=document.getElementById('input'),output=document.getElementById('output'),status=document.getElementById('status');
 function run(){let result;try{if(input.value.length>100000)throw new Error('INPUT_TOO_LARGE');result=aggregate(JSON.parse(input.value));}catch(e){result={status:'failed',items:[],error:{source:'input',code:e.message==='INPUT_TOO_LARGE'?'INPUT_TOO_LARGE':'INVALID_JSON'},network_calls:0};}
 output.textContent=JSON.stringify(result,null,2);status.textContent=result.status==='completed_offline'?'✓ Saída local concluída':result.status==='unknown'?'? Resultado desconhecido: fonte indisponível':'× Entrada recusada: nenhuma saída parcial';}
 document.querySelectorAll('[data-case]').forEach(button=>button.addEventListener('click',()=>{input.value=JSON.stringify(examples[button.dataset.case],null,2);run();}));
 document.getElementById('run').addEventListener('click',run);input.value=JSON.stringify(examples.normal,null,2);run();
}
if(typeof module!=='undefined')module.exports={aggregate,examples};
