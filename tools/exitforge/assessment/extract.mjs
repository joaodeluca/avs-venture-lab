import {inspect, MAX_BYTES} from './inspect.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const require=(ok,msg)=>{if(!ok)throw Error(msg);};
const safeKey=k=>!['__proto__','prototype','constructor'].includes(k);
function unicode(v){for(let i=0;i<v.length;i++){const n=v.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=v.charCodeAt(++i);require(next>=0xdc00&&next<=0xdfff,'Unicode inválido.');}else require(n<0xdc00||n>0xdfff,'Unicode inválido.');}return v;}
export function parseExtractionJSON(text,{integerOnly=false}={}){
 require(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_BYTES,'Entrada limitada a 1 MiB.');
 let i=0,count=0;const skip=()=>{while(/[\x20\t\r\n]/.test(text[i]??'x'))i++;};
 function str(){const start=i++;while(i<text.length){const c=text[i++];if(c==='"')return unicode(JSON.parse(text.slice(start,i)));if(c==='\\')i++;}throw Error('JSON inválido.');}
 function value(depth=0){require(depth<=20&&++count<=30000,'JSON excede limites de estrutura.');skip();const c=text[i];if(c==='"')return str();if(c==='{'||c==='['){i++;const obj=c==='{',r=obj?Object.create(null):[],end=obj?'}':']';skip();if(text[i]===end){i++;return r;}while(true){skip();if(obj){require(text[i]==='"','JSON inválido.');const k=str();require(safeKey(k)&&!Object.hasOwn(r,k),'Chave reservada ou repetida.');skip();require(text[i++]===':','JSON inválido.');r[k]=value(depth+1);}else r.push(value(depth+1));skip();if(text[i]===end){i++;return r;}require(text[i++]===',','JSON inválido.');}}
 const m=/^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));require(m,'JSON inválido.');i+=m[0].length;const v=JSON.parse(m[0]);require(typeof v!=='number'||Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&(!integerOnly||Number.isSafeInteger(v)&&!/[.eE]/.test(m[0])),'Número fora do recorte; entradas/valores de execução exigem inteiros seguros.');return v;}
 const r=value();skip();require(i===text.length,'JSON contém dados adicionais.');return r;
}
export function prepareExtraction(raw){
 const workflow=parseExtractionJSON(raw), screen=inspect(workflow);
 require(screen.status==='STRUCTURAL_CANDIDATE','Há alertas estruturais. A extração offline está bloqueada.');
 const nodes=screen.linear_order.map(alias=>workflow.nodes[Number(alias.slice(1))-1]);
 const steps=[];
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i],alias=screen.linear_order[i];
  if(n.type==='n8n-nodes-base.manualTrigger'||n.type==='n8n-nodes-base.noOp')continue;
  require(n.type==='n8n-nodes-base.set','O pacote offline aceita somente início manual, NoOp e Set literal; HTTP não é extraído.');
  require(n.typeVersion===3.4,'A extração exige Set v3.4; as demais versões permanecem só na triagem.');
  const p=n.parameters;
  require(p.mode==='manual'&&typeof p.includeOtherFields==='boolean','Set exige mode manual e includeOtherFields explícito; default ausente não é inferido.');
  const fields=p.assignments.assignments.map(a=>{
   require(safeKey(a.name)&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(a.name),'Nome de campo fora do recorte simples.');
   require(a.type!=='number'||Number.isSafeInteger(a.value),'Valor numérico precisa ser inteiro seguro.');
   require(a.type!=='string'||a.value.length<=8192,'Texto literal excede 8.192 caracteres.');
   return {name:a.name,type:a.type,value:a.value};
  });
  steps.push({node:alias,retain_input:p.includeOtherFields,fields});
 }
 require(steps.length>0,'É necessário pelo menos um Set literal para gerar uma transformação.');
 return {schema:'exitforge-offline-plan-v1',model:'plain-json-items-explicit-literal-set',input_limit_bytes:MAX_BYTES,item_limit:1000,steps,
  n8n_equivalence_verified:false,network_enabled:false,production_approved:false,
  limitations:['Transformação de lista de objetos JSON fornecida pelo operador; não reproduz o início manual ou o envelope de itens do n8n.','Somente Set v3.4 com retenção explicitamente indicada no export. Sem binários, expressões, dot notation, HTTP, estado, agendamento ou runtime.','Executar este código local não comprova equivalência com uma execução n8n autorizada. O confronto original continua pendente.','O pacote contém nomes de campos e valores literais derivados do export. Compartilhe somente dados que possa divulgar.']};
}
export function validatePlan(plan){
 require(object(plan)&&plan.schema==='exitforge-offline-plan-v1'&&plan.model==='plain-json-items-explicit-literal-set','Plano de transformação inválido.');
 require(plan.n8n_equivalence_verified===false&&plan.network_enabled===false&&plan.production_approved===false,'Plano não pode declarar produção/equivalência/rede.');
 require(Array.isArray(plan.steps)&&plan.steps.length>=1&&plan.steps.length<=7,'Plano limitado a sete operações Set.');
 for(const s of plan.steps){require(object(s)&&/^N\d{2}$/.test(s.node)&&typeof s.retain_input==='boolean'&&Array.isArray(s.fields)&&s.fields.length>=1&&s.fields.length<=30,'Operação inválida.');const names=new Set();for(const f of s.fields){require(object(f)&&safeKey(f.name)&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f.name)&&!names.has(f.name),'Campo inválido/repetido.');names.add(f.name);require(['string','boolean','number'].includes(f.type)&&typeof f.value===f.type,'Tipo literal inválido.');require(f.type!=='number'||Number.isSafeInteger(f.value),'Número fora do recorte.');require(f.type!=='string'||f.value.length<=8192,'Texto excede limite.');if(f.type==='string')unicode(f.value);}}
 return plan;
}
export function runOffline(plan,inputText){
 validatePlan(plan);let items=parseExtractionJSON(inputText,{integerOnly:true});require(Array.isArray(items)&&items.length<=1000&&items.every(v=>object(v)&&!['json','binary','pairedItem'].some(k=>Object.hasOwn(v,k))),'Entrada: lista com até mil objetos JSON simples, sem envelopes json/binary/pairedItem.');
 items=structuredClone(items);const trace=[];
 for(const step of plan.steps){let size=2;items=items.map((item,index)=>{const out=step.retain_input?structuredClone(item):Object.create(null);for(const field of step.fields)out[field.name]=field.value;size+=new TextEncoder().encode(JSON.stringify(out)).length+(index?1:0);require(size<=MAX_BYTES,'Saída excede 1 MiB; não produzimos resultado parcial.');return out;});trace.push({node:step.node,items:items.length,retain_input:step.retain_input});}
 const data=JSON.stringify(items);require(new TextEncoder().encode(data).length<=MAX_BYTES,'Saída excede 1 MiB; não produzimos resultado parcial.');
 return {items,trace,n8n_equivalence_verified:false,network_calls:0};
}
export function pythonSource(plan){
 validatePlan(plan);
 const encoded=JSON.stringify(JSON.stringify(plan)).replace(/\\u([0-9a-fA-F]{4})/g,'\\u$1');
 return `#!/usr/bin/env python3
"""ExitForge offline literal transformation. Review before use. Not n8n equivalence."""
import json, sys
PLAN = json.loads(${encoded})
MAX_BYTES = 1048576
def pairs(values):
    out = {}
    for key, value in values:
        if key in out or key in ('__proto__', 'prototype', 'constructor'):
            raise ValueError('duplicate/reserved JSON key')
        out[key] = value
    return out
def reject_number(value):
    raise ValueError('decimal/exponent/nonfinite numbers outside recut')
def integer(value):
    number = int(value)
    if abs(number) > 9007199254740991:
        raise ValueError('unsafe integer')
    return number
def bounded(value, depth=0, count=None):
    count = [0] if count is None else count
    count[0] += 1
    if depth > 20 or count[0] > 30000:
        raise ValueError('JSON structure exceeds limits')
    if isinstance(value, float) or isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        raise ValueError('numeric value outside integer recut')
    if isinstance(value, str):
        value.encode('utf-8', errors='strict')
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or key in ('__proto__', 'prototype', 'constructor'):
                raise ValueError('reserved JSON key')
            key.encode('utf-8', errors='strict')
            bounded(child, depth + 1, count)
    elif isinstance(value, list):
        for child in value:
            bounded(child, depth + 1, count)
def transform(items):
    if not isinstance(items, list) or len(items) > 1000 or any(not isinstance(x, dict) or any(k in x for k in ('json', 'binary', 'pairedItem')) for x in items):
        raise ValueError('expected <=1000 plain JSON objects, no n8n/binary envelope')
    bounded(items)
    # Copy through JSON so caller objects are never changed.
    items = json.loads(json.dumps(items, ensure_ascii=False), object_pairs_hook=pairs)
    for step in PLAN['steps']:
        result = []
        size = 2
        for index, item in enumerate(items):
            out = dict(item) if step['retain_input'] else {}
            for field in step['fields']:
                out[field['name']] = field['value']
            size += len(json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) + (1 if index else 0)
            if size > MAX_BYTES:
                raise ValueError('output exceeds 1MiB; no partial output')
            result.append(out)
        items = result
    raw = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
    if len(raw.encode('utf-8')) > MAX_BYTES:
        raise ValueError('output exceeds 1MiB; no partial output')
    return raw
def main():
    if len(sys.argv) != 1:
        raise ValueError('usage: python3 extracted.py < input.json; stdout contains output only')
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('input exceeds 1MiB')
    items = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_int=integer, parse_float=reject_number, parse_constant=reject_number)
    bounded(items)
    output = transform(items)
    sys.stdout.write(output + '\\n')
if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, KeyError, RecursionError, UnicodeError) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(2)
`;
}
