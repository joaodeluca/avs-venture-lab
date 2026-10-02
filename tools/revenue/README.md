# Conferência local de faturamento por uso

Produto gratuito de conferência para um fechamento **linear**. Abra `index.html` por um servidor estático ou pelo portal AVS Labs. Arquivos são processados em memória no navegador, sem API, upload, armazenamento persistente ou integração com plataformas de cobrança. A conexão HTTPS ao host estático continua sujeita aos registros do provedor; os textos das entradas não são enviados pela aplicação.

1. Explore a demonstração explicitamente fictícia ou abra/cole três JSONs normalizados.
2. Declare cliente opaco, moeda, período UTC e corte, preços constantes, eventos completos e linhas completas de fatura.
3. Confira quantidade e valor por medidor; revise avisos e bloqueios.
4. Baixe JSON, CSV ou HTML. Os hashes SHA-256 identificam textos, sem atestar autenticidade. Aceite externo não observado.

Não importa exports brutos do Stripe/Orb/Metronome automaticamente. Os templates em `package/input-template/` são incompletos de propósito. Exemplos `examples/demo-*.json` são somente fictícios.

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
```

A suíte confronta 25 casos sintéticos com `package/reconcile.py` via `python3`: arredondamento, escala decimal, valores grandes, estornos, duplicação, corte, período, unidades, medidores e contratos recusados. Verifica também limite de 31 dias, parser restrito, calendário e totais. O motor Python original admite até 366 dias; este recorte mantém os 31 dias do adaptador de entrega. Compatibilidade é demonstrada somente nos casos enumerados, não em toda entrada possível.

Sem comprador, pagamento, aceite, vantagem exclusiva, economia ou autonomia comercial demonstrados pela suíte.
