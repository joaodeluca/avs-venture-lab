/** Original bounded CSV intake. It prepares explicit mappings, not provider adapters. */
const MAX_BYTES = 2_000_000;
const MAX_FIELD_CHARS = 4096;
const MAX_DATA_ROWS = 10_000;
const MAX_COLUMNS = 100;
const FIELDS = Object.freeze({
  contract: ['meter_id', 'unit', 'unit_price'],
  events: ['event_id', 'meter_id', 'unit', 'kind', 'quantity', 'occurred_at', 'received_at', 'reverses'],
  invoice: ['line_id', 'meter_id', 'unit', 'quantity', 'amount'],
});
const DECIMAL_FIELDS = new Set(['quantity', 'amount', 'unit_price']);
const need = (condition, message) => { if (!condition) throw new Error(message); };

function checkDelimiter(delimiter) {
  need(typeof delimiter === 'string' && delimiter.length === 1 &&
    !['"', '\r', '\n', '\0', '\uFEFF'].includes(delimiter),
  'CSV: delimitador explícito deve ser um caractere, diferente de aspas ou quebra de linha.');
}

/** Strings and field contents are preserved, including quoted line breaks and whitespace. */
export function parseSourceCsv(text, { delimiter = ',' } = {}) {
  need(typeof text === 'string', 'CSV: texto ausente.');
  checkDelimiter(delimiter);
  need(new TextEncoder().encode(text).length <= MAX_BYTES, 'CSV: limite de 2 MB excedido.');
  const bomRemoved = text.startsWith('\uFEFF');
  if (bomRemoved) text = text.slice(1);
  need(text.length > 0, 'CSV: cabeçalho ausente.');
  const parsed = [];
  let row = [], cell = '', state = 'start', position = 0;
  const addCell = () => {
    need(cell.length <= MAX_FIELD_CHARS, `CSV: campo excede 4096 caracteres no registro ${parsed.length + 1}.`);
    row.push(cell);
    need(row.length <= MAX_COLUMNS, `CSV: registro ${parsed.length + 1} excede 100 colunas.`);
    cell = '';
  };
  const addRow = () => {
    addCell();
    if (parsed.length) {
      need(row.length === parsed[0].length,
        `CSV: registro ${parsed.length + 1} tem ${row.length} colunas; cabeçalho exige ${parsed[0].length}. Nenhuma coluna foi descartada.`);
    }
    parsed.push(row);
    need(parsed.length <= MAX_DATA_ROWS + 1, 'CSV: limite de 10000 registros de dados excedido.');
    row = [];
  };
  while (position < text.length) {
    const ch = text[position++];
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[position] === '"') { cell += '"'; position++; }
        else state = 'closed';
      } else cell += ch;
    } else if (ch === delimiter) {
      addCell(); state = 'start';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r') {
        need(text[position] === '\n', `CSV: CR isolado no registro ${parsed.length + 1}; use LF ou CRLF.`);
        position++;
      }
      addRow(); state = 'start';
    } else if (ch === '"') {
      need(state === 'start', `CSV: aspas fora do início do campo no registro ${parsed.length + 1}.`);
      state = 'quoted';
    } else {
      need(state !== 'closed', `CSV: caracteres depois de aspas fechadas no registro ${parsed.length + 1}.`);
      cell += ch; state = 'unquoted';
    }
    need(cell.length <= MAX_FIELD_CHARS, `CSV: campo excede 4096 caracteres no registro ${parsed.length + 1}.`);
  }
  need(state !== 'quoted', `CSV: aspas não fechadas no registro ${parsed.length + 1}.`);
  if (cell !== '' || row.length || state !== 'start') addRow();
  need(parsed.length > 0, 'CSV: cabeçalho ausente.');
  const headers = parsed.shift();
  need(headers.every(header => header.trim().length > 0), 'CSV: cabeçalho vazio ou só com espaços.');
  need(new Set(headers).size === headers.length, 'CSV: cabeçalhos repetidos.');
  return { headers, rows: parsed, bomRemoved };
}

function normalizeDecimal(value, field, separator, rowNumber) {
  const amount = field === 'amount';
  const literalSeparator = separator === '.' ? '\\.' : ',';
  const places = amount ? 2 : 6;
  const pattern = new RegExp(`^(0|[1-9][0-9]{0,11})(${literalSeparator}[0-9]{1,${places}})?$`);
  need(pattern.test(value) && !/\s/.test(value),
    `CSV: ${field} no registro de dados ${rowNumber} exige decimal com ${separator === ',' ? 'vírgula' : 'ponto'}, até 12 dígitos inteiros e ${places} casas; sem milhares, sinal, espaços ou notação científica.`);
  const replaced = separator === ',' && value.includes(',');
  let normalized = replaced ? value.replace(',', '.') : value;
  let completed = false;
  if (amount) {
    const [integer, fraction = ''] = normalized.split('.');
    completed = fraction.length !== 2;
    normalized = integer + '.' + fraction.padEnd(2, '0');
  }
  return { value: normalized, replaced, completed };
}

/** No inferred mapping, IDs, units, dates, kind, contract, invoice scope or completeness. */
export function normalizeSource(text, { type, mapping, delimiter = ',', decimalSeparator = '.' } = {}) {
  need(Object.hasOwn(FIELDS, type), 'CSV: type exige contract, events ou invoice.');
  need(mapping !== null && typeof mapping === 'object' && !Array.isArray(mapping), 'CSV: mapeamento explícito ausente.');
  need(['.', ','].includes(decimalSeparator), 'CSV: separador decimal explícito exige ponto ou vírgula.');
  const fields = FIELDS[type];
  need(Object.keys(mapping).length === fields.length && fields.every(field => Object.hasOwn(mapping, field)) &&
    Object.keys(mapping).every(field => fields.includes(field)),
  'CSV: mapeamento deve conter exatamente os campos normalizados deste tipo.');
  const parsed = parseSourceCsv(text, { delimiter });
  const indexes = new Map(parsed.headers.map((header, index) => [header, index]));
  for (const field of fields) {
    const column = mapping[field];
    if (type === 'events' && field === 'reverses' && column === null) continue;
    need(typeof column === 'string' && indexes.has(column), `CSV: coluna mapeada de ${field} ausente no cabeçalho.`);
  }
  const counts = Object.fromEntries(fields.filter(field => DECIMAL_FIELDS.has(field)).map(field => [field, 0]));
  let amountScaleCompletions = 0;
  const records = parsed.rows.map((row, index) => Object.fromEntries(fields.map(field => {
    let value = mapping[field] === null ? '' : row[indexes.get(mapping[field])];
    if (DECIMAL_FIELDS.has(field)) {
      const converted = normalizeDecimal(value, field, decimalSeparator, index + 1);
      value = converted.value;
      if (converted.replaced) counts[field]++;
      if (converted.completed) amountScaleCompletions++;
    }
    return [field, value];
  })));
  const used = new Set(fields.map(field => mapping[field]).filter(column => column !== null));
  const audit = {
    adapter: 'source-csv-intake-v1',
    source_type: type,
    delimiter,
    decimal_separator: decimalSeparator,
    bom_removed: parsed.bomRemoved,
    source_bytes: new TextEncoder().encode(text).length,
    source_columns: parsed.headers.length,
    data_rows: parsed.rows.length,
    mapping: Object.fromEntries(fields.map(field => [field, mapping[field]])),
    unused_columns: parsed.headers.filter(header => !used.has(header)),
    conversions: {
      decimal_separator_replacements: counts,
      amount_scale_completions: amountScaleCompletions,
    },
    explicit_absences: type === 'events' && mapping.reverses === null ? ['reverses'] : [],
    notice: 'Original source remains outside this intake. Mapping and decimal convention are explicit. No IDs, dates, units, kind, completeness or provider compatibility inferred; validate records with the guided bundle before reconciliation.',
  };
  return { records, audit };
}
