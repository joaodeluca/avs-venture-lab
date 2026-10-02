/* Finite diagnostic of supplied observations, not an authenticated oracle. */
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const scalar = x => ['string','boolean','number'].includes(typeof x) && (typeof x !== 'number' || Number.isFinite(x));
function date(x) {
  if (typeof x !== 'string') return false;
  // Date.parse alone normalizes impossible calendar dates such as 31 February.
  // This finite ISO profile requires seconds, explicit offset and <=3 decimals.
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|([+-])(\d\d):(\d\d))$/.exec(x);
  if (!m) return false;
  const [year,month,day,hour,minute,second] = m.slice(1,7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1] || hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== 'Z') {
    const offsetHour = Number(m[9]), offsetMinute = Number(m[10]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(x));
}
function invalid(message) { throw new Error(message); }
export function diagnose(input) {
  if (!object(input) || !Array.isArray(input.criteria) || !Array.isArray(input.observations)) invalid('Use criteria e observations como listas.');
  if (input.criteria.length < 1 || input.criteria.length > 5 || input.observations.length > 20) invalid('Limite: 1–5 critérios e até 20 observações.');
  const ids = new Set();
  for (const c of input.criteria) {
    if (!object(c) || typeof c.id !== 'string' || !c.id || ids.has(c.id)) invalid('Cada critério exige id único.');
    ids.add(c.id);
    if (![c.goal,c.principal,c.resource].every(x => typeof x === 'string' && x.trim())) invalid('Cada critério exige goal, principal e resource.');
    if (!object(c.predicate) || typeof c.predicate.field !== 'string' || !c.predicate.field || !scalar(c.predicate.equals)) invalid('Predicate exige field e equals (string, número finito ou booleano).');
    if (!object(c.window) || !date(c.window.start) || !date(c.window.end) || Date.parse(c.window.end) < Date.parse(c.window.start)) invalid('Window exige start/end ISO 8601 com fuso e ordem válida.');
  }
  for (const o of input.observations) {
    if (!object(o) || !ids.has(o.criterion_id) || !['effect_read','status_only','timeout'].includes(o.kind)) invalid('Observação precisa de criterion_id conhecido e kind effect_read/status_only/timeout.');
  }
  const rows = input.criteria.map(c => {
    const observations = input.observations.filter(o => o.criterion_id === c.id);
    const missing = [];
    const usable = [];
    let insufficientClaims = 0;
    for (const o of observations) {
      if (o.kind === 'status_only') { insufficientClaims++; continue; }
      if (o.kind === 'timeout') continue;
      const issues = [];
      if (o.principal !== c.principal) issues.push('principal ausente/incompatível');
      if (o.resource !== c.resource) issues.push('recurso ausente/incompatível');
      if (!date(o.observed_at)) issues.push('momento inválido/desconhecido');
      else if (Date.parse(o.observed_at) < Date.parse(c.window.start) || Date.parse(o.observed_at) > Date.parse(c.window.end)) issues.push('observação fora da janela');
      if (!object(o.source) || typeof o.source.label !== 'string' || !o.source.label.trim()) issues.push('fonte não identificada');
      if (!object(o.values) || !Object.hasOwn(o.values,c.predicate.field) || !scalar(o.values[c.predicate.field])) issues.push('campo esperado não observado');
      if (issues.length) missing.push(...issues); else usable.push(o.values[c.predicate.field]);
    }
    const matches = usable.map(x => x === c.predicate.equals);
    let outcome = 'UNKNOWN';
    if (matches.length && !missing.length && matches.every(x => x)) outcome = 'OBSERVED_MATCH';
    else if (matches.length && !missing.length && matches.every(x => !x)) outcome = 'OBSERVED_MISMATCH';
    else if (matches.length && !matches.every(x=>x) && !matches.every(x=>!x)) missing.push('observações admissíveis contraditórias: precisam de reconciliação');
    if (!usable.length) missing.push('consulta do efeito com principal, recurso, momento, fonte e campo esperado');
    return {
      criterion_id:c.id, goal:c.goal,
      receipt_claim: insufficientClaims || input.receipt ? 'INSUFFICIENT_AS_OUTCOME_PROOF' : 'NO_RECEIPT_CLAIM',
      outcome, observations_considered:observations.length, admissible_declared_observations:usable.length,
      missing:[...new Set(missing)],
      scope:'Comparação exata sobre dados fornecidos; fonte, autenticidade, independência e causalidade não verificadas.',
      next_action: outcome === 'UNKNOWN' ? 'Obter/reconciliar a consulta do efeito. Não concluir sucesso/falha e não repetir efeito só pelo timeout.' : 'Conferir fonte/autenticidade e rubrica com o responsável pelo aceite; não converter comparação local em aceite ou pagamento.'
    };
  });
  return {schema:'covenant-diagnostic-v1', mode:'DECLARED_INPUT_DIAGNOSTIC_ONLY',
    outcome: rows.some(x=>x.outcome==='UNKNOWN') ? 'UNKNOWN' : rows.some(x=>x.outcome==='OBSERVED_MISMATCH') ? 'OBSERVED_MISMATCH' : 'OBSERVED_MATCH',
    criteria:rows, external_state_verified:false, causal_attribution_verified:false, payment_eligible:false,
    limits:['Não autentica fornecedor ou observação.','Não executa agente, aceita contrato, envia dados ou aplica efeito.','Não mede vantagem, prevalência de falhas ou demanda comercial.','Um campo fornecido pelo usuário não se torna oráculo independente.']};
}
export const examples = (() => {
  const c = {id:'access',goal:'Permitir leitura do documento pelo usuário solicitado',principal:'SYN-USER',resource:'SYN-DOC',predicate:{field:'read_result',equals:'CONTENT_AVAILABLE'},window:{start:'2026-10-01T10:00:00Z',end:'2026-10-01T10:10:00Z'}};
  const receipt = {status:'resolved',receipt_hash:'same-status-receipt-in-opposite-worlds',scope:'LOCAL_STATUS_ONLY'};
  const read = value => ({criterion_id:'access',kind:'effect_read',principal:'SYN-USER',resource:'SYN-DOC',observed_at:'2026-10-01T10:05:00Z',source:{label:'Leitura sintética controlada pelo autor'},values:{read_result:value}});
  return {
    status_only:{criteria:[c],receipt,observations:[{criterion_id:'access',kind:'status_only',status:'resolved'}]},
    denied:{criteria:[c],receipt,observations:[read('ACCESS_DENIED')]},
    granted:{criteria:[c],receipt,observations:[read('CONTENT_AVAILABLE')]},
    timeout:{criteria:[c],observations:[{criterion_id:'access',kind:'timeout'}]},
    conflict:{criteria:[c],receipt,observations:[read('ACCESS_DENIED'),read('CONTENT_AVAILABLE')]}
  };
})();
