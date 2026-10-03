# Catálogo local — seu lote, sem completar lacunas por inferência

Abra `index.html`. A amostra inicial contém oito registros públicos documentais; não é lote ou aceite de cliente. A página agora aceita CSV e JSON locais, permite buscar código/ID/descrição, comparar dois registros e gerar uma fila por fabricante + código exatamente como escritos. Não consulta fontes, faz OCR, interpreta PDF, aprova compra, substituição ou mesclagem.

## Importar

Baixe “modelo CSV sintético” na página ou use cabeçalho canônico: `row_id,manufacturer,manufacturer_item_number_original,positions,pitch_mm,housing_color_pt,connection_method_pt,locking_mechanism_pt,mounting_method_pt,packing_quantity,designation_original,source_url,source_locator,consulted_on`.

Escolha vírgula ou ponto e vírgula antes de importar; não há autodetecção. CSV UTF-8 com BOM opcional, aspas escapadas `""` e linhas dentro de célula com aspas são aceitos. Coluna `row_id` e IDs únicos são obrigatórios. Códigos continuam texto, incluindo `000123`; espaços não são normalizados para tentar identificar equivalência. Posições/embalagem exigem inteiros positivos; passo exige número positivo com ponto decimal. Valores negativos, zero ou vírgula decimal são recusados, sem conversão silenciosa. Células vazias e campos de identidade ausentes são desconhecidos, nunca correspondência. A ferramenta não deduz fabricante/código da descrição.

Cabeçalhos extras são conservados por registro em `csv_extra_fields`, ficam fora da comparação e aparecem no aviso de importação. JSON conserva os metadados originais. Fontes são declarações: só URLs HTTPS sem credenciais são mostradas como links, sem abrir automaticamente ou autenticar origem. A comparação cobre somente os nove atributos visíveis, não geometria, compatibilidade ou completude de catálogo.

A fila encontra identidades repetidas e lista conflitos/ausências. “Abrir dois registros” escolhe um par em conflito quando há algum; os demais membros continuam listados, não são descartados. Valores iguais continuam simples coincidências na entrada. Nenhum registro é mesclado, atualizado ou removido automaticamente.

## Retomar e limites

“Salvar lote JSON” baixa os dados carregados para reimportação. Diagnóstico e fila são exports separados. Arquivo inválido é recusado antes de substituir o lote atual. Sem upload, armazenamento automático ou execução de fórmula; dados existem em memória e se perdem ao recarregar. Não coloque dados pessoais, cliente, export privado ou segredo no Git público/issue. O provedor de hospedagem pode registrar acessos à página.

Máximo 1 MB, 1.000 registros, 50 colunas CSV e 1.000 caracteres por célula. JSON aceita arrays `rows` com esse mesmo limite de registros; identidade não vazia tem até 200 caracteres. Este é um adaptador documental do navegador, não importador de ERP, Excel XLSX, motor de homologação ou oferta comercial.

Verificação focada: `node --test tools/catalog/test-catalog.cjs` na raiz. As entradas adversariais/sintéticas confrontam limites, ausência de identidade, aspas inválidas, códigos com zeros e conflito entre registros não iniciais. Esses testes não provam fonte autenticada, demanda ou execução em todos os navegadores.

## Workspace de revisão documental — rodada 9

O comparador agora permite transformar a fila em um pacote de revisão manual. Escolha um registro ou grupo repetido, declare a decisão (pedir documentação, manter separados ou alinhamento declarado para revisão), justificativa e referência/localização. O botão da fila abre o grupo; decisões podem ser editadas ou removidas. Revisões de grupo e linha são independentes e não têm precedência implícita. O status é declaração do operador, sem identidade, autenticação ou homologação. Os originais nunca são corrigidos, descartados ou mesclados por uma decisão.

“Salvar pacote de originais + revisões” cria formato específico `avs.catalog.review.v1` com origem declarada, registros estruturados, decisões e SHA-256 dos registros JSON canônicos. O hash vincula o lote carregado ao pacote; não autentica origem, não é assinatura, e não representa bytes do CSV bruto. O lote pode ser retomado junto às decisões, com conferência de hash e alvos. A origem é editável e declarada, não metadado autenticado. Não há histórico imutável de cada edição; exporte versões separadas se precisar preservá-las.

“Baixar relatório HTML portátil” entrega conflitos, lacunas, decisões de linha/grupo, fontes declaradas nos originais e os próprios registros. HTML escapa conteúdo, não executa scripts ou fórmulas e não carrega recursos externos. Compartilhar esse arquivo pode expor dados e referências do lote: faça-o somente quando autorizado. A apresentação de uma declaração de alinhamento não valida compatibilidade física nem autoriza compra.

Trocar o lote por CSV/JSON ou restaurar a amostra limpa revisões; uma importação inválida preserva o lote e decisões anteriores. Pacotes são limitados a 4 MB, originais a 1 MB, 1.000 registros, 2.000 decisões, justificativa 3.000 caracteres, referência 1.000, origem 500 e profundidade JSON 20. UTF-8 inválido, chaves JSON repetidas, hash incompatível, flags de aprovação/autenticação, alvos ausentes, status/campos desconhecidos e decisões duplicadas são recusados. Não há upload, armazenamento automático ou envio de referência.

Verificação: `node --test tools/catalog/test-catalog.cjs tools/catalog/test-review.cjs tools/catalog/test-review-ui.cjs`. Os 27 casos finitos incluem fidelidade dos originais, atualização/removal, troca de lote, hash, falsificação de flags/alvos, rejeição de pacote e HTML malicioso. A interface deve ser conferida separadamente no navegador; testes de módulo não provam identidade, fonte, utilidade comercial ou todos os navegadores. Três casos usam um DOM simulado para preservação/invalidação/concorrência; não constituem teste de navegador real.
