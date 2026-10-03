# Covenant — Contrato de entrega

[Abra o workspace](delivery-contract.html) em um servidor estático HTTP/HTTPS (Web Crypto exige contexto seguro, incluindo localhost). Esta ferramenta é separada do checker de FAQ `readback.html` e do ensaio Python. Nenhum motor anterior foi substituído.

## Fluxo

1. Especifique até cinco critérios a partir de uma referência independente, antes de solicitar a entrega.
2. Fixe o contrato, baixe o JSON e as instruções e forneça-os ao trabalhador. Critérios ficam bloqueados nesta sessão. O programa não gera os esperados a partir do arquivo entregue.
3. Selecione um arquivo UTF-8 de até 1 MiB e confira os critérios. Downloads JSON e HTML exigem ação explícita. Importar um contrato válido limpa a entrega e o resultado antigos. Uma importação inválida preserva o contrato e invalida o relatório, permitindo nova conferência.

Não há upload, API, backend, armazenamento automático, execução de código, regex ou instruções recebidas. Use conteúdo público, fictício ou sanitizado. A seleção de arquivos não autoriza uso de seu conteúdo fora desta aba. O relatório não inclui o nome nem o conteúdo integral do arquivo. Contrato/instruções incluem valores esperados; relatório inclui tarefa, nomes dos critérios e hashes. Compartilhe somente conteúdo permitido.

## Critérios suportados

- `sha256`: hash esperado externo, 64 caracteres hexadecimais minúsculos. Compara os bytes originais selecionados. BOM, espaços e quebras de linha fazem parte do hash. Nunca aprende o hash esperado da entrega.
- `contains`: contém trecho literal exato de 1 a 8.192 caracteres. Espaços, maiúsculas e acentos são significativos. A presença não prova significado ou completude.
- `json_exists`: caminho literal presente, inclusive se seu valor é `null`.
- `json_equal`: valor escalar no caminho é idêntico ao esperado, sem coerção. Esperados suportados: string de até 4.096 caracteres, booleano, `null` ou inteiro seguro. Não compara objetos/arrays.

Subconjunto de JSON Pointer: começa com `/`; até 20 segmentos, 256 caracteres codificados por segmento e 2.048 caracteres totais. `~1` representa `/`, `~0` representa `~`; escapes diferentes são recusados. Arrays exigem índices decimais sem zeros à esquerda (`0`, `1`, ...). Não há coringas/filtros; `*` seria apenas uma chave literal. Segmentos `__proto__`, `constructor` e `prototype` são recusados. Não há acesso a prototype ou alteração do objeto.

## Contrato versionado

Somente campos previstos são aceitos. Identificador de tarefa: 1–80 caracteres, letras/números/ponto/hífen/sublinhado, iniciando com letra/número. Título e nomes: 1–256 caracteres. Critérios: 1–5, IDs únicos `C1` a `C5`.

```json
{
  "schema": "covenant-delivery-contract-v1",
  "task_id": "EXEMPLO-001",
  "title": "Meu arquivo de status",
  "criteria": [
    {"id": "C1", "label": "Status combinado", "kind": "json_equal", "pointer": "/status", "expected": "done"},
    {"id": "C2", "label": "Campo obrigatório", "kind": "json_exists", "pointer": "/items/0/name"}
  ]
}
```

Contrato UTF-8: até 64 KiB; arquivo entregue UTF-8: até 1 MiB (1.048.576 bytes). JSON deve ser sem BOM, sem chaves duplicadas, até 32 níveis e 50.000 valores. Objetos são analisados sem prototype. O parser rejeita números decimais/expoentes, zero negativo e inteiros fora de `-9007199254740991` a `9007199254740991`, inclusive quando estejam em campos não consultados. Isso evita alegar igualdade após arredondamento. Valores decimais podem ser representados explicitamente como strings em um contrato apropriado; o checker não normaliza números financeiros.

## Conclusões

Cada critério é `PASS`, `FAIL` ou `UNKNOWN`. Arquivo ausente ou JSON não legível mantém critérios JSON `UNKNOWN`. Outros critérios literais ainda podem ser avaliados. Qualquer `FAIL` produz `CRITERIA_MISMATCH`; sem falha mas com desconhecido, `UNDETERMINED`; todos os critérios finitos satisfazendo, `CRITERIA_MATCH`. Erros gerais de entrada mantêm `UNDETERMINED`, sem alegar avaliação.

Todas as conclusões conservam `verification_complete:false` e `payment_eligible:false`. Autenticidade da referência, identidade do produtor, cronologia do contrato, criação recente, persistência, produção externa e efeito causal são `UNKNOWN`. Nada autentica que o operador fixou o contrato antes da entrega. Correspondência de cinco critérios não prova requisitos ausentes, verdade universal, superioridade, utilidade comercial, execução pelo agente ou aceite/pagamento. Hash não é assinatura. Não há dados de clientes nem vendas verificadas neste laboratório.

## Verificação técnica

Execute `node --test tools/covenant/test-delivery-contract.mjs`. A suíte finita cobre critérios positivos/negativos, ausência de arquivo, hashes dos bytes, BOM/whitespace, JSON Pointer, array, null, coerção, duplicatas, JSON inválido, números inseguros/precisão, prototype, contratos, limites físicos, profundidade/contagem, snapshots durante hashing e HTML escapado. Isso não substitui validação de negócio ou execução externa.
