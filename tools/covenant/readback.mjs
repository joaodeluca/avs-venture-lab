/* Bounded browser readback: actual selected bytes, never a worker receipt. */
export const MAX_BYTES = 65536;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const LEGACY_TITLE = 'FAQ — Loja Aurora Fictícia';
export class ReadbackError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ReadbackError(code); };

// JSON.parse silently accepts duplicate keys. This bounded parser rejects them,
// uses null-prototype objects, and bounds recursion before traversing structures.
export function parseBytes(raw) {
  if (!(raw instanceof Uint8Array)) fail('BYTES_REQUIRED');
  if (raw.byteLength > MAX_BYTES) fail('FILE_TOO_LARGE');
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(raw); }
  catch { fail('INVALID_UTF8'); }
  let pos = 0;
  const ws = () => { while (/[\t\n\r ]/.test(text[pos] ?? '!')) pos++; };
  function string() {
    const start = pos++;
    while (pos < text.length) {
      if (text[pos] === '"') {
        pos++;
        try { return JSON.parse(text.slice(start,pos)); } catch { fail('INVALID_JSON'); }
      }
      if (text[pos] === '\\') pos++;
      pos++;
    }
    fail('INVALID_JSON');
  }
  function value(depth = 0) {
    if (depth > 32) fail('JSON_DEPTH_LIMIT');
    ws(); const ch = text[pos];
    if (ch === '"') return string();
    if (ch === '{') {
      pos++; ws(); const out = Object.create(null);
      if (text[pos] === '}') { pos++; return out; }
      while (pos < text.length) {
        ws(); if (text[pos] !== '"') fail('INVALID_JSON');
        const key = string();
        if (Object.hasOwn(out,key)) fail('DUPLICATE_JSON_KEY');
        ws(); if (text[pos++] !== ':') fail('INVALID_JSON');
        out[key] = value(depth + 1); ws();
        const separator = text[pos++];
        if (separator === '}') return out;
        if (separator !== ',') fail('INVALID_JSON');
      }
      fail('INVALID_JSON');
    }
    if (ch === '[') {
      pos++; ws(); const out = [];
      if (text[pos] === ']') { pos++; return out; }
      while (pos < text.length) {
        out.push(value(depth + 1)); ws(); const separator = text[pos++];
        if (separator === ']') return out;
        if (separator !== ',') fail('INVALID_JSON');
      }
      fail('INVALID_JSON');
    }
    for (const [word,result] of [['true',true],['false',false],['null',null]]) {
      if (text.slice(pos,pos + word.length) === word) { pos += word.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(pos));
    if (!match || !Number.isFinite(Number(match[0]))) fail('INVALID_JSON');
    pos += match[0].length; return Number(match[0]);
  }
  const result = value(); ws();
  if (pos !== text.length) fail('INVALID_JSON');
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('EXPECTED_OBJECT');
  return result;
}
export const bytes = value => new TextEncoder().encode(JSON.stringify(value,null,2) + '\n');
export async function sha256(raw) {
  if (!globalThis.crypto?.subtle) fail('HASH_UNAVAILABLE');
  const hash = await crypto.subtle.digest('SHA-256',raw);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2,'0')).join('');
}
const nonempty = (value,max = 8192) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && ID.test(value);
function validate(contract,source) {
  if (!['covenant-faq-contract-v1','covenant-browser-faq-contract-v1'].includes(contract.schema)) fail('UNSUPPORTED_CONTRACT');
  if (!validId(contract.task_id) || !HASH.test(contract.source_sha256 ?? '')) fail('INVALID_CONTRACT');
  if (!['covenant-synthetic-facts-v1','covenant-faq-reference-v1'].includes(source.schema) || !object(source.facts)) fail('UNSUPPORTED_SOURCE');
  if (!Array.isArray(contract.questions) || contract.questions.length < 1 || contract.questions.length > 5) fail('QUESTION_LIMIT');
  const ids = new Set();
  for (const q of contract.questions) {
    if (!object(q) || !validId(q.id) || ids.has(q.id) || !nonempty(q.question)) fail('INVALID_QUESTION');
    ids.add(q.id);
    if (!Object.hasOwn(source.facts,q.id) || !nonempty(source.facts[q.id])) fail('MISSING_REFERENCE_FACT');
  }
  if (contract.schema === 'covenant-browser-faq-contract-v1' &&
      (!nonempty(contract.expected_title,1024) || !nonempty(contract.run_token,128))) fail('INVALID_CONTRACT');
  if (contract.expected_artifact_sha256 !== undefined && !HASH.test(contract.expected_artifact_sha256)) fail('INVALID_EXPECTED_HASH');
}
const limits = [
  'Leitura dos bytes selecionados nesta aba. Não consulta o sistema de origem nem executa o trabalhador.',
  'Contrato, referência, token e eventual hash esperado são fornecidos pelo operador; não são autenticados.',
  'Igualdade exata com a referência não prova sua verdade, utilidade ou causa.',
  'Não confere criação na janela, ausência inicial, caminho, symlinks ou persistência no filesystem. lastModified não decide aceite.',
  'Nenhum resultado autoriza pagamento ou representa aceite comercial. A conferência local pode ser alterada pelo operador.'
];
export async function verifyReadback(input) {
  const report = {schema:'covenant-browser-readback-v1', mode:'SELECTED_LOCAL_BYTES',outcome:'UNKNOWN',
    observed_at:new Date().toISOString(), checks:[], comparisons:[],files:{}, receipt_used_as_evidence:false,
    actual_artifact_read:false, verification_complete:false, external_production_verified:false,
    causal_attribution_verified:false,payment_eligible:false,limits};
  const check = (name,status,detail) => report.checks.push({name,status,detail});
  // Snapshot caller input before any asynchronous hash operation.
  const selected = Object.fromEntries(['contract','source','artifact'].map(name => [name,input?.[name] instanceof Uint8Array ? input[name].slice() : null]));
  const expectedRunToken = input?.expectedRunToken;
  try {
    for (const name of ['contract','source','artifact']) {
      if (!selected[name]) {
        check(name + '_selected','UNKNOWN','Arquivo não selecionado; nenhum recibo substitui estes bytes.');
        continue;
      }
      const raw = selected[name];
      if (raw.byteLength > MAX_BYTES) fail('FILE_TOO_LARGE');
      report.files[name] = {bytes:raw.byteLength,sha256:await sha256(raw)};
      if (name === 'artifact') report.actual_artifact_read = true;
    }
    if (!selected.contract || !selected.source || !selected.artifact) return report;
    const contract = parseBytes(selected.contract), source = parseBytes(selected.source);
    validate(contract,source);
    const artifact = parseBytes(selected.artifact);
    report.task_id = contract.task_id;
    check('reference_bytes_binding',report.files.source.sha256 === contract.source_sha256 ? 'MATCH' : 'MISMATCH','SHA-256 dos bytes exatos da fonte contra o contrato. Espaços também alteram o hash.');
    if (artifact.schema !== 'covenant-faq-artifact-v1') fail('UNSUPPORTED_ARTIFACT');
    check('task_binding',artifact.task_id === contract.task_id ? 'MATCH' : 'MISMATCH','Identificador exato da tarefa.');
    const token = contract.schema === 'covenant-browser-faq-contract-v1' ? contract.run_token : expectedRunToken;
    check('run_token_binding',nonempty(token,128) ? (artifact.run_token === token ? 'MATCH' : 'MISMATCH') : 'UNKNOWN',
      nonempty(token,128) ? 'Token esperado declarado pelo operador; não autentica identidade ou execução.' : 'Contrato Python v1 não inclui token; informe o esperado, sem copiá-lo da entrega como prova.');
    check('artifact_reference_binding',artifact.source_sha256 === contract.source_sha256 ? 'MATCH' : 'MISMATCH','Entrega deve apontar para a referência fixada.');
    check('title',artifact.title === (contract.schema === 'covenant-browser-faq-contract-v1' ? contract.expected_title : LEGACY_TITLE) ? 'MATCH' : 'MISMATCH','Título exato contratado.');
    if (contract.expected_artifact_sha256) check('expected_artifact_hash',report.files.artifact.sha256 === contract.expected_artifact_sha256 ? 'MATCH' : 'MISMATCH','Hash externo esperado fornecido no contrato; não prova origem.');
    const answers = artifact.answers;
    check('exact_answer_count',Array.isArray(answers) && answers.length === contract.questions.length ? 'MATCH' : 'MISMATCH','Nenhuma resposta extra ou faltante.');
    for (const q of contract.questions) {
      const matches = Array.isArray(answers) ? answers.filter(a => object(a) && a.id === q.id) : [];
      check('answer_' + q.id,matches.length === 1 && matches[0].question === q.question && matches[0].answer === source.facts[q.id] ? 'MATCH' : 'MISMATCH','Uma resposta única, pergunta e resposta idênticas à referência. Não há julgamento semântico.');
      const observed = matches.length === 1 ? matches[0] : null;
      report.comparisons.push({id:q.id,expected_question:q.question,expected_answer:source.facts[q.id],
        observed_question:typeof observed?.question === 'string' ? observed.question.slice(0,8192) : null,
        observed_answer:typeof observed?.answer === 'string' ? observed.answer.slice(0,8192) : null,
        matching_id_count:matches.length,
        display_truncated:typeof observed?.answer === 'string' && observed.answer.length>8192 || typeof observed?.question === 'string' && observed.question.length>8192});
    }
    const contentChecks = [...report.checks];
    report.outcome = contentChecks.some(c => c.status === 'MISMATCH') ? 'REJECTED' : contentChecks.some(c => c.status === 'UNKNOWN') ? 'PARTIAL_MATCH' : 'CONTENT_MATCH';
    for (const [name,detail] of [
      ['file_freshness','O browser não prova criação na janela nem ausência anterior.'],
      ['source_authenticity','Referência selecionada pelo operador, sem autenticação de origem.'],
      ['producer_identity','Um token pode ser copiado; não identifica o trabalhador.'],
      ['causal_effect','Nenhuma consulta remota nem controle causal foi realizado.']
    ]) check(name,'UNKNOWN',detail);
  } catch (error) {
    report.error_code = error instanceof ReadbackError ? error.code : 'VERIFICATION_UNAVAILABLE';
    const unavailable = report.error_code.startsWith('UNSUPPORTED_') || report.error_code === 'HASH_UNAVAILABLE' || report.error_code === 'VERIFICATION_UNAVAILABLE';
    report.outcome = unavailable && !report.checks.some(c => c.status === 'MISMATCH') ? 'UNKNOWN' : 'REJECTED';
    check('input_validation',unavailable ? 'UNKNOWN' : 'MISMATCH',report.error_code);
  }
  return report;
}

// Contract preparation is deliberately separate from readback. It cannot create
// evidence of a worker's execution: only criteria and a trusted local reference.
export async function prepareContract({taskId,title,rows,token}) {
  if (!validId(taskId) || !nonempty(title,1024) || !nonempty(token,128)) fail('INVALID_CONTRACT');
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5) fail('QUESTION_LIMIT');
  const facts = Object.create(null), questions = [], ids = new Set();
  for (const row of rows) {
    if (!validId(row.id) || ids.has(row.id) || !nonempty(row.question) || !nonempty(row.answer)) fail('INVALID_QUESTION');
    ids.add(row.id); facts[row.id] = row.answer; questions.push({id:row.id,question:row.question});
  }
  const source = bytes({schema:'covenant-faq-reference-v1',facts});
  const contract = bytes({schema:'covenant-browser-faq-contract-v1',task_id:taskId,expected_title:title,
    run_token:token,source_sha256:await sha256(source),questions});
  if (source.byteLength > MAX_BYTES || contract.byteLength > MAX_BYTES) fail('FILE_TOO_LARGE');
  return {contract,source};
}
