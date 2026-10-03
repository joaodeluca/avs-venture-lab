# Preparação local de três fontes

Abra intake.html pelo site ou por um servidor HTTP local na raiz deste repositório. O fluxo usa os instrumentos lineares existentes, sem o importador privado experimental.

1. Carregue três CSV UTF-8: tabela de preços, registro de eventos e linhas de fatura. Selecione o delimitador de cada fonte. Contratos PDF ou regras textuais não são interpretados.
2. Relacione explicitamente cada campo às colunas originais. Declare separador decimal, período UTC em segundos, moeda, cliente opaco e alcance das fontes. Nada confirma completude automaticamente. A equipe que prepara um fechamento precisa conferir esses fatos contra os documentos originais.
3. Gere a conferência e revise divergências ou motivos de bloqueio. Baixe o relatório e o pacote local com originais, hashes, mapeamentos e entradas preparadas.

A tabela de preços não autentica o contrato. Datas, tipos, unidades e referências não são adivinhados. Colunas não usadas continuam nos originais e são listadas na auditoria de preparação. Vírgula decimal é conversão explícita; não há arredondamento de valores de fatura ou tratamento de separadores de milhares.

Limites: 2.000.000 bytes por CSV, 4.096 caracteres por campo, 100 colunas e 10.000 eventos; contrato e fatura até100 linhas, período até31dias. Há limites adicionais nas entradas normalizadas e no pacote, informados antes de exportar. Entradas incompatíveis ou desconhecidas impedem conclusão monetária.

Processamento no navegador, sem envio ou persistência própria. O pacote baixado contém os arquivos selecionados e deve ser tratado com a mesma confidencialidade. Nenhum dado de usuário é enviado ao repositório ou a bots. SHA-256 identifica os bytes, não comprova origem, autenticidade, completude ou aceite.

Demonstração usa apenas dados fictícios. Ferramenta local e pipeline técnico não demonstram economia, recuperação de receita, atendimento comercial ou venda. Contratação permanece indisponível.

A troca de eventos/fatura ou de seus separadores/mapeamentos devolve a respectiva declaração de completude a desconhecida. O resultado anterior é invalidado. O botão de demonstração usa colunas conhecidas dos CSV fictícios produzidos localmente, sem inferir o mapeamento de arquivos fornecidos.

## Conferir o pacote fora do navegador

Baixe e extraia `downloads/v03-intake-verifier.zip`. Com Node moderno (conferido em Node 24):

```sh
node verify-intake-package.mjs /caminho/fechamento-pacote-local.json
```

O verificador confere bytes, base64 e hashes, normaliza novamente os três originais, confronta os dados normalizados arquivados e recalcula a comparação. O relatório e o HTML arquivados são ignorados para o cálculo. Recusa mudanças em fontes, auditoria ou dados normalizados. Uma saída pode continuar `blocked` se a completude estiver desconhecida. Não autentica a fonte, não prova completude, aceite ou resultado econômico. Não envia dados nem grava arquivos: imprime JSON recalculado em stdout. O pacote local recebido pode conter dados privados; mantenha-o fora do Git.

O envelope do verificador usa JSON.parse padrão: não detecta chaves duplicadas e prevalece a última ocorrência. Um autor que reconstrua fontes, hashes, auditoria e normalizados de modo consistente pode criar um pacote aceito. A conferência é de integridade/recomputação, não autenticação contra um autor malicioso.
