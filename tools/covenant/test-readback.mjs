import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAX_BYTES,bytes,parseBytes,prepareContract,sha256,verifyReadback} from './readback.mjs';
import {reportHTML} from './readback-report.mjs';
const HERE = new URL('./',import.meta.url);
async function fixture() {
  const prepared=await prepareContract({taskId:'FAQ-001',title:'FAQ test',token:'expected-before-task',rows:[
    {id:'delivery',question:'When?',answer:'Four days.'},
    {id:'returns',question:'Returns?',answer:'Seven days.'}
  ]});
  const c=parseBytes(prepared.contract),s=parseBytes(prepared.source);
  return {...prepared,artifact:bytes({schema:'covenant-faq-artifact-v1',task_id:c.task_id,run_token:c.run_token,
    source_sha256:c.source_sha256,title:c.expected_title,answers:c.questions.map(q => ({...q,answer:s.facts[q.id]}))})};
}
async function mutate(input,name,change) {const value=parseBytes(input[name]);change(value);return {...input,[name]:bytes(value)};}
test('new contract: selected bytes match, four unavailable claims remain UNKNOWN',async () => {
  const input=await fixture(),r=await verifyReadback(input);
  assert.equal(r.outcome,'CONTENT_MATCH');assert.equal(r.actual_artifact_read,true);
  assert.equal(r.files.artifact.sha256,await sha256(input.artifact));assert.equal(r.comparisons[0].observed_answer,'Four days.');
  assert.equal(r.checks.filter(x => x.status==='UNKNOWN').length,4);
  for(const field of ['verification_complete','external_production_verified','causal_attribution_verified','payment_eligible','receipt_used_as_evidence']) assert.equal(r[field],false);
});
test('missing artifact is UNKNOWN even with a done receipt',async () => {
  const input=await fixture();delete input.artifact;
  const r=await verifyReadback({...input,receipt:bytes({claim:'done',verified:true})});
  assert.equal(r.outcome,'UNKNOWN');assert.equal(r.actual_artifact_read,false);assert.equal(r.receipt_used_as_evidence,false);
});
test('missing source and contract cannot infer reference from worker output',async () => {
  const input=await fixture();delete input.source;delete input.contract;
  const r=await verifyReadback(input);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.checks.filter(x => x.status==='UNKNOWN').length,2);
});
test('wrong answer rejected and displayed independently of receipt',async () => {
  const input=await mutate(await fixture(),'artifact',a => {a.answers[0].answer='Next century.';a.verified=true;a.payment_eligible=true;});
  const r=await verifyReadback(input);assert.equal(r.outcome,'REJECTED');assert.equal(r.comparisons[0].observed_answer,'Next century.');assert.equal(r.payment_eligible,false);
});
test('extra, missing and repeated answers rejected',async () => {
  for(const change of [a => a.answers.push(a.answers[0]),a => a.answers.pop(),a => a.answers[1]=a.answers[0]]) {
    assert.equal((await verifyReadback(await mutate(await fixture(),'artifact',change))).outcome,'REJECTED');
  }
});
test('task, token, question, title and source-pointer divergence rejected',async () => {
  for(const change of [a => a.task_id='other',a => a.run_token='copied-token',a => a.answers[0].question='Different?',a => a.title='wrong',a => a.source_sha256='0'.repeat(64)]) {
    assert.equal((await verifyReadback(await mutate(await fixture(),'artifact',change))).outcome,'REJECTED');
  }
});
test('source whitespace changes raw hash even when parsed facts match',async () => {
  const input=await fixture();input.source=new Uint8Array([...input.source,32]);
  const r=await verifyReadback(input);assert.equal(r.outcome,'REJECTED');assert.equal(r.checks.find(c => c.name==='reference_bytes_binding').status,'MISMATCH');
});
test('optional expected artifact hash matches exact bytes and rejects divergence',async () => {
  let input=await fixture();const expected=await sha256(input.artifact);
  input=await mutate(input,'contract',c => c.expected_artifact_sha256=expected);
  assert.equal((await verifyReadback(input)).outcome,'CONTENT_MATCH');
  input.artifact=new Uint8Array([...input.artifact,32]);
  const r=await verifyReadback(input);assert.equal(r.outcome,'REJECTED');assert.equal(r.checks.find(c => c.name==='expected_artifact_hash').status,'MISMATCH');
});
test('legacy public files need expected token; browser does not assert Python freshness',async () => {
  const [contract,source,artifact]=await Promise.all(['execution/task-contract.json','execution/synthetic-source.json','execution/example-evidence/positive-faq.json'].map(name => readFile(new URL(name,HERE))));
  const input={contract,source,artifact};
  assert.equal((await verifyReadback(input)).outcome,'PARTIAL_MATCH');
  const r=await verifyReadback({...input,expectedRunToken:'87cbf87a21429ae14663c8ac25828dbb2d11d38109970c4d'});
  assert.equal(r.outcome,'CONTENT_MATCH');assert.equal(r.checks.find(c => c.name==='file_freshness').status,'UNKNOWN');
});
test('unsupported task types and worker receipts are UNKNOWN, not content proof',async () => {
  for(const name of ['contract','source','artifact']) {
    const input=await mutate(await fixture(),name,v => v.schema='another-schema');
    assert.equal((await verifyReadback(input)).outcome,'UNKNOWN');
  }
});
test('an unsupported artifact does not erase a known source hash mismatch',async () => {
  const input=await mutate(await fixture(),'artifact',a => a.schema='worker-receipt-v1');
  input.source=new Uint8Array([...input.source,32]);
  const r=await verifyReadback(input);assert.equal(r.outcome,'REJECTED');assert.equal(r.error_code,'UNSUPPORTED_ARTIFACT');
});
test('all input roles enforce the actual byte limit',async () => {
  for(const name of ['contract','source','artifact']) {
    const input=await fixture(),raw=input[name],bounded=new Uint8Array(MAX_BYTES);bounded.fill(32);bounded.set(raw);
    input[name]=bounded;
    const r=await verifyReadback(input);
    assert.notEqual(r.error_code,'FILE_TOO_LARGE'); // Source now hashes differently; bytes bound alone is accepted.
    input[name]=new Uint8Array(MAX_BYTES+1);
    const over=await verifyReadback(input);assert.equal(over.error_code,'FILE_TOO_LARGE');assert.equal(over.outcome,'REJECTED');
  }
});
test('malformed, duplicate-key, deeply nested, non-object and invalid UTF-8 rejected',async () => {
  const cases=[['{"schema":"x","schema":"y"}','DUPLICATE_JSON_KEY'],['{"a":1,}','INVALID_JSON'],['[]','EXPECTED_OBJECT'],['{"a":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}','JSON_DEPTH_LIMIT'],['{"a":1e999}','INVALID_JSON']];
  for(const [text,code] of cases) {const input=await fixture();input.artifact=new TextEncoder().encode(text);const r=await verifyReadback(input);assert.equal(r.error_code,code);assert.equal(r.outcome,'REJECTED');}
  const input=await fixture();input.artifact=Uint8Array.of(0xff);assert.equal((await verifyReadback(input)).error_code,'INVALID_UTF8');
});
test('prototype-shaped keys remain ordinary data; path-looking IDs refused',async () => {
  const value=parseBytes(new TextEncoder().encode('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(value),null);assert.equal({}.polluted,undefined);
  await assert.rejects(prepareContract({taskId:'../escape',title:'x',token:'x',rows:[{id:'a',question:'q',answer:'a'}]}),/INVALID_CONTRACT/);
});
test('display is bounded; comparisons still use the full answer',async () => {
  const input=await mutate(await fixture(),'artifact',a => a.answers[0].answer='x'.repeat(9000));
  const r=await verifyReadback(input);assert.equal(r.outcome,'REJECTED');assert.equal(r.comparisons[0].observed_answer.length,8192);assert.equal(r.comparisons[0].display_truncated,true);
});
test('adversarial answer remains data in downloaded HTML, not executable markup',async () => {
  const payload='</pre><script>globalThis.pwned=true</script><img src=x onerror=alert(1)> & "quoted"';
  const input=await mutate(await fixture(),'artifact',a => a.answers[0].answer=payload);
  const report=await verifyReadback(input),html=reportHTML(report);
  assert.equal(report.comparisons[0].observed_answer,payload);assert.equal(report.outcome,'REJECTED');
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img src=x'),false);
  assert.equal(html.includes('&lt;script&gt;'),true);assert.equal(html.includes('&amp;'),true);
});
test('caller mutation during hashing cannot change selected input snapshot',async () => {
  const input=await fixture(),expected=await sha256(input.artifact),pending=verifyReadback(input);
  input.artifact.fill(0);input.contract.fill(0);input.source.fill(0);
  const r=await pending;assert.equal(r.outcome,'CONTENT_MATCH');assert.equal(r.files.artifact.sha256,expected);
});
test('1–5 unique string-ID questions are required when preparing',async () => {
  const base={taskId:'FAQ',title:'Title',token:'token'};
  for(const rows of [[],Array.from({length:6},(_,i) => ({id:'q'+i,question:'q',answer:'a'})),[{id:'q',question:'q',answer:'a'},{id:'q',question:'q',answer:'a'}],[{id:123,question:'q',answer:'a'}]]) await assert.rejects(prepareContract({...base,rows}));
  const result=await prepareContract({...base,rows:Array.from({length:5},(_,i) => ({id:'q'+i,question:'q',answer:'a'}))});assert.equal(parseBytes(result.contract).questions.length,5);
});
