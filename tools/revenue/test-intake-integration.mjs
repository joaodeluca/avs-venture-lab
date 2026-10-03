/** Independent integration fixtures. Entirely synthetic; no customers or benefit claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSource, parseSourceCsv} from './intake.mjs';
import {buildGuidedBundle, eventsToCsv} from './guided.mjs';
import {reconcile, totals} from './reconcile.mjs';
import {eventTrail, reportHtml} from './dossier.mjs';

const START = '2026-09-01T00:00:00Z';
const END = '2026-10-01T00:00:00Z';
const CUTOFF = '2026-10-02T00:00:00Z';
const OCCURRED = '2026-09-10T08:07:06Z';
const RECEIVED = '2026-09-10T08:09:10Z';
const mappings = {
  contract: {meter_id: 'Medidor', unit: 'Unidade', unit_price: 'Preço por unidade'},
  events: {event_id: 'ID do evento', meter_id: 'Medidor', unit: 'Unidade', kind: 'Tipo',
    quantity: 'Quantidade', occurred_at: 'Ocorrido UTC', received_at: 'Recebido UTC', reverses: 'Referência'},
  invoice: {line_id: 'ID da linha', meter_id: 'Medidor', unit: 'Unidade', quantity: 'Quantidade cobrada', amount: 'Valor cobrado'},
};
const usage = `0001;0002;call;usage;5000,123456;${OCCURRED};${RECEIVED};;somente sintético`;
const refund = '0003;0002;call;refund;0,123456;2026-09-11T00:00:00Z;2026-09-11T00:01:00Z;0001;somente sintético';
const texts = () => ({
  contract: 'Medidor;Unidade;Preço por unidade;Nota livre\r\n0002;call;0,60;"SINTÉTICO; sem cliente"\r\n',
  events: 'ID do evento;Medidor;Unidade;Tipo;Quantidade;Ocorrido UTC;Recebido UTC;Referência;Nota livre\n' +
    usage + '\n' + refund + '\n' + usage + '\n',
  invoice: 'ID da linha;Medidor;Unidade;Quantidade cobrada;Valor cobrado;Nota livre\n0004;0002;call;5000,000000;3150,00;SINTÉTICO\n',
});
const normalize = (type, text, mapping = mappings[type]) => normalizeSource(text, {
  type, mapping, delimiter: ';', decimalSeparator: ',',
});

function prepare(sourceTexts = texts(), metadata = {}) {
  const normalized = Object.fromEntries(Object.entries(sourceTexts).map(([type, text]) => [type, normalize(type, text)]));
  const form = {
    data_class: 'SIMULATED', customer_id: 'synthetic_only_0001', currency: 'BRL',
    period_start: START, period_end: END, invoice_cutoff: CUTOFF,
    invoice_currency: 'BRL', invoice_period_start: START, invoice_period_end: END,
    events_completeness: 'complete', invoice_completeness: 'complete',
    meters: normalized.contract.records, events_csv: eventsToCsv(normalized.events.records),
    invoice_lines: normalized.invoice.records, ...metadata,
  };
  const prepared = buildGuidedBundle(form);
  const report = reconcile(prepared.bundle.contract, prepared.bundle.events, prepared.bundle.invoice);
  assert.deepEqual(report, prepared.report, 'guided preparation must not change reconciliation results');
  report.report_version = 2;
  report.event_trail = eventTrail(prepared.bundle.contract, prepared.bundle.events, report);
  return {normalized, form, prepared, report, html: reportHtml(report)};
}

function assertBlocked(result) {
  const {report, html} = result;
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.comparison, []);
  assert.deepEqual(report.adjustment_candidates, []);
  assert.equal(report.recovered_revenue, null);
  assert.equal(totals(report), null);
  assert.ok(report.event_trail.rows.every(row => row.signed_quantity === null && row.included_in_final_comparison === false));
  assert.match(html, /Nenhuma comparação monetária emitida/);
  assert.doesNotMatch(html, /<th>expected_amount<\/th>/);
}

test('three mapped synthetic CSV sources reach reconciliation with explicit common metadata', () => {
  const {prepared, report, html} = prepare();
  assert.deepEqual(Object.keys(prepared.bundle).sort(), ['contract', 'events', 'invoice']);
  for (const document of Object.values(prepared.bundle)) {
    assert.equal(document.data_class, 'SIMULATED');
    assert.equal(document.customer_id, 'synthetic_only_0001');
  }
  assert.equal(prepared.bundle.contract.currency, 'BRL');
  assert.equal(prepared.bundle.invoice.currency, 'BRL');
  assert.equal(prepared.bundle.contract.period_start, START);
  assert.equal(prepared.bundle.invoice.period_end, END);
  assert.equal(prepared.bundle.contract.invoice_cutoff, CUTOFF);
  assert.deepEqual(prepared.preparation.declarations, {events: 'complete', invoice: 'complete'});
  assert.equal(prepared.preparation.completeness, 'user_asserted_not_verified');
  assert.equal(report.recovered_revenue, null);
  assert.match(html, /SIMULATED/);
  assert.match(html, /não são recuperação de receita/);
});

test('leading-zero IDs, six-place quantity tokens and UTC timestamps survive every seam', () => {
  const {normalized, prepared, report, html} = prepare();
  const mapped = normalized.events.records[0];
  assert.equal(mapped.event_id, '0001');
  assert.equal(mapped.meter_id, '0002');
  assert.equal(mapped.quantity, '5000.123456');
  assert.equal(mapped.occurred_at, OCCURRED);
  assert.equal(mapped.received_at, RECEIVED);
  assert.equal(normalized.contract.records[0].unit_price, '0.60');
  assert.equal(normalized.invoice.records[0].line_id, '0004');
  assert.equal(normalized.invoice.records[0].quantity, '5000.000000');
  assert.equal(prepared.bundle.events.events[0].quantity, '5000.123456');
  assert.equal(JSON.parse(prepared.inputs.events).events[0].event_id, '0001');
  assert.equal(report.event_trail.rows[0].declared_quantity, '5000.123456');
  assert.equal(report.event_trail.rows[0].occurred_at, OCCURRED);
  assert.match(html, /5000\.123456/);
  assert.ok(html.includes(OCCURRED));
});

test('price 0.60 × net usage 5000 gives expected 3000.00 and signed delta -150.00 against 3150.00', () => {
  const {report} = prepare();
  assert.equal(report.status, 'review');
  assert.deepEqual(report.comparison, [{meter_id: '0002', unit: 'call', contractual_quantity: '5000.000000',
    invoice_quantity: '5000.000000', expected_amount: '3000.00', invoice_amount: '3150.00', signed_delta: '-150.00'}]);
  assert.deepEqual(totals(report), {expected: '3000.00', billed: '3150.00', delta: '-150.00'});
  assert.equal(report.adjustment_candidates[0].requires_human_review, true);
});

test('usage, referenced refund and identical duplicate remain separate trail rows with one contribution each', () => {
  const {prepared, report} = prepare();
  assert.equal(prepared.bundle.events.events.length, 3);
  const [use, reversal, duplicate] = report.event_trail.rows;
  assert.equal(use.evaluation, 'usage_included');
  assert.equal(use.signed_quantity, '5000.123456');
  assert.equal(reversal.evaluation, 'refund_applied');
  assert.equal(reversal.reverses, '0001');
  assert.equal(reversal.signed_quantity, '-0.123456');
  assert.equal(duplicate.event_id, '0001');
  assert.equal(duplicate.evaluation, 'duplicate_excluded');
  assert.equal(duplicate.signed_quantity, null);
  assert.equal(duplicate.included_in_final_comparison, false);
  assert.equal(report.warnings.filter(issue => issue.code === 'duplicate_event').length, 1);
});

test('unknown or incomplete declarations for either export suppress all final comparison amounts', () => {
  for (const source of ['events', 'invoice']) for (const declaration of ['unknown', 'incomplete']) {
    const result = prepare(texts(), {[source + '_completeness']: declaration});
    assert.equal(result.prepared.bundle[source].complete, false);
    assert.equal(result.prepared.preparation.declarations[source], declaration);
    assertBlocked(result);
  }
});

test('metadata absent from raw CSV is never inferred during bundle preparation', () => {
  for (const key of ['data_class', 'customer_id', 'currency', 'period_start', 'period_end', 'invoice_cutoff',
    'invoice_currency', 'invoice_period_start', 'invoice_period_end', 'events_completeness', 'invoice_completeness']) {
    assert.throws(() => prepare(texts(), {[key]: undefined}), undefined, key + ' must be explicit');
  }
});

test('event/invoice unit mismatches and a mismatched invoice period block the mapped pipeline', () => {
  const eventMismatch = texts();
  eventMismatch.events = eventMismatch.events.replaceAll(';call;', ';request;');
  const eventResult = prepare(eventMismatch);
  assertBlocked(eventResult);
  assert.ok(eventResult.report.errors.some(issue => issue.code === 'unit_mismatch'));
  const invoiceMismatch = texts();
  invoiceMismatch.invoice = invoiceMismatch.invoice.replace(';call;', ';request;');
  const invoiceResult = prepare(invoiceMismatch);
  assertBlocked(invoiceResult);
  assert.ok(invoiceResult.report.errors.some(issue => issue.code === 'invoice_unit_mismatch'));
  const periodResult = prepare(texts(), {invoice_period_start: '2026-09-02T00:00:00Z'});
  assertBlocked(periodResult);
  assert.ok(periodResult.report.errors.some(issue => /period/i.test(issue.detail ?? '')));
});

test('missing required mapping and empty required cells cannot become usable reconciled events', () => {
  const mapping = {...mappings.events};
  delete mapping.quantity;
  assert.throws(() => normalize('events', texts().events, mapping));
  const missingCell = texts();
  missingCell.events = missingCell.events.replaceAll(RECEIVED, '');
  assert.throws(() => prepare(missingCell));
});

test('a three-decimal invoice amount is rejected rather than rounded into reconciliation', () => {
  const original = texts();
  original.invoice = original.invoice.replace('3150,00', '3150,001');
  assert.throws(() => prepare(original));
  assert.ok(original.invoice.includes('3150,001'));
});

test('explicit delimiter parses quoted human headers/cells and preserves original source text', () => {
  const source = texts();
  const originals = structuredClone(source);
  const parsed = parseSourceCsv(source.contract, {delimiter: ';'});
  assert.deepEqual(parsed.headers, ['Medidor', 'Unidade', 'Preço por unidade', 'Nota livre']);
  assert.deepEqual(parsed.rows, [['0002', 'call', '0,60', 'SINTÉTICO; sem cliente']]);
  const {normalized} = prepare(source);
  assert.deepEqual(source, originals);
  for (const type of ['contract', 'events', 'invoice']) {
    assert.ok(normalized[type].audit && typeof normalized[type].audit === 'object');
    assert.deepEqual(normalized[type].audit.unused_columns, ['Nota livre'], `${type}: unmapped column must be disclosed`);
    assert.deepEqual(normalized[type].audit.mapping, mappings[type]);
    assert.equal(normalized[type].audit.data_rows, type === 'events' ? 3 : 1);
    assert.ok(!Object.hasOwn(normalized[type].records[0], 'Nota livre'), 'only explicitly mapped fields enter the existing schema');
  }
  assert.equal(normalized.contract.audit.conversions.decimal_separator_replacements.unit_price, 1);
  assert.equal(normalized.events.audit.conversions.decimal_separator_replacements.quantity, 3);
  assert.equal(normalized.invoice.audit.conversions.decimal_separator_replacements.amount, 1);
});
