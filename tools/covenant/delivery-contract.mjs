/* Finite local criteria. No worker code, expressions, regex, network or receipt execution. */
export const MAX_ARTIFACT_BYTES = 1048576;
export const MAX_CONTRACT_BYTES = 65536;
export class ContractError extends Error { constructor(code) { super(code); this.code=code; } }
const fail = code => { throw new ContractError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value,max) => typeof value==='string' && value.length>0 && value.length<=max;
export const encode = value => new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
export function decodeUTF8(raw,max=MAX_ARTIFACT_BYTES) {
  if (!(raw instanceof Uint8Array)) fail('BYTES_REQUIRED');
  if (raw.length>max) fail('FILE_TOO_LARGE');
  try { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw); } catch { fail('INVALID_UTF8'); }
}
// Reject duplicate keys and excessive nesting. Objects have no prototype.
export function parseStrict(raw,max=MAX_ARTIFACT_BYTES) {
  const source=decodeUTF8(raw,max); let pos=0,count=0;
  const ws=()=>{while(/[\t\n\r ]/.test(source[pos]??'!'))pos++;};
  const string=()=>{const start=pos++;while(pos<source.length){if(source[pos]==='"'){pos++;try{return JSON.parse(source.slice(start,pos));}catch{fail('INVALID_JSON');}}if(source[pos]==='\\')pos++;pos++;}fail('INVALID_JSON');};
  function value(depth=0){
    if(depth>32)fail('JSON_DEPTH_LIMIT'); if(++count>50000)fail('JSON_VALUE_LIMIT'); ws();const ch=source[pos];
    if(ch==='"')return string();
    if(ch==='{'||ch==='['){const array=ch==='[';pos++;ws();const result=array?[]:Object.create(null),end=array?']':'}';if(source[pos]===end){pos++;return result;}
      while(pos<source.length){ws();let key;if(!array){if(source[pos]!=='"')fail('INVALID_JSON');key=string();if(Object.hasOwn(result,key))fail('DUPLICATE_JSON_KEY');ws();if(source[pos++]!==':')fail('INVALID_JSON');}
        const entry=value(depth+1);if(array)result.push(entry);else result[key]=entry;ws();const separator=source[pos++];if(separator===end)return result;if(separator!==',')fail('INVALID_JSON');}fail('INVALID_JSON');}
    for(const [word,result]of[['true',true],['false',false],['null',null]]){if(source.slice(pos,pos+word.length)===word){pos+=word.length;return result;}}
    const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(pos));if(!match)fail('INVALID_JSON');if(/[.eE]/.test(match[0]))fail('NON_INTEGER_JSON_NUMBER');const number=Number(match[0]);if(!Number.isSafeInteger(number))fail('UNSAFE_JSON_NUMBER');if(Object.is(number,-0))fail('NEGATIVE_ZERO_UNSUPPORTED');pos+=match[0].length;return number;
  }
  const result=value();ws();if(pos!==source.length)fail('INVALID_JSON');return result;
}
export async function sha256(raw){if(!globalThis.crypto?.subtle)fail('HASH_UNAVAILABLE');const result=await crypto.subtle.digest('SHA-256',raw);return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const keys=(value,expected)=>{if(!object(value)||Object.keys(value).some(key=>!expected.includes(key))||expected.some(key=>!Object.hasOwn(value,key)))fail('UNEXPECTED_CONTRACT_FIELDS');};
const scalar=value=>value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=4096||typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0);
export function pointerSegments(pointer){
  if(typeof pointer!=='string'||pointer.length>2048||!pointer.startsWith('/'))fail('INVALID_POINTER');
  const segments=pointer.slice(1).split('/');if(segments.length>20)fail('POINTER_DEPTH_LIMIT');
  return segments.map(segment=>{if(segment.length>256||/~(?![01])/.test(segment))fail('INVALID_POINTER');const key=segment.replace(/~1/g,'/').replace(/~0/g,'~');if(['__proto__','constructor','prototype'].includes(key))fail('RESERVED_POINTER_KEY');return key;});
}
export function validateContract(contract){
  keys(contract,['schema','task_id','title','criteria']);
  if(contract.schema!=='covenant-delivery-contract-v1')fail('UNSUPPORTED_CONTRACT');
  if(typeof contract.task_id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(contract.task_id)||!text(contract.title,256))fail('INVALID_CONTRACT');
  if(!Array.isArray(contract.criteria)||contract.criteria.length<1||contract.criteria.length>5)fail('CRITERION_LIMIT');const ids=new Set();
  for(const c of contract.criteria){
    if(!object(c)||typeof c.id!=='string'||! /^C[1-5]$/.test(c.id)||ids.has(c.id)||!text(c.label,256))fail('INVALID_CRITERION');ids.add(c.id);
    if(c.kind==='sha256'){keys(c,['id','kind','label','expected']);if(typeof c.expected!=='string'||! /^[a-f0-9]{64}$/.test(c.expected))fail('INVALID_EXPECTED_HASH');}
    else if(c.kind==='contains'){keys(c,['id','kind','label','expected']);if(!text(c.expected,8192))fail('INVALID_EXPECTED_TEXT');}
    else if(c.kind==='json_equal'){keys(c,['id','kind','label','pointer','expected']);pointerSegments(c.pointer);if(!scalar(c.expected))fail('EXPECTED_SCALAR_REQUIRED');}
    else if(c.kind==='json_exists'){keys(c,['id','kind','label','pointer']);pointerSegments(c.pointer);}
    else fail('UNSUPPORTED_CRITERION');
  }
  if(encode(contract).length>MAX_CONTRACT_BYTES)fail('FILE_TOO_LARGE');return contract;
}
export function createContract({taskId,title,criteria}){const candidate={schema:'covenant-delivery-contract-v1',task_id:taskId,title,criteria};validateContract(candidate);return validateContract(parseStrict(encode(candidate),MAX_CONTRACT_BYTES));}
export function importContract(raw){return validateContract(parseStrict(raw,MAX_CONTRACT_BYTES));}
function resolve(value,pointer){for(const key of pointerSegments(pointer)){if(value===null||typeof value!=='object')return {found:false};if(Array.isArray(value)&&! /^(?:0|[1-9]\d*)$/.test(key))return {found:false};if(!Object.hasOwn(value,key))return {found:false};value=value[key];}return{found:true,value};}
export const limits=[
  'Somente critérios finitos definidos pelo operador. Correspondência não prova utilidade, correção universal ou aceite comercial.',
  'O contrato deve ser fixado antes da entrega; esta aba não prova a cronologia nem autentica a referência, o operador ou o produtor.',
  'SHA-256 identifica os bytes selecionados, inclusive espaços/BOM. Não é assinatura. Contém trecho é busca literal, não julgamento semântico.',
  'JSON sem chaves duplicadas, no máximo 32 níveis e 50.000 valores. Apenas números inteiros literais na faixa segura; decimais e expoentes tornam critérios JSON desconhecidos. Não há arredondamento financeiro.',
  'Caminhos usam um subconjunto literal de JSON Pointer. Sem código, regex, rede, acesso a filesystem, inferência ou transformação.',
  'Identidade, autenticidade, criação recente, persistência, produção externa e causalidade continuam UNKNOWN. Nenhum resultado autoriza pagamento.'
];
export async function verifyDelivery(contractRaw,artifactRaw){
  const report={schema:'covenant-delivery-report-v1',outcome:'UNDETERMINED',observed_at:new Date().toISOString(),checks:[],files:{},verification_complete:false,payment_eligible:false,receipt_used_as_evidence:false,uncertainties:{contract_chronology:'UNKNOWN',reference_authenticity:'UNKNOWN',producer_identity:'UNKNOWN',file_freshness:'UNKNOWN',persistence:'UNKNOWN',external_production:'UNKNOWN',causal_effect:'UNKNOWN'},limits};
  // Snapshot both inputs before yielding. No criterion is learned from the artifact.
  let contractBytes,artifact;
  try{
    if(!(contractRaw instanceof Uint8Array))fail('CONTRACT_REQUIRED');if(contractRaw.length>MAX_CONTRACT_BYTES)fail('FILE_TOO_LARGE');
    if(artifactRaw!==null&&artifactRaw!==undefined&&!(artifactRaw instanceof Uint8Array))fail('BYTES_REQUIRED');if(artifactRaw?.length>MAX_ARTIFACT_BYTES)fail('FILE_TOO_LARGE');
    contractBytes=contractRaw.slice();artifact=artifactRaw instanceof Uint8Array?artifactRaw.slice():null;const contract=importContract(contractBytes);report.task_id=contract.task_id;report.title=contract.title;
    report.files.contract={bytes:contractBytes.length,sha256:await sha256(contractBytes)};
    if(!artifact){report.checks=contract.criteria.map(c=>({id:c.id,label:c.label,kind:c.kind,status:'UNKNOWN',detail:'ARTIFACT_REQUIRED'}));return report;}
    const content=decodeUTF8(artifact);report.files.artifact={bytes:artifact.length,sha256:await sha256(artifact)};
    let parsed,jsonError;if(contract.criteria.some(c=>c.kind.startsWith('json_'))){try{parsed=parseStrict(artifact);}catch(error){jsonError=error instanceof ContractError?error.code:'JSON_UNAVAILABLE';}}
    for(const criterion of contract.criteria){let status='UNKNOWN',detail='';
      if(criterion.kind==='sha256'){status=report.files.artifact.sha256===criterion.expected?'PASS':'FAIL';detail='RAW_BYTES_HASH';}
      else if(criterion.kind==='contains'){status=content.includes(criterion.expected)?'PASS':'FAIL';detail='EXACT_LITERAL_TEXT';}
      else if(jsonError){detail=jsonError;}
      else{const resolved=resolve(parsed,criterion.pointer);status=criterion.kind==='json_exists'?resolved.found?'PASS':'FAIL':resolved.found&&scalar(resolved.value)&&Object.is(resolved.value,criterion.expected)?'PASS':'FAIL';detail=resolved.found?'EXACT_JSON_PATH':'JSON_PATH_MISSING';}
      report.checks.push({id:criterion.id,label:criterion.label,kind:criterion.kind,status,detail});
    }
    report.outcome=report.checks.some(c=>c.status==='FAIL')?'CRITERIA_MISMATCH':report.checks.some(c=>c.status==='UNKNOWN')?'UNDETERMINED':'CRITERIA_MATCH';
  }catch(error){report.error_code=error instanceof ContractError?error.code:'VERIFICATION_UNAVAILABLE';report.checks.push({id:'input',status:'UNKNOWN',detail:report.error_code});}
  return report;
}
export function workerInstructions(contract){validateContract(contract);return `CONTRATO DE ENTREGA LOCAL\nTarefa: ${contract.task_id}\nTítulo: ${contract.title}\n\nProduza um arquivo texto UTF-8 ou JSON de até 1 MiB que satisfaça os critérios abaixo. Não modifique o contrato nem apresente seu recibo como evidência. Estes critérios não avaliam requisitos não declarados. O operador selecionará e lerá os bytes entregues.\n\n${JSON.stringify(contract.criteria,null,2)}\n\nIdentidade, origem, cronologia e utilidade não serão autenticadas por este checker. Nenhum resultado autoriza pagamento.\n`;}
export const escapeHTML=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function deliveryReportHTML(report){return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Covenant — contrato de entrega</title><style>body{max-width:900px;margin:40px auto;padding:24px;font:16px/1.6 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Conferência local de critérios finitos</h1><p>Não é certificação universal, assinatura ou aceite comercial.</p><pre>${escapeHTML(JSON.stringify(report,null,2))}</pre></html>`;}
