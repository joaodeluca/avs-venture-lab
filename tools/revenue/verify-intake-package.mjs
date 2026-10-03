/** Offline integrity/recomputation verifier for usage-intake-package-v1, not a source authenticator. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSource } from './intake.mjs';
import { buildGuidedBundle, eventsToCsv } from './guided.mjs';
import { reconcile } from './reconcile.mjs';
import { eventTrail } from './dossier.mjs';

const PACKAGE_LIMIT = 12_000_000;
const SOURCE_LIMIT = 2_000_000;
const SOURCES = ['contract', 'events', 'invoice'];
const METADATA = ['customer_id', 'data_class', 'currency', 'invoice_currency', 'period_start',
  'period_end', 'invoice_cutoff', 'invoice_period_start', 'invoice_period_end',
  'events_completeness', 'invoice_completeness'];
const SOURCE_FIELDS = ['name', 'byte_length', 'encoding', 'base64', 'sha256', 'synthetic', 'options', 'audit'];
const OPTIONS = ['type', 'mapping', 'delimiter', 'decimalSeparator'];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const need = (condition, message) => { if (!condition) throw new Error(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys, message) => {
  need(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), message);
};
const fatalUtf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

export function verifyIntakePackage(text) {
  need(typeof text === 'string', 'Pacote: texto JSON ausente.');
  const packageBytes = Buffer.from(text, 'utf8');
  need(packageBytes.length <= PACKAGE_LIMIT, 'Pacote: limite de 12 MB excedido.');
  let archived;
  try { archived = JSON.parse(text); } catch { throw new Error('Pacote: JSON inválido.'); }
  need(object(archived) && archived.format === 'usage-intake-package-v1', 'Pacote: formato incompatível.');
  exact(archived.sources, SOURCES, 'Pacote: exige exatamente as três fontes.');
  exact(archived.metadata_declarations, METADATA, 'Pacote: declarações explícitas ausentes ou incompatíveis.');
  need(METADATA.every(key => typeof archived.metadata_declarations[key] === 'string'), 'Pacote: declarações exigem texto explícito.');
  need(['SIMULATED', 'USER_SUPPLIED'].includes(archived.data_class) &&
    archived.data_class === archived.metadata_declarations.data_class, 'Pacote: classe da base incompatível.');
  exact(archived.normalized_inputs, SOURCES, 'Pacote: entradas normalizadas incompatíveis.');

  const flags = SOURCES.map(name => archived.sources[name]?.synthetic);
  need(flags.every(flag => typeof flag === 'boolean'), 'Pacote: origem fictícia deve ser explícita.');
  need(flags.every(flag => flag === flags[0]), 'Pacote: mistura de fontes fictícias e fornecidas recusada.');
  need(!flags[0] || archived.data_class === 'SIMULATED', 'Pacote: fonte fictícia exige classe SIMULATED.');

  const preparedSources = {}, originalHashes = {};
  for (const name of SOURCES) {
    const source = archived.sources[name];
    exact(source, SOURCE_FIELDS, `Pacote: estrutura da fonte ${name} incompatível.`);
    need(typeof source.name === 'string' && source.encoding === 'utf-8', `Pacote: metadados da fonte ${name} incompatíveis.`);
    need(Number.isSafeInteger(source.byte_length) && source.byte_length >= 0 && source.byte_length <= SOURCE_LIMIT,
      `Pacote: tamanho da fonte ${name} inválido.`);
    need(typeof source.base64 === 'string' && source.base64.length <= Math.ceil(SOURCE_LIMIT / 3) * 4 && BASE64.test(source.base64),
      `Pacote: base64 da fonte ${name} inválido.`);
    const bytes = Buffer.from(source.base64, 'base64');
    need(bytes.length <= SOURCE_LIMIT, `Pacote: fonte ${name} excede 2 MB.`);
    need(bytes.toString('base64') === source.base64, `Pacote: base64 da fonte ${name} não canônico.`);
    need(bytes.length === source.byte_length, `Pacote: tamanho da fonte ${name} não corresponde aos bytes.`);
    const hash = sha(bytes);
    need(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256) && hash === source.sha256,
      `Pacote: hash da fonte ${name} não corresponde aos bytes.`);
    let sourceText;
    try { sourceText = fatalUtf8(bytes); } catch { throw new Error(`Pacote: UTF-8 da fonte ${name} inválido.`); }
    exact(source.options, OPTIONS, `Pacote: opções explícitas da fonte ${name} incompatíveis.`);
    need(source.options.type === name, `Pacote: tipo da fonte ${name} incompatível.`);
    let normalized;
    try { normalized = normalizeSource(sourceText, source.options); }
    catch { throw new Error(`Pacote: CSV ou mapeamento da fonte ${name} inválido.`); }
    need(isDeepStrictEqual(source.audit, normalized.audit), `Pacote: auditoria da fonte ${name} diverge da recomputação.`);
    preparedSources[name] = normalized;
    originalHashes[name] = hash;
  }

  let prepared;
  try {
    prepared = buildGuidedBundle({
      ...archived.metadata_declarations,
      meters: preparedSources.contract.records,
      invoice_lines: preparedSources.invoice.records,
      events_csv: eventsToCsv(preparedSources.events.records),
    });
  } catch { throw new Error('Pacote: declarações ou registros não sustentam a base guiada.'); }
  need(isDeepStrictEqual(archived.normalized_inputs, prepared.bundle),
    'Pacote: entradas normalizadas divergem da recomputação.');

  // Archived report/report_html/input_preparation are never applied or executed.
  const report = reconcile(prepared.bundle.contract, prepared.bundle.events, prepared.bundle.invoice);
  report.data_class = prepared.bundle.contract.data_class;
  report.report_version = 2;
  report.event_trail = eventTrail(prepared.bundle.contract, prepared.bundle.events, report);
  report.original_source_sha256 = originalHashes;
  return {
    format: 'usage-intake-verification-v1',
    data_class: prepared.bundle.contract.data_class,
    verification_scope: 'byte_integrity_and_recomputation_only',
    json_parsing: 'standard_json_parse_duplicate_keys_last_wins',
    authenticity_verified: false,
    completeness_verified: false,
    report,
    hashes: {
      package_sha256: sha(packageBytes),
      original_sources: originalHashes,
      normalized_inputs: Object.fromEntries(SOURCES.map(name => [name, sha(JSON.stringify(prepared.bundle[name]))])),
    },
    notice: 'Hashes identify bytes, not source authenticity or completeness. A consistently rebuilt package can pass. The envelope uses standard JSON.parse: duplicate keys are not detected and the last value is used. Metadata and completeness remain declarations. Archived report and HTML were ignored; the result is recalculated locally and is not acceptance, recovered revenue or authorization to charge.',
  };
}

const invokedAsCli = () => {
  if (!process.argv[1]) return false;
  if (typeof import.meta.main === 'boolean' && !import.meta.main) return false;
  // Older Node releases have no import.meta.main. Eval/print can carry a module
  // path as argv[1] without that imported module being the process entry point.
  if (process.execArgv.some(argument => /^(?:-[ep]|--(?:eval|print)(?:=|$))/.test(argument))) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
};

if (invokedAsCli()) {
  try {
    need(process.argv.length === 3, 'Uso: node verify-intake-package.mjs ARQUIVO');
    const path = process.argv[2];
    const stat = statSync(path);
    need(stat.isFile(), 'Pacote: informe um arquivo regular.');
    need(stat.size <= PACKAGE_LIMIT, 'Pacote: limite de 12 MB excedido.');
    const bytes = readFileSync(path);
    need(bytes.length <= PACKAGE_LIMIT, 'Pacote: limite de 12 MB excedido.');
    let text;
    try { text = fatalUtf8(bytes); } catch { throw new Error('Pacote: UTF-8 inválido.'); }
    process.stdout.write(JSON.stringify(verifyIntakePackage(text), null, 2) + '\n');
  } catch (error) {
    const message = error instanceof Error && /^(Pacote:|Uso:)/.test(error.message)
      ? error.message : 'Pacote: não foi possível ler ou verificar o arquivo.';
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    process.exitCode = 1;
  }
}
