/** Local linear reconciliation. Exact decimal coefficients, no network or storage. */
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const NUMBER=/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
const CENTS=/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const NOTICE='Comparison only. Signed deltas are review candidates, never recovered revenue or payment instructions.';
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const decimal=value=>{require(typeof value==='string'&&NUMBER.test(value),'decimal must be unsigned plain string, <=12 integer/6 fractional digits');const [a,b='']=value.split('.');return{n:BigInt(a+b),s:b.length};};
const pow=s=>10n**BigInt(s);
const add=(a,b)=>{const s=Math.max(a.s,b.s);return{n:a.n*pow(s-a.s)+b.n*pow(s-b.s),s};};
const subtract=(a,b)=>add(a,{n:-b.n,s:b.s});
const cmp=(a,b)=>{const d=subtract(a,b).n;return d<0n?-1:d>0n?1:0;};
const zero=()=>({n:0n,s:0});
export const decimalString=a=>{const sign=a.n<0n?'-':'';let digits=(a.n<0n?-a.n:a.n).toString().padStart(a.s+1,'0');return sign+(a.s?digits.slice(0,-a.s)+'.'+digits.slice(-a.s):digits);};
const roundedCents=a=>{if(a.s<=2)return{n:a.n*pow(2-a.s),s:2};const divisor=pow(a.s-2),absolute=a.n<0n?-a.n:a.n;const amount=absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n);return{n:a.n<0n?-amount:amount,s:2};};
const shape=(v,keys,where)=>{const expected=keys.split(' ').sort();require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify(expected),`${where}: fields must be ${keys}`);};
const identifier=v=>require(typeof v==='string'&&ID.test(v),'invalid identifier');
const rows=(v,n)=>require(Array.isArray(v)&&v.length<=n,`array limit ${n}`);
export function timestamp(v){
 require(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v),'timestamp requires UTC YYYY-MM-DDTHH:MM:SSZ');
 const [year,month,day,hour,minute,second]=v.match(/\d+/g).map(Number);
 const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
 require(year>=1&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day&&date.getUTCHours()===hour&&date.getUTCMinutes()===minute&&date.getUTCSeconds()===second,'invalid calendar timestamp');return date.getTime();
}
/** JSON.parse alone silently drops duplicate keys. This bounded parser rejects them. */
export function parseStrict(text){
 require(typeof text==='string'&&new TextEncoder().encode(text).length<=2000000,'file size limit exceeded');let pos=0;
 const skip=()=>{while(/[\x20\t\r\n]/.test(text[pos]??'x'))pos++;};
 const str=()=>{const start=pos++;while(pos<text.length){const char=text[pos++];if(char==='"')return JSON.parse(text.slice(start,pos));if(char==='\\')pos++;}throw new Error('invalid JSON encoding, syntax or nesting');};
 const value=(depth=0)=>{require(depth<=50,'JSON nesting exceeds 50');skip();const char=text[pos];if(char==='"')return str();
 if(char==='{'||char==='['){pos++;const object=char==='{',result=object?Object.create(null):[],close=object?'}':']';skip();if(text[pos]===close){pos++;return result;}while(true){skip();if(object){require(text[pos]==='"','invalid JSON object');const key=str();require(!Object.hasOwn(result,key),'duplicate JSON object key');skip();require(text[pos++]===':','invalid JSON object');result[key]=value(depth+1);}else result.push(value(depth+1));skip();if(text[pos]===close){pos++;return result;}require(text[pos++]===',','invalid JSON separator');}}
 const match=/^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(pos));require(match,'invalid JSON encoding, syntax or nesting');pos+=match[0].length;const result=JSON.parse(match[0]);require(typeof result!=='number'||(Number.isSafeInteger(result)&&!/[.eE]/.test(match[0])),'JSON numbers require integer tokens; decimals must be strings');return result;};
 const result=value();skip();require(pos===text.length,'invalid JSON trailing content');return result;
}
function validate(c,e,i){
 shape(c,'schema_version data_class customer_id currency period_start period_end invoice_cutoff pricing rounding meters','contract');shape(e,'schema_version data_class customer_id complete events','events');shape(i,'schema_version data_class customer_id currency period_start period_end complete lines','invoice');
 for(const doc of[c,e,i]){require(Number.isInteger(doc.schema_version)&&doc.schema_version===1,'unsupported schema version');require(['SIMULATED','USER_SUPPLIED'].includes(doc.data_class),'invalid data_class');identifier(doc.customer_id);}
 require(c.data_class===e.data_class&&e.data_class===i.data_class,'mixed data classes');require(c.customer_id===e.customer_id&&e.customer_id===i.customer_id,'customer mismatch');require(c.currency===i.currency&&['BRL','USD','EUR'].includes(c.currency),'currency mismatch/unsupported');require(c.pricing==='linear'&&c.rounding==='meter_total_half_up','unsupported pricing or rounding');
 const start=timestamp(c.period_start),end=timestamp(c.period_end),cutoff=timestamp(c.invoice_cutoff);require(start<end&&end<=cutoff,'invalid period/cutoff');require(end-start<=31*86400000,'pilot period exceeds 31 days');require(i.period_start===c.period_start&&i.period_end===c.period_end,'invoice period mismatch');require(e.complete===true&&i.complete===true,'incomplete export; comparison forbidden');rows(c.meters,100);require(c.meters.length>0,'at least one meter required');const meters=new Map();
 for(const m of c.meters){shape(m,'meter_id unit unit_price','meter');identifier(m.meter_id);identifier(m.unit);decimal(m.unit_price);require(!meters.has(m.meter_id),'duplicate contract meter');meters.set(m.meter_id,m);}
 rows(e.events,10000);for(const v of e.events){shape(v,'event_id meter_id unit kind quantity occurred_at received_at reverses','event');for(const key of['event_id','meter_id','unit'])identifier(v[key]);require(['usage','refund'].includes(v.kind),'unsupported event kind');require(decimal(v.quantity).n>0n,'event quantity must be positive');require(timestamp(v.occurred_at)<=timestamp(v.received_at),'receipt before occurrence');if(v.kind==='usage')require(v.reverses===null,'usage cannot reverse an event');else identifier(v.reverses);}
 rows(i.lines,100);const seen=new Set();for(const line of i.lines){shape(line,'line_id meter_id unit quantity amount','invoice line');for(const key of['line_id','meter_id','unit'])identifier(line[key]);decimal(line.quantity);decimal(line.amount);require(CENTS.test(line.amount),'amount requires exactly two decimals');require(!seen.has(line.line_id),'duplicate invoice line_id');seen.add(line.line_id);}return{meters,start,end,cutoff};
}
export function reconcile(c,e,i){
 const report={schema_version:1,data_class:null,errors:[],warnings:[],comparison:[],adjustment_candidates:[],status:'blocked',recovered_revenue:null,notice:NOTICE};let validated;
 try{validated=validate(c,e,i);}catch(error){report.errors.push({code:'invalid_schema',detail:error.message});return report;}
 const{meters,start,end,cutoff}=validated;report.data_class=c.data_class;report.currency=c.currency;const issue=(code,ref,warning=false)=>report[warning?'warnings':'errors'].push({code,ref});const unique=new Map();
 for(const event of e.events){const key=event.event_id;if(unique.has(key)){const same=Object.keys(event).every(k=>event[k]===unique.get(key)[k]);issue(same?'duplicate_event':'conflicting_event_id',key,same);}else unique.set(key,event);}
 const eligible=new Map();for(const key of[...unique.keys()].sort()){const event=unique.get(key),meter=meters.get(event.meter_id);if(!meter){issue('unknown_meter',key);continue;}if(event.unit!==meter.unit){issue('unit_mismatch',key);continue;}const occurred=timestamp(event.occurred_at);if(!(start<=occurred&&occurred<end)){issue('outside_period_excluded',key,true);continue;}if(timestamp(event.received_at)>cutoff){issue('late_event_requires_review',key);continue;}eligible.set(key,event);}
 const quantities=new Map([...meters.keys()].map(k=>[k,zero()])),refunded=new Map();for(const v of eligible.values())if(v.kind==='usage')quantities.set(v.meter_id,add(quantities.get(v.meter_id),decimal(v.quantity)));
 for(const key of[...eligible.keys()].sort()){const v=eligible.get(key);if(v.kind!=='refund')continue;const original=eligible.get(v.reverses);if(!original||original.kind!=='usage'||original.meter_id!==v.meter_id||timestamp(original.occurred_at)>timestamp(v.occurred_at)){issue('invalid_refund_reference',key);continue;}const ref=v.reverses;refunded.set(ref,add(refunded.get(ref)??zero(),decimal(v.quantity)));if(cmp(refunded.get(ref),decimal(original.quantity))>0){issue('refund_exceeds_original',key);continue;}quantities.set(v.meter_id,subtract(quantities.get(v.meter_id),decimal(v.quantity)));}
 const invoiceLines=new Map();for(const line of i.lines){const key=line.meter_id;if(!meters.has(key))issue('unknown_invoice_meter',line.line_id);else if(line.unit!==meters.get(key).unit)issue('invoice_unit_mismatch',line.line_id);else if(invoiceLines.has(key))issue('multiple_lines_per_meter_unsupported',line.line_id);else invoiceLines.set(key,line);}
 if(report.errors.length)return report;
 for(const key of[...meters.keys()].sort()){const m=meters.get(key),quantity=quantities.get(key),price=decimal(m.unit_price),expected=roundedCents({n:quantity.n*price.n,s:quantity.s+price.s}),line=invoiceLines.get(key),billedQ=line?decimal(line.quantity):zero(),billed=line?decimal(line.amount):zero(),delta=subtract(expected,billed);const row={meter_id:key,unit:m.unit,contractual_quantity:decimalString(quantity),invoice_quantity:decimalString(billedQ),expected_amount:decimalString(expected),invoice_amount:decimalString({n:billed.n*pow(2-billed.s),s:2}),signed_delta:decimalString(delta)};report.comparison.push(row);if(cmp(quantity,billedQ)!==0||delta.n!==0n)report.adjustment_candidates.push({...row,requires_human_review:true,interpretation:delta.n>0n?'possible_underbilling':delta.n<0n?'possible_overbilling':'quantity_only_mismatch'});}
 report.status=report.adjustment_candidates.length||report.warnings.length?'review':'matched';return report;
}
const outputDecimal=s=>{const sign=s.startsWith('-')?-1n:1n;const [a,b='']=s.replace(/^-/,'').split('.');return{n:sign*BigInt(a+b),s:b.length};};
export function totals(report){if(report.status==='blocked')return null;let expected=zero(),billed=zero(),delta=zero();for(const row of report.comparison){expected=add(expected,outputDecimal(row.expected_amount));billed=add(billed,outputDecimal(row.invoice_amount));delta=add(delta,outputDecimal(row.signed_delta));}return{expected:decimalString(roundedCents(expected)),billed:decimalString(roundedCents(billed)),delta:decimalString(roundedCents(delta))};}
