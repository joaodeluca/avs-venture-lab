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
