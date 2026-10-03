import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeSource } from './intake.mjs';
import { buildGuidedBundle, eventsToCsv } from './guided.mjs';
import { verifyIntakePackage } from './verify-intake-package.mjs';

const names = ['contract', 'events', 'invoice'];
const hash = value => createHash('sha256').update(value).digest('hex');
const metadata = () => ({
  customer_id: 'ficticio_0001', data_class: 'SIMULATED', currency: 'BRL', invoice_currency: 'BRL',
  period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z', invoice_cutoff: '2026-10-02T00:00:00Z',
  invoice_period_start: '2026-09-01T00:00:00Z', invoice_period_end: '2026-10-01T00:00:00Z',
  events_completeness: 'complete', invoice_completeness: 'complete',
});
const options = {
  contract: { type: 'contract', delimiter: ';', decimalSeparator: ',', mapping: { meter_id: 'Meter', unit: 'Unit', unit_price: 'Price' } },
  events: { type: 'events', delimiter: ';', decimalSeparator: ',', mapping: { event_id: 'Event', meter_id: 'Meter', unit: 'Unit', kind: 'Kind', quantity: 'Qty', occurred_at: 'At', received_at: 'Received', reverses: 'Reverse' } },
  invoice: { type: 'invoice', delimiter: ';', decimalSeparator: ',', mapping: { line_id: 'Line', meter_id: 'Meter', unit: 'Unit', quantity: 'Qty', amount: 'Amount' } },
};
function fixture(changeMetadata = {}) {
  const texts = {
    contract: '\uFEFFMeter;Unit;Price;Note\n0001;call;0,60;ONLY_SYNTHETIC\n',
    events: 'Event;Meter;Unit;Kind;Qty;At;Received;Reverse\n001;0001;call;usage;2;2026-09-10T00:00:00Z;2026-09-10T00:00:01Z;\n002;0001;call;refund;1;2026-09-11T00:00:00Z;2026-09-11T00:00:01Z;001\n',
    invoice: 'Line;Meter;Unit;Qty;Amount\n0003;0001;call;1;0,90\n',
  };
  const normalized = Object.fromEntries(names.map(name => [name, normalizeSource(texts[name], options[name])]));
  const declarations = { ...metadata(), ...changeMetadata };
  const prepared = buildGuidedBundle({ ...declarations, meters: normalized.contract.records,
    invoice_lines: normalized.invoice.records, events_csv: eventsToCsv(normalized.events.records) });
  const sources = Object.fromEntries(names.map(name => {
    const bytes = Buffer.from(texts[name]);
    return [name, { name: 'ficticio-' + name + '.csv', byte_length: bytes.length, encoding: 'utf-8',
      base64: bytes.toString('base64'), sha256: hash(bytes), synthetic: true,
      options: structuredClone(options[name]), audit: normalized[name].audit }];
  }));
  return { format: 'usage-intake-package-v1', created_at: '2026-10-03T00:00:00Z',
    data_class: declarations.data_class, sources, metadata_declarations: declarations,
    normalized_inputs: prepared.bundle, input_preparation: prepared.preparation,
    report: { status: 'FAKE_ARCHIVED_RESULT', recovered_revenue: '999999' },
    report_html: '<script>throw new Error("MUST_NOT_EXECUTE")</script>' };
}
const verify = value => verifyIntakePackage(JSON.stringify(value));
const rawSource = (value, name, bytes) => {
  const source = value.sources[name];
  source.base64 = bytes.toString('base64'); source.byte_length = bytes.length; source.sha256 = hash(bytes);
};

test('original bytes with BOM, audit, metadata and normalized inputs recompute independent report', () => {
  const value = fixture(), text = JSON.stringify(value), result = verifyIntakePackage(text);
  assert.equal(result.report.status, 'review');
  assert.equal(result.report.comparison[0].expected_amount, '0.60');
  assert.equal(result.report.comparison[0].signed_delta, '-0.30');
  assert.equal(result.report.event_trail.rows[1].evaluation, 'refund_applied');
  assert.equal(result.report.event_trail.rows[0].event_id, '001');
  assert.equal(result.report.recovered_revenue, null);
  assert.equal(result.hashes.package_sha256, hash(Buffer.from(text)));
  assert.equal(result.hashes.original_sources.contract, value.sources.contract.sha256);
  assert.equal(result.hashes.normalized_inputs.events, hash(JSON.stringify(value.normalized_inputs.events)));
  assert.equal(result.authenticity_verified, false); assert.equal(result.completeness_verified, false);
  assert.match(result.notice, /not source authenticity or completeness/);
});
test('forged archived result and executable HTML cannot change output', () => {
  const value = fixture(), first = verify(value);
  value.report = { status: 'matched', comparison: [], recovered_revenue: '1000000' };
  value.report_html = '<script>globalThis.INTAKE_ATTACK_EXECUTED=true</script>';
  const second = verify(value);
  assert.deepEqual(second.report, first.report);
  assert.equal(globalThis.INTAKE_ATTACK_EXECUTED, undefined);
});
test('JSON duplicate-key last-value limitation is explicit and is not authenticated metadata', () => {
  const text = JSON.stringify(fixture()).replace('"format":"usage-intake-package-v1"',
    '"format":"discarded","format":"usage-intake-package-v1"');
  const result = verifyIntakePackage(text);
  assert.equal(result.json_parsing, 'standard_json_parse_duplicate_keys_last_wins');
  assert.match(result.notice, /duplicate keys are not detected/);
  assert.match(result.notice, /consistently rebuilt package can pass/);
});
test('tampered original bytes or hash are rejected before accepting normalized claims', () => {
  const bytesChanged = fixture();
  const source = bytesChanged.sources.invoice;
  source.base64 = Buffer.from(Buffer.from(source.base64, 'base64').toString().replace('0,90', '0,91')).toString('base64');
  assert.throws(() => verify(bytesChanged), /hash/);
  const wrongHash = fixture(); wrongHash.sources.contract.sha256 = '0'.repeat(64);
  assert.throws(() => verify(wrongHash), /hash/);
  const wrongLength = fixture(); wrongLength.sources.events.byte_length++;
  assert.throws(() => verify(wrongLength), /tamanho/);
});
test('changed bytes with updated hashes still require recalculated matching audit and normalized inputs', () => {
  const value = fixture();
  rawSource(value, 'invoice', Buffer.from(Buffer.from(value.sources.invoice.base64, 'base64').toString().replace('0,90', '0,91')));
  assert.throws(() => verify(value), /normalizadas/);
});
test('tampered normalized input and audit fail even when originals and hashes are intact', () => {
  const normalized = fixture(); normalized.normalized_inputs.invoice.lines[0].amount = '999.99';
  assert.throws(() => verify(normalized), /normalizadas/);
  const audit = fixture(); audit.sources.contract.audit.unused_columns = [];
  assert.throws(() => verify(audit), /auditoria/);
});
test('strict base64 rejects URL-safe, whitespace, missing padding and noncanonical pad bits', () => {
  for (const base64 of ['_w==', 'Zg==\n', 'Zg', 'Zh==']) {
    const value = fixture(); value.sources.contract.base64 = base64; value.sources.contract.byte_length = 1;
    assert.throws(() => verify(value), /base64/);
  }
});
test('source UTF-8 must be valid before CSV; BOM remains visible to intake audit', () => {
  const value = fixture(); rawSource(value, 'contract', Buffer.from([0xc3, 0x28]));
  assert.throws(() => verify(value), /UTF-8/);
  const bom = fixture(); bom.sources.contract.audit.bom_removed = false;
  assert.throws(() => verify(bom), /auditoria/);
});
test('three source names, explicit type/options and all metadata declarations are mandatory', () => {
  const changed = [
    value => delete value.sources.events,
    value => { value.sources.extra = value.sources.contract; },
    value => { value.sources.contract.options.type = 'invoice'; },
    value => delete value.sources.contract.options.decimalSeparator,
    value => delete value.metadata_declarations.invoice_cutoff,
    value => { value.metadata_declarations.extra = 'UNUSED'; },
    value => { value.metadata_declarations.currency = null; },
  ];
  for (const change of changed) { const value = fixture(); change(value); assert.throws(() => verify(value)); }
});
test('synthetic source flags cannot mix or be promoted to USER_SUPPLIED', () => {
  const mixed = fixture(); mixed.sources.invoice.synthetic = false;
  assert.throws(() => verify(mixed), /mistura/);
  const promoted = fixture(); promoted.data_class = 'USER_SUPPLIED'; promoted.metadata_declarations.data_class = 'USER_SUPPLIED';
  assert.throws(() => verify(promoted), /fictícia/);
  const mismatch = fixture(); mismatch.data_class = 'USER_SUPPLIED';
  assert.throws(() => verify(mismatch), /classe/);
  const missing = fixture(); delete missing.sources.contract.synthetic;
  assert.throws(() => verify(missing), /fictícia/);
});
test('all supplied flags can retain an explicitly declared SIMULATED class without authenticating it', () => {
  const value = fixture(); for (const source of Object.values(value.sources)) source.synthetic = false;
  assert.equal(verify(value).data_class, 'SIMULATED');
});
test('USER_SUPPLIED is accepted only as a matching declaration, not proof of source authenticity', () => {
  const value = fixture({ data_class: 'USER_SUPPLIED' });
  for (const source of Object.values(value.sources)) source.synthetic = false;
  const result = verify(value);
  assert.equal(result.data_class, 'USER_SUPPLIED');
  assert.equal(result.authenticity_verified, false);
});
test('unknown/incomplete completeness remains complete:false and blocks monetary comparison', () => {
  for (const name of ['events', 'invoice']) for (const declaration of ['unknown', 'incomplete']) {
    const value = fixture({ [name + '_completeness']: declaration });
    assert.equal(value.normalized_inputs[name].complete, false);
    const result = verify(value);
    assert.equal(result.report.status, 'blocked');
    assert.deepEqual(result.report.comparison, []);
    assert.deepEqual(result.report.adjustment_candidates, []);
    assert.ok(result.report.event_trail.rows.every(row => row.signed_quantity === null));
  }
});
test('package physical 12 MB boundary passes; one extra byte and source over 2 MB fail', () => {
  const value = fixture(); value.report_html = '';
  const bytesBefore = Buffer.byteLength(JSON.stringify(value));
  value.report_html = 'x'.repeat(12_000_000 - bytesBefore);
  const exact = JSON.stringify(value);
  assert.equal(Buffer.byteLength(exact), 12_000_000);
  assert.equal(verifyIntakePackage(exact).report.status, 'review');
  assert.throws(() => verifyIntakePackage(exact + ' '), /12 MB/);
  const largeSource = fixture(); rawSource(largeSource, 'contract', Buffer.alloc(2_000_001, 65));
  largeSource.sources.contract.byte_length = 2_000_000;
  assert.throws(() => verify(largeSource), /2 MB/);
});
test('invalid format and invalid JSON fail with short errors without input lines', () => {
  assert.throws(() => verifyIntakePackage('{"PRIVATE_SENTINEL":'), error => !error.message.includes('PRIVATE_SENTINEL'));
  const value = fixture(); value.format = 'unsupported'; assert.throws(() => verify(value), /formato/);
  const badCsv = fixture(); rawSource(badCsv, 'events', Buffer.from('PRIVATE_SENTINEL\n"unterminated'));
  assert.throws(() => verify(badCsv), error => error.message.includes('CSV') && !error.message.includes('PRIVATE_SENTINEL'));
});
test('CLI reads regular file, emits recomputed JSON, leaves bytes intact and handles invalid UTF-8', () => {
  const directory = mkdtempSync(join(tmpdir(), 'avs-intake-verify-'));
  try {
    const path = join(directory, 'synthetic.json');
    const content = Buffer.from(JSON.stringify(fixture())); writeFileSync(path, content);
    const cli = fileURLToPath(new URL('./verify-intake-package.mjs', import.meta.url));
    const good = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).report.comparison[0].signed_delta, '-0.30');
    assert.deepEqual(readFileSync(path), content);
    writeFileSync(path, Buffer.from([0xc3, 0x28]));
    const bad = spawnSync(process.execPath, [cli, path], { encoding: 'utf8' });
    assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
    assert.deepEqual(JSON.parse(bad.stderr), { error: 'Pacote: UTF-8 inválido.' });
    const missing = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
    assert.equal(missing.status, 1); assert.match(JSON.parse(missing.stderr).error, /^Uso:/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('CLI invoked by symlink resolves the real module and produces stdout JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'avs-intake-symlink-'));
  try {
    const source = fileURLToPath(new URL('./verify-intake-package.mjs', import.meta.url));
    const linked = join(directory, 'verify-linked.mjs');
    const path = join(directory, 'synthetic.json');
    symlinkSync(source, linked); writeFileSync(path, JSON.stringify(fixture()));
    const run = spawnSync(process.execPath, [linked, path], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '');
    assert.equal(JSON.parse(run.stdout).report.comparison[0].signed_delta, '-0.30');
    assert.equal(JSON.parse(run.stdout).format, 'usage-intake-verification-v1');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('importing verifier by symlink does not start the CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'avs-intake-import-'));
  try {
    const source = fileURLToPath(new URL('./verify-intake-package.mjs', import.meta.url));
    const linked = join(directory, 'verify-linked.mjs'); symlinkSync(source, linked);
    const script = 'import {pathToFileURL} from "node:url"; await import(pathToFileURL(process.argv[1]).href); console.log("IMPORTED_ONLY");';
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, linked], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'IMPORTED_ONLY\n'); assert.equal(run.stderr, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
