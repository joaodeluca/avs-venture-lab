# Covenant — conferir arquivos selecionados no navegador

Abra `readback.html` no laboratório publicado ou em um servidor estático local. A interface não faz upload das entradas, não tem backend, armazenamento persistente ou telemetria. `fetch` é usado somente no botão do exemplo fictício, com três caminhos públicos fixos. Arquivos escolhidos pelo operador são lidos via `File.arrayBuffer()` nesta aba. Nada recebido é executado como código ou instrução.

## Uma tarefa que esta ferramenta consegue conferir

Uma FAQ em JSON, com **uma a cinco perguntas e respostas exatas**, não a qualidade semântica de qualquer texto. O operador combina as perguntas e uma referência confiável antes de pedir a produção. Depois seleciona o contrato, a fonte e os bytes da FAQ entregue. O checker compara SHA-256 da fonte, identificador da tarefa, token esperado, título, quantidade de respostas, identificadores únicos, perguntas e respostas.

O botão **Preparar um contrato** gera critérios e fonte, não a entrega. Ele cria um token aleatório de 24 bytes; cada novo preparo tem um novo token. Baixe contrato, referência e instruções, forneça-os a um trabalhador separado e peça apenas o JSON produzido. Volte à página para selecionar o arquivo. Não execute código do trabalhador.

Preparar a referência a partir da própria entrega seria circular. O operador decide e confia na referência. Qualquer pessoa com acesso ao token e à fonte consegue gerar uma saída correspondente; isso não identifica um agente nem prova que houve trabalho externo.

## Formatos aceitos

Contrato browser novo:

```json
{
  "schema": "covenant-browser-faq-contract-v1",
  "task_id": "FAQ-001",
  "expected_title": "FAQ de exemplo",
  "run_token": "token-fixado-antes-da-tarefa",
  "source_sha256": "SHA-256 hexadecimal de 64 caracteres dos bytes exatos da fonte",
  "questions": [{"id": "delivery", "question": "Qual é o prazo?"}]
}
```

`expected_artifact_sha256` é opcional: se um hash esperado foi obtido independentemente e fixado no contrato, ele também é comparado aos bytes da entrega. Esse hash continua sendo fornecido pelo operador, não uma assinatura autenticada. Sem o campo, o relatório calcula o hash observado da entrega para identificar o arquivo que foi conferido; não inventa um esperado a partir da própria saída.

Referência:

```json
{"schema":"covenant-faq-reference-v1","facts":{"delivery":"Quatro dias úteis."}}
```

Entrega:

```json
{
  "schema":"covenant-faq-artifact-v1",
  "task_id":"FAQ-001",
  "run_token":"token-fixado-antes-da-tarefa",
  "source_sha256":"mesmo hash fixado no contrato",
  "title":"FAQ de exemplo",
  "answers":[{"id":"delivery","question":"Qual é o prazo?","answer":"Quatro dias úteis."}]
}
```

Esses snippets explicam o formato; os placeholders de hash são inválidos. A preparação na interface gera hashes reais. Identificadores exigem letras ou números no primeiro caractere, depois letras, números, ponto, hífen ou sublinhado, até 80 caracteres. Perguntas/respostas de referência têm até 8.192 caracteres; título até 1.024; token até 128. O contrato suporta um a cinco IDs distintos. Não há equivalência por paráfrase, normalização ou tolerância a espaços.

O contrato Python histórico `covenant-faq-contract-v1` e a fonte `covenant-synthetic-facts-v1` também são aceitos. O título permanece o específico daquele ensaio. Seu token esperado vem do `run.json` previamente fixado, informado separadamente. Sem token esperado, a conferência de conteúdo pode retornar `PARTIAL_MATCH`; não assume vínculo de execução. Essa compatibilidade não reproduz a verificação do filesystem ou a janela de cinco minutos de `covenant.py`.

## Decisão e fronteira de confiança

- `CONTENT_MATCH`: todos os critérios de conteúdo/vínculo suportados correspondem às entradas locais.
- `PARTIAL_MATCH`: os critérios comparáveis correspondem, mas falta um vínculo esperado, como o token no contrato legado.
- `REJECTED`: existe divergência conhecida, JSON inválido, chave duplicada, entrada fora do limite ou contrato malformado.
- `UNKNOWN`: faltam arquivos, formato não suportado ou a comparação não está disponível. Uma divergência já conhecida não é apagada por um campo adicional não suportado.

Os resultados incluem sempre `verification_complete:false`, `receipt_used_as_evidence:false`, `external_production_verified:false`, `causal_attribution_verified:false` e `payment_eligible:false`. Campos ou recibos como `verified:true`, `claim:"done"` e `payment_eligible:true` na entrada não alteram essas conclusões.

O browser **não prova** ausência inicial, caminho do arquivo, symlink, persistência, criação dentro de uma janela, relógio confiável, autenticidade da fonte, identidade do produtor ou causa de um efeito remoto. `File.lastModified` e nomes de arquivos não decidem aceite. Não é uma certificação, oráculo geral, aceite comercial ou autorização de pagamento.

## Bytes, concorrência e privacidade

Cada arquivo deve ter até **65.536 bytes (64 KiB)**, UTF-8 sem BOM, JSON objeto, sem chaves duplicadas e com profundidade de até 32 níveis. O limite é aplicado aos bytes reais. A comparação usa snapshots dos bytes antes de calcular hashes; modificar o buffer ou trocar uma seleção durante uma conferência não promove o relatório antigo. Chaves parecidas com propriedades do JavaScript são dados em objetos sem protótipo. Conteúdo aparece via `textContent`; o HTML de download escapa o JSON, não insere conteúdo como markup.

Dados permanecem na memória da aba; limpar/recarregar descarta a seleção. Os downloads requerem clique e **incluem as perguntas e respostas comparadas**, limites, checks e hashes. Não incluem os arquivos integrais, campos extras ou nomes locais. Respostas observadas muito longas têm visualização limitada a 8.192 caracteres com indicação; a igualdade usa o valor integral. Não compartilhe um relatório cujo conteúdo não possa ser divulgado. Não há salvamento automático.

## Verificação técnica finita

```sh
node --test tools/covenant/test-readback.mjs
```

Suite nova cobre leitura válida, arquivo ausente, recibo enganoso, resposta divergente, respostas repetidas/extra/faltante, tarefa/token/título/pergunta/fonte divergentes, alteração só de espaços na fonte, hash externo de artefato, contrato legado sem/com token, formatos não suportados, preservação de divergência já conhecida, limites exatos de 64 KiB/+1 em três papéis, JSON malformado/duplicado/profundo, UTF-8 inválido, chaves de protótipo, IDs de caminho, limitação de visualização, snapshot durante hashing e preparo com 1–5 perguntas. Esses controles são sintéticos locais, não validação comercial, sandbox universal ou prova de execução na nuvem.

O ensaio Python original e seus controles são preservados em `execution/`. Não somar suas contagens à suite nova nem interpretar a verificação como avanço de vendas.
