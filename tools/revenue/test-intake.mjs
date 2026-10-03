import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceCsv, normalizeSource } from './intake.mjs';

const contractMapping = { meter_id: 'Meter', unit: 'Unit', unit_price: 'Price' };
const invoiceMapping = { line_id: 'Line', meter_id: 'Meter', unit: 'Unit', quantity: 'Qty', amount: 'Amount' };
const eventMapping = { event_id: 'Event', meter_id: 'Meter', unit: 'Unit', kind: 'Kind', quantity: 'Qty', occurred_at: 'At', received_at: 'Received', reverses: null };

test('CSV preserves escaped quotes, quoted multiline data, whitespace and CRLF', () => {
  const parsed = parseSourceCsv('\uFEFFName,Note,Last\r\n"0007","line1\r\nline2, ""quoted""", trailing \r\n');
  assert.deepEqual(parsed.headers, ['Name', 'Note', 'Last']);
  assert.deepEqual(parsed.rows, [['0007', 'line1\r\nline2, "quoted"', ' trailing ']]);
  assert.equal(parsed.bomRemoved, true);
});
test('header-only source is zero rows, not a fabricated row or completeness claim', () => {
  const parsed = parseSourceCsv('Meter,Unit,Price\n');
  assert.deepEqual(parsed.rows, []);
  const prepared = normalizeSource('Meter,Unit,Price\n', { type: 'contract', mapping: contractMapping });
  assert.deepEqual(prepared.records, []);
  assert.equal(prepared.audit.data_rows, 0);
  assert.equal(Object.hasOwn(prepared.audit, 'complete'), false);
});
test('unterminated quoting rejects whole input after valid records', () => {
  assert.throws(() => parseSourceCsv('a,b\nvalid,row\n"unfinished'), /aspas não fechadas/);
});
test('characters after closing quote and quotes inside unquoted values are rejected', () => {
  for (const malformed of ['a,b\n"value"suffix,other', 'a,b\nvalue"suffix,other', 'a,b\n"value" ,other']) {
    assert.throws(() => parseSourceCsv(malformed), /aspas/);
  }
});
test('isolated CR is rejected outside quotes and preserved inside quotes', () => {
  assert.throws(() => parseSourceCsv('a,b\r1,2'), /CR isolado/);
  assert.deepEqual(parseSourceCsv('a\n"x\ry"').rows, [['x\ry']]);
});
test('extra or missing row columns are refused, including empty trailing extra column', () => {
  for (const source of ['a,b\n1,2,3', 'a,b\n1', 'a,b\n1,2,']) assert.throws(() => parseSourceCsv(source), /colunas/);
});
test('blank, whitespace-only and duplicate headers are refused without trimming valid names', () => {
  for (const source of [',b\n1,2', 'a, \n1,2', 'a,a\n1,2']) assert.throws(() => parseSourceCsv(source), /cabeçalho/);
  assert.deepEqual(parseSourceCsv(' a ,b\n1,2').headers, [' a ', 'b']);
});
test('internal empty records are not silently dropped', () => {
  assert.throws(() => parseSourceCsv('a,b\n1,2\n\n3,4'), /colunas/);
  assert.deepEqual(parseSourceCsv('a\n\nx').rows, [[''], ['x']]);
});
test('physical byte bound counts UTF-8 bytes before removing BOM', () => {
  const exact = 'h\n' + ('x'.repeat(3999) + '\n').repeat(499) + 'x'.repeat(3997) + '\n';
  assert.equal(new TextEncoder().encode(exact).length, 2_000_000);
  assert.equal(parseSourceCsv(exact).rows.length, 500);
  assert.throws(() => parseSourceCsv(exact + 'x'), /2 MB/);
  assert.throws(() => parseSourceCsv('h\n' + 'é'.repeat(1_000_000)), /2 MB/);
  assert.throws(() => parseSourceCsv('\uFEFF' + 'x'.repeat(1_999_998)), /2 MB/);
});
test('field bound is enforced on actual parsed contents and includes quoted contents', () => {
  assert.equal(parseSourceCsv('h\n' + 'x'.repeat(4096)).rows[0][0].length, 4096);
  assert.throws(() => parseSourceCsv('h\n' + 'x'.repeat(4097)), /4096/);
  assert.throws(() => parseSourceCsv('h\n"' + 'x'.repeat(4097) + '"'), /4096/);
  assert.equal(parseSourceCsv('h\n"' + '""'.repeat(4096) + '"').rows[0][0].length, 4096);
});
test('100 columns is accepted; 101 is rejected even when header and data agree', () => {
  const headers = Array.from({ length: 100 }, (_, index) => 'col_' + index);
  assert.equal(parseSourceCsv(headers.join(',') + '\n' + headers.join(',')).rows[0].length, 100);
  assert.throws(() => parseSourceCsv([...headers, 'extra'].join(',')), /100 colunas/);
});
test('10000 data rows is accepted, 10001 refused without dropping last rows', () => {
  assert.equal(parseSourceCsv('id\n' + '0001\n'.repeat(10_000)).rows.length, 10_000);
  assert.throws(() => parseSourceCsv('id\n' + '0001\n'.repeat(10_001)), /10000/);
});
test('invalid delimiters and non-string input never receive inferred defaults', () => {
  for (const delimiter of ['', ',;', '"', '\n', '\r', '\0']) assert.throws(() => parseSourceCsv('a,b', { delimiter }), /delimitador/);
  assert.throws(() => parseSourceCsv(null), /texto/);
});
test('explicit source mapping preserves leading zeros and lists unused columns without logging rows', () => {
  const prepared = normalizeSource('Meter,Unit,Price,Unused\n0001,001,0.010000,PRIVATE_VALUE\n', { type: 'contract', mapping: contractMapping });
  assert.deepEqual(prepared.records, [{ meter_id: '0001', unit: '001', unit_price: '0.010000' }]);
  assert.deepEqual(prepared.audit.mapping, contractMapping);
  assert.deepEqual(prepared.audit.unused_columns, ['Unused']);
  assert.equal(prepared.audit.source_columns, 4);
  assert.equal(JSON.stringify(prepared.audit).includes('PRIVATE_VALUE'), false);
});
test('mapping cannot be incomplete, inferred, extra, inherited or point to missing header', () => {
  const source = 'Meter,Unit,Price\napi,call,1';
  for (const mapping of [null, {}, { meter_id: 'Meter', unit: 'Unit' }, { ...contractMapping, inferred: 'Meter' }, { ...contractMapping, unit: 'Absent' }, Object.create(contractMapping)]) {
    assert.throws(() => normalizeSource(source, { type: 'contract', mapping }));
  }
  assert.throws(() => normalizeSource(source, { type: 'unknown', mapping: contractMapping }), /type/);
});
test('decimal comma is explicit, exact and confined to numeric mapped fields', () => {
  const prepared = normalizeSource('Line;Meter;Unit;Qty;Amount\n0007;001;u,raw;2,500000;10,2', {
    type: 'invoice', mapping: invoiceMapping, delimiter: ';', decimalSeparator: ',',
  });
  assert.deepEqual(prepared.records, [{ line_id: '0007', meter_id: '001', unit: 'u,raw', quantity: '2.500000', amount: '10.20' }]);
  assert.deepEqual(prepared.audit.conversions.decimal_separator_replacements, { quantity: 1, amount: 1 });
  assert.equal(prepared.audit.conversions.amount_scale_completions, 1);
});
test('comma decimal works with quoted comma CSV and does not infer unquoted extra columns', () => {
  assert.equal(normalizeSource('Meter,Unit,Price\napi,call,"0,100000"', { type: 'contract', mapping: contractMapping, decimalSeparator: ',' }).records[0].unit_price, '0.100000');
  assert.throws(() => normalizeSource('Meter,Unit,Price\napi,call,0,10', { type: 'contract', mapping: contractMapping, decimalSeparator: ',' }), /colunas/);
  assert.throws(() => normalizeSource('Meter,Unit,Price\napi,call,"0,10"', { type: 'contract', mapping: contractMapping }), /decimal/);
});
test('thousands grouping, signs, exponent, whitespace and excess decimal precision are refused', () => {
  for (const value of ['1,000.00', '1.000,00', '1 000', '1e3', '+1', '-1', ' 1', '01', '0.1234567', '1000000000000']) {
    assert.throws(() => normalizeSource('Meter;Unit;Price\napi;call;' + value, { type: 'contract', mapping: contractMapping, delimiter: ';' }), /decimal/);
  }
  for (const value of ['1.000,00', '1,000,000', '0.123', '0,1234567']) {
    assert.throws(() => normalizeSource('Meter;Unit;Price\napi;call;' + value, { type: 'contract', mapping: contractMapping, delimiter: ';', decimalSeparator: ',' }), /decimal/);
  }
});
test('quoted decimal with trailing line separator is refused rather than passing regex end anchor', () => {
  for (const value of ['1\n', '1\r\n', '1\u2028', '1\u2029']) {
    assert.throws(() => normalizeSource('Meter,Unit,Price\napi,call,"' + value + '"', { type: 'contract', mapping: contractMapping }), /decimal/);
  }
});
test('amount fills missing zero places without rounding and refuses more than two', () => {
  for (const [amount, expected, changed] of [['10', '10.00', 1], ['10.2', '10.20', 1], ['10.20', '10.20', 0]]) {
    const prepared = normalizeSource('Line,Meter,Unit,Qty,Amount\nline,api,call,1,' + amount, { type: 'invoice', mapping: invoiceMapping });
    assert.equal(prepared.records[0].amount, expected);
    assert.equal(prepared.audit.conversions.amount_scale_completions, changed);
  }
  assert.throws(() => normalizeSource('Line,Meter,Unit,Qty,Amount\nline,api,call,1,10.201', { type: 'invoice', mapping: invoiceMapping }), /decimal/);
});
test('invalid later numeric field refuses the entire normalization instead of returning partial records', () => {
  assert.throws(() => normalizeSource('Meter,Unit,Price\napi,call,1\napi2,call,1e3', { type: 'contract', mapping: contractMapping }), /registro de dados 2/);
});
test('events retain dates, IDs, kind and explicitly absent reverses for guided semantic validation', () => {
  const source = 'Event,Meter,Unit,Kind,Qty,At,Received\n00001,api,call,refund,1,LOCAL_DATE,UNCHANGED_DATE';
  const prepared = normalizeSource(source, { type: 'events', mapping: eventMapping });
  assert.deepEqual(prepared.records, [{ event_id: '00001', meter_id: 'api', unit: 'call', kind: 'refund', quantity: '1', occurred_at: 'LOCAL_DATE', received_at: 'UNCHANGED_DATE', reverses: '' }]);
  assert.deepEqual(prepared.audit.explicit_absences, ['reverses']);
  assert.equal(Object.hasOwn(prepared.audit, 'complete'), false);
});
test('explicit reverses column remains text, including empty content, without inferred event kind', () => {
  const source = 'Event,Meter,Unit,Kind,Qty,At,Received,Reverse\n001,api,call,unknown,1,x,y,0000';
  const prepared = normalizeSource(source, { type: 'events', mapping: { ...eventMapping, reverses: 'Reverse' } });
  assert.equal(prepared.records[0].reverses, '0000');
  assert.equal(prepared.records[0].kind, 'unknown');
  assert.deepEqual(prepared.audit.explicit_absences, []);
});
test('null mapping is permitted only as explicit events reverses absence', () => {
  assert.throws(() => normalizeSource('Meter,Unit,Price\napi,call,1', { type: 'contract', mapping: { ...contractMapping, unit: null } }), /coluna mapeada/);
  assert.throws(() => normalizeSource('Event,Meter,Unit,Kind,Qty,At,Received\n1,api,call,usage,1,x,y', { type: 'events', mapping: { ...eventMapping, occurred_at: null } }), /coluna mapeada/);
});
test('header prototype names remain ordinary strings, not object mutations', () => {
  const prepared = normalizeSource('__proto__,constructor,Price\n0001,call,1', { type: 'contract', mapping: { meter_id: '__proto__', unit: 'constructor', unit_price: 'Price' } });
  assert.deepEqual(prepared.records, [{ meter_id: '0001', unit: 'call', unit_price: '1' }]);
  assert.equal({}.meter_id, undefined);
});
