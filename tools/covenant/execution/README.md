# Covenant: o agente disse “feito”. O arquivo existe e cumpre o combinado?

Este pacote executa uma tarefa pequena de ponta a ponta: produzir uma FAQ de uma loja **fictícia**, salvar o arquivo e conferir seu conteúdo a partir de uma referência fixa. O verificador não usa o recibo do trabalhador para aprovar a entrega; abre o arquivo real, calcula seu hash e confere as três respostas.

É um laboratório local gratuito, sem contas ou dependências adicionais. Python 3.9+ e sistema POSIX (macOS/Linux). Sem rede, telemetria, execução de prompts, comandos arbitrários, cobrança ou contratação. Windows não foi testado. Os arquivos de entrada e diretório do operador são confiáveis neste laboratório.

## Execute a entrega

Na pasta descompactada, escolha um diretório que ainda não exista:

```sh
python3 covenant.py init --contract task-contract.json --source synthetic-source.json --workspace ./faq-run
python3 covenant.py verify --workspace ./faq-run
```

A primeira conferência deve retornar `REJECTED / FILE_ABSENT`, com código de saída 2. Ela lê o contexto fixado pelo operador, mas não encontrou a entrega.

```sh
python3 covenant.py produce --workspace ./faq-run
python3 covenant.py verify --workspace ./faq-run
```

Agora `faq-run/faq.json` contém a FAQ produzida. O segundo comando abre esse arquivo e exige:

- JSON regular, de até 64 KiB, sem symlink e sem chaves duplicadas;
- identificação da tarefa e token desta execução, referência fixada por SHA-256;
- arquivo criado na janela local de cinco minutos;
- título, três perguntas, três identificadores únicos e respostas exatamente iguais à referência;
- ausência de resposta extra, faltante ou contraditória.

Se tudo corresponder, retorna `LOCAL_ARTIFACT_MATCH`. O recibo `worker-receipt.json` pode dizer qualquer coisa; não participa da decisão. `produce` é apenas um exemplo determinístico de trabalhador, **não um LLM nem um agente remoto**. Outro trabalhador pode escrever a mesma entrega em `faq.json`; o verificador continua separado.

Para conferir uma saída externa, prepare a pasta com `init`, entregue ao trabalhador somente o contrato e a fonte necessários, peça o arquivo esperado e execute `verify`. **Não execute scripts recebidos de outro agente.** A leitura independente se refere aos bytes deste diretório controlado; não a uma entidade ou máquina independente.

## Veja os controles adversos

```sh
python3 replay.py --output ./controls-run
python3 -m unittest -v test_covenant.py
```

O replay executa 14 casos reais em diretórios locais separados. Conserva os arquivos, os relatórios antes/depois e `RESULTS.md`. Diretório existente é recusado. O positivo deve corresponder; os demais devem ser recusados: recibo sem arquivo, JSON corrompido, resposta errada, referência errada, outra tarefa, token de execução antiga, data de arquivo anterior, resposta duplicada, symlink, fonte alterada, arquivo grande, resposta faltante e janela expirada. O caso de expiração altera deliberadamente os metadados locais; não espera cinco minutos nem testa relógios distribuídos.

Há uma amostra de **execução já realizada** em `example-evidence/`. Os hashes identificam os bytes observados nesse ensaio; uma nova execução terá outro token e outros hashes.

## O que a decisão significa

`LOCAL_ARTIFACT_MATCH` significa que o verificador leu uma entrega do laboratório e ela correspondeu ao contrato e à referência que o operador forneceu. Uma resposta pode reproduzir exatamente uma referência falsa: igualdade não prova verdade.

Isso não é um oráculo universal, uma certificação, prova de identidade do agente, sandbox contra processos maliciosos, causalidade, utilidade para cliente, aceite comercial nem autorização de pagamento. Um processo com permissão para alterar o contexto do operador pode modificar os registros locais. Contrato, referência e sistema de arquivos são a fronteira de confiança, não um mecanismo criptográfico de atestação remota.

A contraprova histórica continua válida: um status ou recibo correto pode coexistir com uma intenção não satisfeita. Este pacote reduz uma falha específica — aceitar “feito” sem ler a entrega — em uma tarefa finita e controlada. Não demonstra vantagem sobre um verificador direto competente, demanda de mercado ou operação autônoma de uma empresa.

Código original deste laboratório, disponibilizado sob MIT. Nenhum arquivo de cliente, transcrição, credencial ou fonte upstream foi incluído.
