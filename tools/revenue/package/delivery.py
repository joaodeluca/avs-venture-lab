#!/usr/bin/env python3
"""Local delivery adapter for the existing V03 linear engine. No network/billing."""
import argparse
import csv
import hashlib
import html
import importlib.util
import io
import json
from datetime import timedelta
from pathlib import Path

ENGINE_PATH = Path(__file__).resolve().parent / 'reconcile.py'
spec = importlib.util.spec_from_file_location('v03_existing_engine', ENGINE_PATH)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
FIELDS = ('meter_id', 'unit', 'contractual_quantity', 'invoice_quantity',
          'expected_amount', 'invoice_amount', 'signed_delta')
NOTICE = ('Conferência linear local, não auditoria contábil certificada. '
          'Diferenças exigem revisão: não são recuperação de receita, crédito ou ordem de cobrança. '
          'Os hashes identificam entradas, não autenticidade ou completude independente.')


def build_report(directory):
    """Apply the commercial 31-day limit without changing the generic engine."""
    try:
        data, hashes = engine.load_bundle(directory)
        engine.validate(*data)
        start, end = map(engine.timestamp, (data[0]['period_start'], data[0]['period_end']))
        engine.require(end - start <= timedelta(days=31), 'pilot period exceeds 31 days')
        report = engine.reconcile(*data)
        report['input_sha256'] = hashes
    except (engine.Invalid, OSError, ValueError, TypeError) as exc:
        report = {'status': 'blocked', 'errors': [{'code': 'input_error', 'detail': str(exc)}],
                  'warnings': [], 'comparison': [], 'adjustment_candidates': [],
                  'recovered_revenue': None}
    report['delivery_notice'] = NOTICE
    report['engine_sha256'] = hashlib.sha256(ENGINE_PATH.read_bytes()).hexdigest()
    report['adapter_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report['customer_acceptance'] = 'not_observed'
    return report


def render_html(report):
    esc = lambda value: html.escape(str(value), quote=True)
    body = ''.join('<tr>' + ''.join('<td>' + esc(row.get(key, '')) + '</td>' for key in FIELDS) + '</tr>'
                   for row in report.get('comparison', []))
    problems = report.get('errors', []) + report.get('warnings', [])
    issues = ''.join('<li>' + esc(json.dumps(item, ensure_ascii=False)) + '</li>' for item in problems)
    hashes = ''.join('<li>' + esc(name) + ': <code>' + esc(digest) + '</code></li>'
                     for name, digest in report.get('input_sha256', {}).items())
    return ('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
            '<title>Conferência de uso — entrega local</title><style>'
            'body{font:16px system-ui;background:#fafafa;color:#17212b;max-width:1100px;margin:40px auto;padding:24px}'
            'table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{padding:12px;border:1px solid #ccd3da;text-align:left}'
            'code{overflow-wrap:anywhere}p{line-height:1.6}.notice{padding:16px;background:#fff1c8}'
            '</style><h1>Conferência de uso e faturamento</h1><p class="notice">' + esc(NOTICE) + '</p>'
            '<p>Classe de dados: <strong>' + esc(report.get('data_class', 'não validada')) + '</strong>. '
            'Estado: <strong>' + esc(report['status']) + '</strong>. '
            'Moeda: ' + esc(report.get('currency', 'não validada')) + '. Aceite de cliente: não observado.</p>'
            '<h2>Comparação por medidor</h2><p>Delta assinado = esperado − faturado. '
            'Positivo: possível subfaturamento; negativo: possível excesso. Não somar moedas ou concluir direito de cobrar.</p>'
            '<table><thead><tr>' + ''.join('<th>' + esc(key) + '</th>' for key in FIELDS) + '</tr></thead><tbody>' + body + '</tbody></table>' +
            ('<p>Sem comparação monetária: entrada bloqueada.</p>' if report['status'] == 'blocked' else '') +
            '<h2>Erros e avisos</h2><ul>' + issues + '</ul><h2>Proveniência das entradas</h2><ul>' + hashes + '</ul>'
            '<p>Dados ficam nesta máquina. Este HTML não tem JavaScript, fontes remotas ou chamadas de rede. '
            'Exports normalizados não constituem integração nativa Stripe/Orb/Metronome.</p></html>')


def artifacts(report):
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=FIELDS, lineterminator='\n')
    writer.writeheader()
    for original in report.get('comparison', []):
        row = dict(original)
        # The engine permits leading '-' in identifiers. Neutralize spreadsheet
        # text ONLY: signed monetary/quantity values keep their numeric meaning.
        for key in ('meter_id', 'unit'):
            text = str(row.get(key, ''))
            row[key] = "'" + text if text.startswith(('=', '+', '-', '@')) else text
        writer.writerow(row)
    payload = {'report.json': json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True).encode('utf-8') + b'\n',
               'summary.csv': buffer.getvalue().encode('utf-8'),
               'report.html': render_html(report).encode('utf-8')}
    manifest = {'schema_version': 1, 'status': report['status'],
                'files': {name: hashlib.sha256(raw).hexdigest() for name, raw in payload.items()},
                'acceptance': 'not_observed', 'notice': NOTICE}
    payload['manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True).encode('utf-8') + b'\n'
    return payload


def write_delivery(report, output):
    # Require a new directory; existing deliverables and customer data are never overwritten.
    output = Path(output).expanduser()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, raw in artifacts(report).items():
        with (output / name).open('xb') as stream:
            stream.write(raw)
        (output / name).chmod(0o600)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', required=True, help='Authorized normalized contract.json, events.json, invoice.json')
    parser.add_argument('--output-dir', required=True, help='NEW local directory; keep real customer files outside Git')
    args = parser.parse_args()
    report = build_report(args.input_dir)
    try:
        output = write_delivery(report, args.output_dir)
    except OSError as exc:
        print(json.dumps({'delivery_written': False, 'error': str(exc)}, ensure_ascii=False))
        return 3
    print(json.dumps({'delivery_written': True, 'output_dir': str(output.resolve()), 'status': report['status'],
                      'customer_acceptance': 'not_observed'}, ensure_ascii=False))
    return 2 if report['status'] == 'blocked' else 1 if report['status'] == 'review' else 0


if __name__ == '__main__':
    raise SystemExit(main())
