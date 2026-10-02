#!/usr/bin/env python3
"""Offline, read-only comparison of normalized exports; Python 3.9+ stdlib."""
import argparse
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path

MAX_BYTES = 2_000_000
MAX_EVENTS = 10_000
ID = re.compile(r'[A-Za-z0-9_-]{1,80}\Z')
NUMBER = re.compile(r'(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?\Z')
TIME = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\Z')


class Invalid(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Invalid(message)


def shape(value, keys, where):
    require(type(value) is dict and set(value) == set(keys.split()), f'{where}: fields must be {keys}')


def identifier(value):
    require(type(value) is str and bool(ID.fullmatch(value)), 'invalid identifier')


def number(value, cents=False):
    require(type(value) is str and bool(NUMBER.fullmatch(value)), 'decimal must be unsigned plain string, <=12 integer/6 fractional digits')
    result = Decimal(value)
    if cents:
        require(bool(re.fullmatch(r'(0|[1-9][0-9]{0,11})\.[0-9]{2}', value)), 'amount requires exactly two decimals')
    return result


def timestamp(value):
    require(type(value) is str and bool(TIME.fullmatch(value)), 'timestamp requires UTC YYYY-MM-DDTHH:MM:SSZ')
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError as exc:
        raise Invalid('invalid calendar timestamp') from exc


def rows(value, limit):
    require(type(value) is list and len(value) <= limit, f'array limit {limit}')


def pairs(items):
    out = {}
    for key, value in items:
        require(key not in out, 'duplicate JSON object key')
        out[key] = value
    return out


def reject_constant(_):
    raise Invalid('non-finite JSON value')


def load_bundle(directory):
    """Fixed basenames, no symlinks, regular files only, bounded reads; no writes."""
    root = Path(directory).expanduser().resolve(strict=True)
    require(root.is_dir(), 'input must be a directory')
    data, hashes = [], {}
    for name in ('contract.json', 'events.json', 'invoice.json'):
        path = root / name
        require(not path.is_symlink(), 'symlink inputs forbidden')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode), 'regular files required')
            require(info.st_size <= MAX_BYTES, 'file size limit exceeded')
            raw = stream.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, 'file size limit exceeded')
        hashes[name] = hashlib.sha256(raw).hexdigest()
        try:
            data.append(json.loads(raw, object_pairs_hook=pairs, parse_constant=reject_constant))
        except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
            raise Invalid('invalid JSON encoding, syntax or nesting') from exc
    return data, hashes


def validate(c, e, i):
    shape(c, 'schema_version data_class customer_id currency period_start period_end invoice_cutoff pricing rounding meters', 'contract')
    shape(e, 'schema_version data_class customer_id complete events', 'events')
    shape(i, 'schema_version data_class customer_id currency period_start period_end complete lines', 'invoice')
    for doc in (c, e, i):
        require(type(doc['schema_version']) is int and doc['schema_version'] == 1, 'unsupported schema version')
        require(doc['data_class'] in ('SIMULATED', 'USER_SUPPLIED'), 'invalid data_class')
        identifier(doc['customer_id'])
    require(c['data_class'] == e['data_class'] == i['data_class'], 'mixed data classes')
    require(c['customer_id'] == e['customer_id'] == i['customer_id'], 'customer mismatch')
    require(c['currency'] == i['currency'] and c['currency'] in ('BRL', 'USD', 'EUR'), 'currency mismatch/unsupported')
    require(c['pricing'] == 'linear' and c['rounding'] == 'meter_total_half_up', 'unsupported pricing or rounding')
    start, end, cutoff = map(timestamp, (c['period_start'], c['period_end'], c['invoice_cutoff']))
    require(start < end <= cutoff, 'invalid period/cutoff')
    require(end - start <= timedelta(days=366), 'period exceeds 366 days')
    require(i['period_start'] == c['period_start'] and i['period_end'] == c['period_end'], 'invoice period mismatch')
    require(e['complete'] is True and i['complete'] is True, 'incomplete export; comparison forbidden')
    rows(c['meters'], 100)
    require(len(c['meters']) > 0, 'at least one meter required')
    meters = {}
    for meter in c['meters']:
        shape(meter, 'meter_id unit unit_price', 'meter')
        identifier(meter['meter_id']); identifier(meter['unit']); number(meter['unit_price'])
        require(meter['meter_id'] not in meters, 'duplicate contract meter')
        meters[meter['meter_id']] = meter
    rows(e['events'], MAX_EVENTS)
    for event in e['events']:
        shape(event, 'event_id meter_id unit kind quantity occurred_at received_at reverses', 'event')
        for key in ('event_id', 'meter_id', 'unit'):
            identifier(event[key])
        require(event['kind'] in ('usage', 'refund'), 'unsupported event kind')
        require(number(event['quantity']) > 0, 'event quantity must be positive')
        require(timestamp(event['occurred_at']) <= timestamp(event['received_at']), 'receipt before occurrence')
        if event['kind'] == 'usage':
            require(event['reverses'] is None, 'usage cannot reverse an event')
        else:
            identifier(event['reverses'])
    rows(i['lines'], 100)
    seen = set()
    for line in i['lines']:
        shape(line, 'line_id meter_id unit quantity amount', 'invoice line')
        for key in ('line_id', 'meter_id', 'unit'):
            identifier(line[key])
        number(line['quantity']); number(line['amount'], cents=True)
        require(line['line_id'] not in seen, 'duplicate invoice line_id')
        seen.add(line['line_id'])
    return meters, start, end, cutoff


def reconcile(c, e, i):
    report = {'schema_version': 1, 'data_class': None, 'errors': [], 'warnings': [],
              'comparison': [], 'adjustment_candidates': [], 'status': 'blocked',
              'recovered_revenue': None,
              'notice': 'Comparison only. Signed deltas are review candidates, never recovered revenue or payment instructions.'}
    try:
        meters, start, end, cutoff = validate(c, e, i)
    except (Invalid, TypeError) as exc:
        report['errors'].append({'code': 'invalid_schema', 'detail': str(exc)})
        return report
    report['data_class'] = c['data_class']
    report['currency'] = c['currency']

    def issue(code, ref, warning=False):
        report['warnings' if warning else 'errors'].append({'code': code, 'ref': ref})

    unique = {}
    for event in e['events']:
        key = event['event_id']
        if key in unique:
            issue('duplicate_event' if event == unique[key] else 'conflicting_event_id', key, event == unique[key])
        else:
            unique[key] = event
    eligible = {}
    for key, event in sorted(unique.items()):
        meter = meters.get(event['meter_id'])
        if meter is None:
            issue('unknown_meter', key)
            continue
        if event['unit'] != meter['unit']:
            issue('unit_mismatch', key)
            continue
        if not start <= timestamp(event['occurred_at']) < end:
            issue('outside_period_excluded', key, True)
            continue
        if timestamp(event['received_at']) > cutoff:
            issue('late_event_requires_review', key)
            continue
        eligible[key] = event
    quantities = {key: Decimal(0) for key in meters}
    refunded = {}
    with localcontext() as ctx:
        ctx.prec = 50
        for event in eligible.values():
            if event['kind'] == 'usage':
                quantities[event['meter_id']] += number(event['quantity'])
        for key, event in sorted(eligible.items()):
            if event['kind'] != 'refund':
                continue
            original = eligible.get(event['reverses'])
            if original is None or original['kind'] != 'usage' or original['meter_id'] != event['meter_id'] or timestamp(original['occurred_at']) > timestamp(event['occurred_at']):
                issue('invalid_refund_reference', key)
                continue
            ref = event['reverses']
            refunded[ref] = refunded.get(ref, Decimal(0)) + number(event['quantity'])
            if refunded[ref] > number(original['quantity']):
                issue('refund_exceeds_original', key)
                continue
            quantities[event['meter_id']] -= number(event['quantity'])
        invoice_lines = {}
        for line in i['lines']:
            key = line['meter_id']
            if key not in meters:
                issue('unknown_invoice_meter', line['line_id'])
            elif line['unit'] != meters[key]['unit']:
                issue('invoice_unit_mismatch', line['line_id'])
            elif key in invoice_lines:
                issue('multiple_lines_per_meter_unsupported', line['line_id'])
            else:
                invoice_lines[key] = line
        # No monetary output from partially accepted or ambiguous data.
        if report['errors']:
            return report
        for key, meter in sorted(meters.items()):
            quantity = quantities[key]
            expected = (quantity * number(meter['unit_price'])).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
            line = invoice_lines.get(key)
            billed_q = number(line['quantity']) if line else Decimal(0)
            billed = number(line['amount']) if line else Decimal(0)
            delta = expected - billed
            row = {'meter_id': key, 'unit': meter['unit'], 'contractual_quantity': str(quantity),
                   'invoice_quantity': str(billed_q), 'expected_amount': str(expected),
                   'invoice_amount': format(billed, '.2f'), 'signed_delta': str(delta)}
            report['comparison'].append(row)
            if quantity != billed_q or delta != 0:
                report['adjustment_candidates'].append(dict(row, requires_human_review=True,
                    interpretation='possible_underbilling' if delta > 0 else 'possible_overbilling' if delta < 0 else 'quantity_only_mismatch'))
        report['status'] = 'review' if report['adjustment_candidates'] or report['warnings'] else 'matched'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', required=True, help='Directory containing contract.json, events.json, invoice.json')
    args = parser.parse_args()
    try:
        data, hashes = load_bundle(args.input_dir)
        report = reconcile(*data)
        report['input_sha256'] = hashes
    except (Invalid, OSError, ValueError) as exc:
        report = {'status': 'blocked', 'errors': [{'code': 'input_error', 'detail': str(exc)}],
                  'adjustment_candidates': [], 'recovered_revenue': None}
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 2 if report['status'] == 'blocked' else 1 if report['status'] == 'review' else 0


if __name__ == '__main__':
    raise SystemExit(main())
