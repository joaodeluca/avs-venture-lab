#!/usr/bin/env python3
"""Local adapter for TraceBid's existing engine. Never claims system execution."""
import argparse, csv, html, importlib.util, json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('tracebid_engine', HERE / 'lib/engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

def csv_text(value):
    # Avoid activating formulas when a buyer opens untrusted dossier text in a spreadsheet.
    return '\'' + value if value.lstrip().startswith(('=', '+', '-', '@')) else value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dossier', required=True, help='JSON dossier; page paths are relative to its directory')
    parser.add_argument('--out', required=True, help='New output directory; never overwrites')
    args = parser.parse_args()
    try:
        source = pathlib.Path(args.dossier).resolve(strict=True)
        destination = pathlib.Path(args.out).resolve()
        if destination.exists():
            raise engine.ValidationError('Output directory exists; choose a new path')
        dossier = engine.load_dossier(source.name, root=source.parent)
        analysis = engine.analyze(dossier)
        analysis['execution_status'] = 'NOT_EXECUTED'
        analysis['execution_evidence'] = []
        analysis['notice'] = 'Text/hash validation and declared capabilities only. No system test or official POC approval.'
        for row in analysis['requirements']:
            row['execution_status'] = 'NOT_EXECUTED'
        # Validation is complete before output is created. Inputs remain unchanged.
        destination.mkdir(parents=True, exist_ok=False)
        (destination/'report.json').write_text(json.dumps(analysis,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        with (destination/'requirements.csv').open('w',encoding='utf-8',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=['id','statement','capability_status','execution_status','source_url','source_page'])
            writer.writeheader()
            urls={s['id']:s['url'] for s in dossier['sources']}
            for row in analysis['requirements']:
                refs=row['evidence']
                writer.writerow({'id':csv_text(row['id']),'statement':csv_text(row['statement']),'capability_status':row['capability_status'],'execution_status':'NOT_EXECUTED','source_url':'; '.join(urls[x['source_id']] for x in refs),'source_page':'; '.join(str(x['page']) for x in refs)})
        content=html.escape(json.dumps(analysis,ensure_ascii=False,indent=2))
        page='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TraceBid — relatório local</title><style>body{max-width:1000px;margin:40px auto;padding:20px;font-family:system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f3f8;padding:20px}strong{color:#9c4b00}</style><h1>Rastreabilidade do dossiê</h1><p><strong>NÃO EXECUTADO:</strong> este relatório valida texto e hashes. Declaração de capacidade não é prova de produto.</p><p><a href="report.json" download>JSON</a> · <a href="requirements.csv" download>CSV</a></p><pre>'+content+'</pre></html>'
        (destination/'index.html').write_text(page,encoding='utf-8')
        print(json.dumps({'status':'generated','execution_status':'NOT_EXECUTED','requirements':len(analysis['requirements']),'output':str(destination)}))
        return 0
    except (engine.ValidationError,OSError,ValueError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr)
        return 2

if __name__=='__main__':
    sys.exit(main())
