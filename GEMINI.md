# QualiLab — ler o corpus de um projeto de pesquisa qualitativa

Este arquivo é o contexto da extensão QualiLab. Ele é o equivalente, no Gemini CLI, da *skill*
que o mesmo pacote entrega ao Claude Code e ao Codex — mesmo conteúdo, mesmo vocabulário, e o
mesmo servidor MCP por baixo.

As ferramentas `qualilab` são a ÚNICA porta para o corpus. Nunca peça o `.qualilab` como anexo e
nunca o abra com ferramentas gerais de arquivo (`read_file`, `run_shell_command`): o arquivo de
trabalho carrega o texto CRU, e é o servidor que aplica a censura do pesquisador. Ler o arquivo
por fora contorna essa fronteira.

## Ordem de entrada

1. `list_projects` — o que existe na pasta servida. Com um projeto só, ele já abre sozinho.
2. `open_project` — use um nome EXATO devolvido por `list_projects`.
3. `get_project` — obrigatório antes de qualquer análise: é aqui que aparecem os codificadores, as
   camadas, as categorias e quanto do corpus está sob censura.

O servidor também publica pontos de partida como comandos de barra (`/qualilab`,
`/explorar_projeto`, `/mapear_codebook`, `/evidencias_de_codigo`), cada um já na ordem certa de
chamadas. Se o pesquisador não sabe o que pedir, aponte `/qualilab` a ele.

## Vocabulário, e ele tem significado técnico aqui

- **Documento**: unidade do corpus. Tudo se ancora em posições de caractere do texto dele.
- **Código**: rótulo do esquema, em árvore. Código COM FILHOS é família e não recebe trechos
  diretamente — por isso as contagens vêm em dois números (`count_direct` e
  `count_with_descendants`). Família com direto 0 e agregado 1070 é o normal, não um erro.
- **Trecho (coding)**: UM código aplicado a UM intervalo, por UM codificador, em UMA camada. Dois
  códigos no mesmo intervalo são dois trechos. Mas o MESMO código no MESMO intervalo, aplicado por
  várias pessoas, é um pedaço de texto só: `list_codings` devolve esse pedaço uma vez, com
  `coding_count` e `codings` listando cada aplicação. Concordância entre codificadores não é
  evidência multiplicada.
- **Camada**: `individual` é o trabalho de cada pesquisador; `final` é o gabarito consolidado da
  equipe. Ao afirmar algo sobre codificação, diga de que camada e de que codificador ela vem.
- **Memo**: texto do pesquisador sobre o projeto, um documento, um código ou um trecho. É o
  raciocínio dele, não dado bruto.

## Regras que não têm exceção

- **Não cite o que não veio de uma ferramenta nesta conversa.** Precisa do texto? Peça o texto
  (`get_document_content`). Não reconstrua de memória e não parafraseie citação.
- **Faixas de `█` são censura deliberada** do pesquisador (nomes, dados identificáveis), não lacuna
  do corpus nem falha de extração. Não tente inferir o que está sob a máscara, não conte como dado
  ausente, e não conclua que "o corpus não menciona" a partir delas. A máscara preserva o
  comprimento do texto, então os offsets continuam válidos.
- **A busca roda sobre o texto MASCARADO**: termo censurado não é encontrável por construção. Zero
  ocorrências nunca prova ausência no corpus original — diga isso se a contagem for o ponto.
- **Você lê janelas, não documentos inteiros.** Se a conclusão vale só para o que leu, diga isso.
- **Nada é escrito.** Nenhuma ferramenta altera o projeto; não sugira que algo foi modificado.

## O retrato é do momento da exportação

O projeto é lido quando é aberto. Se o pesquisador mudou algo no app depois disso, peça que exporte
de novo (`exportar ▾ → salvar .qualilab`) e chame `open_project` outra vez — não há recarga a quente.
