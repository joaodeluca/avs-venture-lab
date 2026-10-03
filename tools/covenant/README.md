# Covenant — diagnóstico assistivo de critérios de aceite

Abra `index.html` em um servidor estático. Não há backend, API, telemetria, persistência ou transmissão das entradas. O download de JSON depende de ação do usuário. Use somente exemplos públicos, fictícios ou sanitizados; ninguém deve enviar segredos ou dados pessoais para demonstrar o fluxo.

A interface separa recibo/status de observação do efeito. `UNKNOWN` permanece quando só existe status, timeout, observação fora de janela ou contexto incompatível. As comparações são igualdade escalar exata, em até cinco critérios e vinte observações. Datas exigem calendário válido, segundos e fuso explícito; aceitam até três casas decimais, offsets de até ±14:00 e não aceitam leap second. Campo/fonte/principal/momento são fornecidos pelo usuário; a ferramenta não autentica esses dados. `OBSERVED_MATCH` não significa sucesso confirmado, causa demonstrada ou elegibilidade para pagamento.

Amostras sintéticas explicam uma falha histórica real do mecanismo anterior: recibos idênticos podiam coexistir com intenções opostas porque o kernel via apenas a mudança de status. Esta ferramenta não aumenta o kernel nem conserta um oráculo externo. Não oferece rede de agentes, garantia, certificado ou superioridade sobre avaliação direta. Não há contratação ou recebimento habilitado.

Fontes de desenho: [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [Temporal](https://temporal.io/blog/idempotency-and-durable-execution). São documentação pertinente, não provas de demanda.

Os exemplos internos são ilustrações de diagnóstico, não experimento comercial nem novos casos de clientes.

## Leitura local de sua entrega

Em [readback.html](readback.html), prepare um contrato de FAQ (1–5 respostas), selecione contrato, referência e arquivo entregue e confira os bytes nesta aba. Há relatório JSON/HTML por download explícito. A conferência mostra igualdade exata, vínculo de tarefa/token e SHA-256, mantendo autenticidade, janela do filesystem e causalidade desconhecidas. Leia [formatos e limites](readback-README.md). O ensaio Python histórico permanece separado e preservado.

## Contrato de entrega para JSON ou texto

Em [delivery-contract.html](delivery-contract.html), fixe até cinco critérios literais antes da tarefa e depois confira um arquivo UTF-8 de até 1 MiB: hash esperado, trecho exato, caminho JSON obrigatório e escalar exato. O contrato pode ser salvo/retomado e produz instruções e relatórios locais. Sem execução ou upload, sem aprender esperados da entrega. Confira [formatos e limites](delivery-contract-README.md). Correspondência permanece restrita aos critérios declarados; origem, identidade, cronologia e causalidade continuam desconhecidas. O checker FAQ permanece separado.
