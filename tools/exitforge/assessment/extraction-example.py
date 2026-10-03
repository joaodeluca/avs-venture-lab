#!/usr/bin/env python3
"""ExitForge offline literal transformation. Review before use. Not n8n equivalence."""
import json, sys
PLAN = json.loads("{\"schema\":\"exitforge-offline-plan-v1\",\"model\":\"plain-json-items-explicit-literal-set\",\"input_limit_bytes\":1048576,\"item_limit\":1000,\"steps\":[{\"node\":\"N02\",\"retain_input\":true,\"fields\":[{\"name\":\"report_type\",\"type\":\"string\",\"value\":\"example\"}]}],\"n8n_equivalence_verified\":false,\"network_enabled\":false,\"production_approved\":false,\"limitations\":[\"Transformação de lista de objetos JSON fornecida pelo operador; não reproduz o início manual ou o envelope de itens do n8n.\",\"Somente Set v3.4 com retenção explicitamente indicada no export. Sem binários, expressões, dot notation, HTTP, estado, agendamento ou runtime.\",\"Executar este código local não comprova equivalência com uma execução n8n autorizada. O confronto original continua pendente.\",\"O pacote contém nomes de campos e valores literais derivados do export. Compartilhe somente dados que possa divulgar.\"]}")
MAX_BYTES = 1048576
def pairs(values):
    out = {}
    for key, value in values:
        if key in out or key in ('__proto__', 'prototype', 'constructor'):
            raise ValueError('duplicate/reserved JSON key')
        out[key] = value
    return out
def reject_number(value):
    raise ValueError('decimal/exponent/nonfinite numbers outside recut')
def integer(value):
    number = int(value)
    if abs(number) > 9007199254740991:
        raise ValueError('unsafe integer')
    return number
def bounded(value, depth=0, count=None):
    count = [0] if count is None else count
    count[0] += 1
    if depth > 20 or count[0] > 30000:
        raise ValueError('JSON structure exceeds limits')
    if isinstance(value, float) or isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        raise ValueError('numeric value outside integer recut')
    if isinstance(value, str):
        value.encode('utf-8', errors='strict')
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or key in ('__proto__', 'prototype', 'constructor'):
                raise ValueError('reserved JSON key')
            key.encode('utf-8', errors='strict')
            bounded(child, depth + 1, count)
    elif isinstance(value, list):
        for child in value:
            bounded(child, depth + 1, count)
def transform(items):
    if not isinstance(items, list) or len(items) > 1000 or any(not isinstance(x, dict) or any(k in x for k in ('json', 'binary', 'pairedItem')) for x in items):
        raise ValueError('expected <=1000 plain JSON objects, no n8n/binary envelope')
    bounded(items)
    # Copy through JSON so caller objects are never changed.
    items = json.loads(json.dumps(items, ensure_ascii=False), object_pairs_hook=pairs)
    for step in PLAN['steps']:
        result = []
        size = 2
        for index, item in enumerate(items):
            out = dict(item) if step['retain_input'] else {}
            for field in step['fields']:
                out[field['name']] = field['value']
            size += len(json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) + (1 if index else 0)
            if size > MAX_BYTES:
                raise ValueError('output exceeds 1MiB; no partial output')
            result.append(out)
        items = result
    raw = json.dumps(items, ensure_ascii=False, separators=(',', ':'))
    if len(raw.encode('utf-8')) > MAX_BYTES:
        raise ValueError('output exceeds 1MiB; no partial output')
    return raw
def main():
    if len(sys.argv) != 1:
        raise ValueError('usage: python3 extracted.py < input.json; stdout contains output only')
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('input exceeds 1MiB')
    items = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_int=integer, parse_float=reject_number, parse_constant=reject_number)
    bounded(items)
    output = transform(items)
    sys.stdout.write(output + '\n')
if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, KeyError, RecursionError, UnicodeError) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(2)
