# Usar um trabalhador separado

Este é um roteiro para uma tarefa **sintética** de produção de arquivo, não uma autorização para contratos ou operações externas. O laboratório não aciona modelo/API automaticamente e não instala conectores.

1. O operador executa `init` em uma pasta nova.
2. Copia **somente** o contrato e a fonte sintéticos deste pacote, mais `token` do `run.json` recém-criado. Não envia o diretório, outros arquivos, dados de cliente ou credenciais. O token é um identificador deste teste, sem poder de acesso a serviço.
3. Pede ao trabalhador a saída JSON abaixo. O trabalhador não precisa de rede, ferramentas, memória privada ou código executável.
4. Salva exclusivamente o JSON de resposta no `artifact_file` previsto, dentro da pasta criada pelo operador. Não executa código recebido nem usa caminhos sugeridos na resposta.
5. Executa `verify` antes do prazo local de cinco minutos. Caso o prazo expire, o resultado é recusa; criar outro ensaio não deve apagar o anterior nem reclassificá-lo como sucesso.

```text
Tarefa sintética Covenant. Não use conectores, ferramentas externas ou memórias.
Produza apenas JSON, sem Markdown ou recibo de conclusão, com:
- schema: covenant-faq-artifact-v1
- task_id: o task_id do contrato abaixo
- run_token: TOKEN_DO_RUN_RECÉM_CRIADO
- source_sha256: o source_sha256 do contrato abaixo
- title: FAQ — Loja Aurora Fictícia
- answers: uma entrada para cada pergunta do contrato, com id, question e answer.
Copie as respostas exatamente dos facts da fonte; não invente dados.
Isto é um teste de arquivo local com referência sintética, não conteúdo real para clientes.

CONTRATO: [colar task-contract.json deste pacote]
FONTE: [colar synthetic-source.json deste pacote]
```

A resposta ainda não é sucesso. Quem decide a correspondência é a leitura dos bytes gravados pelo verificador. Uma falha deve permanecer documentada. Uma correspondência também não prova qualidade semântica geral, demanda ou utilidade comercial.
