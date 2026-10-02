# TraceBid — relatório local a partir do seu dossiê

Código original gratuito; Python 3.10+, biblioteca padrão. Não envia dados pela rede. Não classifica ou testa automaticamente seu software.

Baixe esta pasta com `run.py`, `lib/engine.py`, `sample-dossier.json` e `source-excerpts.json`. Abra um terminal dentro dela:

```sh
python3 run.py --dossier sample-dossier.json --out meu-relatorio
```

Abra `meu-relatorio/index.html`. O pacote contém também `report.json` e `requirements.csv`. O diretório de saída deve ser novo; o programa recusa sobrescrever.

Para usar documentos seus, copie o dossiê de exemplo para uma pasta privada local. Preencha fonte, URL HTTPS, data com fuso, requisitos e âncoras curtas. `source_pages` aponta a JSON local de páginas relativo à pasta do dossiê. Os valores são texto UTF-8. O hash SHA-256 é dos bytes deste JSON, não do PDF original. Calcule:

```sh
python3 -c "import hashlib; print(hashlib.sha256(open('source-excerpts.json','rb').read()).hexdigest())"
```

Insira o hash no campo `sources[].sha256`. Cada evidência declara `source_id`, página física e citação exata que exista na página correspondente. Registre o que você tem direito de usar. Guarde documentos privados somente na sua máquina; não os coloque em issues ou no Git público.

Campos principais do dossiê: `schema_version: 1`, `id`, `sources`, `source_pages`, `requirements`, `supplier_profile`, `scope_limits`. Cada requisito tem `id`, `category`, `statement`, `status` (`supported`, `unknown`, `conflict`), `required_capability` e `evidence`. O exemplo completo contém a estrutura necessária. Capacidade `present` é mera declaração; nunca vira resultado executado neste adaptador.

Fonte histórica: [SEFAZ/MS, roteiro de POC de 2023](https://www.sefaz.ms.gov.br/wp-content/uploads/2023/05/Convocacao-e-Roteiro-da-POC.pdf), páginas físicas 2 e 3. São três requisitos previamente curados e âncoras curtas, sem PDF integral. A matriz CSV inclui quatorze procedimentos autorais propostos; todos NÃO EXECUTADOS. Parâmetros/critério devem ser acordados antes de qualquer ensaio.

Não há execução contra produto, aprovação oficial, interpretação jurídica, OCR ou cobertura integral. Uma mudança de fonte exige revisão; hash não comprova autenticidade ou suficiência. Um produto pode ter uma capacidade declarada e falhar no uso real. O arquivo não prova compra, entrega de cliente ou ganho de tempo.
