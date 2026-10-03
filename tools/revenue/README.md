# Conferência local de faturamento por uso

Produto gratuito de conferência para um fechamento **linear**. Abra `index.html` por um servidor estático ou pelo portal AVS Labs. Arquivos são processados em memória no navegador, sem API, upload, armazenamento persistente ou integração com plataformas de cobrança. A conexão HTTPS ao host estático continua sujeita aos registros do provedor; os textos das entradas não são enviados pela aplicação.

1. Explore a demonstração explicitamente fictícia ou preencha o formulário de contrato e fatura. O modo avançado continua abrindo/colando os três JSONs normalizados.
2. Informe cliente opaco comum aos documentos, moedas separadas, períodos UTC do contrato e da fatura, corte e preços constantes. A cópia do período exige uma ação explícita; não há conversão de fuso.
3. Abra/cole um CSV de eventos já normalizados e confira a prévia. Declare a situação de completude do export e das linhas da fatura separadamente. Não preencha campos inexistentes apenas para desbloquear o cálculo.
4. Prepare/baixe os três JSONs ou confira diretamente. Veja quantidade e valor por medidor; revise avisos e bloqueios.
5. Baixe o relatório JSON, CSV ou HTML. Os hashes SHA-256 identificam textos, sem atestar autenticidade. Aceite externo não observado.

Não importa exports brutos do Stripe/Orb/Metronome automaticamente. Os templates em `package/input-template/` são incompletos de propósito. Exemplos `examples/demo-*.json` são somente fictícios.

## Preparação sem escrever schemas JSON

O formulário prepara as entradas do **mesmo motor linear existente**. Não integra o importador privado produzido pelo Grok, nem infere `complete:true`. Não grava faturas ou ajusta sistemas financeiros.

- Medidores e linhas de fatura são adicionados/removidos no formulário; IDs, unidades, preços, quantidades e valores permanecem textos fornecidos. Números decimais nunca passam por `Number`/ponto flutuante.
- O cabeçalho CSV vazio baixado é `event_id,meter_id,unit,kind,quantity,occurred_at,received_at,reverses`. A ordem pode mudar, mas exige exatamente esse conjunto, sem campos extras ou duplicados.
- CSV aceita LF/CRLF, células com aspas e um BOM UTF-8 inicial (remoção indicada na prévia/preparação). Recusa aspas abertas, caracteres após aspas fechadas, colunas faltantes/extras, linhas vazias internas e CR isolado. É um formato delimitado por vírgula; não aceita um export genérico ou CSV separado por ponto e vírgula automaticamente.
- Cada campo CSV tem no máximo 4.096 caracteres, além dos limites de ID/decimal/data. São até 2 MB UTF-8 e 10 mil eventos. São limites deste adaptador, não alegação de compatibilidade com todos os exports.
- Cada JSON gerado também precisa caber em 2 MB. O adaptador remove apenas espaços de formatação se necessário; se ainda exceder, recusa a preparação inteira sem descartar registros. Um CSV abaixo de 2 MB pode produzir JSON maior devido aos nomes dos campos.
- `usage` exige `reverses` vazio, que vira `null` conforme o schema existente; `refund` exige referência explícita. Não cria IDs, unidades, horários de recebimento ou referências de estorno.
- Situação de completude começa em **não sei**. “Não sei” e “incompleto” exportam `complete:false` e recusam comparação monetária. Somente a declaração explícita “completo” gera `true`; isso continua sem comprovação externa. O relatório distingue as declarações; os JSONs de entrada preservam apenas o booleano do schema existente.
- Contrato e fatura têm moedas/períodos próprios. Datas ou moedas divergentes continuam recusadas pelo motor. Remover todas as linhas de fatura e declarar completude é informar zero, não evidência independente de ausência de faturamento.
- A prévia valida os registros e mostra os primeiros dez, sem avaliar completude. Preparação falha de forma integral diante de erro de CSV; nenhum subconjunto válido é importado silenciosamente.
- Os modos formulário e JSON são independentes. Alterar o formulário invalida o resultado e desabilita baixar entradas até nova preparação. Mudanças em eventos, fatura ou contrato devolvem as declarações afetadas a “não sei”, exigindo reafirmação para a base nova; importar outro CSV também exige selecionar sua classe novamente. No modo avançado, os textos JSON são a fonte da conferência. Nenhum campo ausente é reconstruído de um arquivo raw.

## Regras e recusas

- Até 31 dias, 100 medidores, 10 mil eventos, 100 linhas; até 2 MB por texto/arquivo.
- Preço constante linear por unidade; arredondamento half-up **por total de medidor**.
- Decimais de entrada são strings sem sinal/notação científica, até 12 dígitos inteiros e seis casas; valor faturado tem exatamente duas casas. Internamente usa coeficientes `BigInt`, sem ponto flutuante para dinheiro.
- Período [início, fim), fim excluído; ocorrência não pode vir depois do recebimento. Data inexistente é inválida.
- Repetição idêntica de ID é deduplicada com aviso; conteúdo conflitante bloqueia tudo.
- Estornos apenas referenciam uso elegível anterior, do mesmo medidor, sem exceder a quantidade original.
- Medidor/unidade desconhecido, atraso após corte, referências inválidas ou exports incompletos: nenhuma comparação monetária.
- Ausência de linha de um medidor é zero **informado**, não comprovação independente de que nada foi faturado.
- Sem faixas, alteração de preços no período, franquia, descontos, impostos, créditos gerais ou conversão cambial.
- Diferença = esperado − faturado: candidato à revisão; não é receita recuperada, ordem de cobrança ou correção automática.
- Completude é declaração do usuário; não é autenticada. Não é auditoria contábil certificada.
- Textos CSV de IDs/unidades que comecem com `=`, `+`, `-` ou `@` recebem prefixo de neutralização; valores monetários negativos preservam sinal.
- JSON com chaves duplicadas, tokens numéricos decimais/exponenciais, profundidade >50 ou bytes >2 MB é recusado. Essa restrição de profundidade é adicional ao Python.
- Navegador precisa suportar módulos, BigInt, Blob/TextDecoder e Web Crypto para hashes. A ausência de hash é reportada; não torna a entrada autêntica.

## Conferência técnica

`package/reconcile.py` e `package/delivery.py` existentes foram preservados. O navegador recalcula em JavaScript; não invoca o Python nem comprova equivalência universal.

```sh
node test-reconcile.mjs
node --test test-guided.mjs
```

A suíte confronta 25 casos sintéticos com `package/reconcile.py` via `python3`: arredondamento, escala decimal, valores grandes, estornos, duplicação, corte, período, unidades, medidores e contratos recusados. Verifica também limite de 31 dias, parser restrito, calendário e totais. O motor Python original admite até 366 dias; este recorte mantém os 31 dias do adaptador de entrega. Compatibilidade é demonstrada somente nos casos enumerados, não em toda entrada possível.

`test-guided.mjs` tem 27 testes focados na preparação: preservação de schemas/decimais, seis cenários confrontados com o Python original, estados de completude desconhecida/incompleta, datas/moedas independentes, estornos, parsing estrito, limites físicos de 10.000/10.001 registros, tamanho, campos e limite dos JSONs gerados. São testes puros do adaptador; não equivalem a execução do fluxo visual, autenticação de arquivos ou auditoria contábil.

Sem comprador, pagamento, aceite, vantagem exclusiva, economia ou autonomia comercial demonstrados pela suíte.

## Trilha por evento e dossiê para retomar

O relatório v2 explica as linhas de cada medidor: ID do evento, uso/estorno, referência ao uso original, quantidade decimal original, horários UTC e motivo de inclusão/exclusão. Filtre por medidor ou busque IDs/referências; a tela pagina cem linhas por vez. A trilha usa as conclusões do motor existente, sem outro cálculo de faturamento. Não há valor por evento: arredondamento permanece por total de medidor. Se a base está bloqueada, nenhum evento recebe contribuição final; erros de esquema impedem até a classificação. Uma repetição idêntica é mostrada sem segunda contribuição.

O HTML portátil reúne comparação, bloqueios, detalhes por medidor e relatório completo, com conteúdo escapado e sem scripts/conexões remotas. Os IDs e arquivos contêm dados declarados: remova informação sensível antes de compartilhar.

“Baixar dossiê para retomar” salva `format: avs-usage-dossier`, `version: 1`, `report_version: 2`, com os três textos JSON **exatos** e o relatório arquivado. Limite agregado de dois MB; quando excedido, preserve entradas e relatório individualmente — nada é truncado. “Retomar dossiê” lê sem substituir imediatamente a página; exige confirmar a troca. Uma edição enquanto a leitura/retomada está pendente cancela esse candidato. O relatório anterior é ignorado para o cálculo e a conferência precisa ser acionada novamente. `complete:false` permanece falso; `complete:true` continua sendo declaração original, não validação externa. O parser restringe envelope, versões, campos e JSON duplicado; não comprova autenticidade do documento.

Conferência finita: `node --test tools/revenue/test-dossier.mjs`, dez testes sobre inclusão/estorno, duplicação, corte, esquema incompleto, referências, retomada fiel, falsificação de resultado arquivado, limites e XSS. Não substitui teste visual do navegador ou auditoria de dados reais. O motor `reconcile.mjs` e o pacote Python não foram alterados nesta ampliação.
