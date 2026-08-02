# Privacidade

Vale para as três formas de instalar o QualiLab no seu assistente: a extensão `.mcpb` do Claude
Desktop, o plugin do Claude Code/Cowork e o plugin do ChatGPT/Codex. Todas rodam o mesmo servidor,
na sua máquina.

## O que este pacote coleta

**Nada.** Não há telemetria, análise de uso, relatório de erro remoto ou identificador de
instalação. O servidor não faz nenhuma requisição de rede — nem para o QualiLab, nem para
terceiros, nem para verificar atualização.

## O que ele lê

Apenas arquivos `.qualilab` dentro da pasta que **você** indicar na instalação (por padrão,
`QualiLab` na sua pasta de usuário). Não lê outros formatos, não percorre outras pastas e não
aceita caminho vindo do modelo: as ferramentas só abrem projetos que já apareceram na listagem
daquela pasta.

## O que ele escreve

**Nada.** As nove ferramentas são de leitura. O seu arquivo `.qualilab` não é alterado, e o pacote
não cria arquivo, cache ou índice em disco. Cada projeto é lido para a memória quando você manda
abrir, e some quando o programa fecha.

## Para onde o seu material vai

Para o assistente que **você** escolheu — Claude ou ChatGPT — como parte da conversa, e só o que as
ferramentas devolverem: os trechos que ele pedir, não o arquivo inteiro. Esse material fica sujeito
à política de privacidade e aos termos do fornecedor que você já usa; o QualiLab não é parte dessa
relação, não vê a sua chave e não intermedeia nada. **Não existe servidor do QualiLab no caminho.**

Se o seu corpus não pode sair da sua máquina de jeito nenhum, então ele não pode ir para um
assistente em nuvem — nem por aqui, nem colado numa caixa de texto. Essa decisão é anterior a este
pacote.

## A censura, e onde ela é garantia de verdade

As faixas que você marcou como sensíveis no QualiLab chegam ao modelo mascaradas com `█`, aplicadas
**dentro do servidor**, antes de qualquer busca, recorte ou contagem. A máscara preserva o
comprimento do texto, então as posições continuam válidas. Os códigos de censura, os trechos que os
aplicam e os memos que os definem ficam fora do que é servido — eles diriam onde estava o quê.

**Onde isso é uma fronteira real:** no chat do Claude Desktop (a extensão `.mcpb`). Ali o modelo não
tem acesso ao seu disco, e o único caminho até o corpus é o servidor — que sempre mascara.

**Onde não é, e isso precisa ser dito:** em clientes agênticos (Claude Cowork, Claude Code,
ChatGPT/Codex) o modelo tem ferramentas de arquivo próprias, e o `.qualilab` é um formato de
trabalho que carrega o texto **cru**. Se o assistente abrir o arquivo por fora — em vez de usar
estas ferramentas — ele lê sem máscara. O servidor é o caminho conveniente e correto, não uma
tranca. Nessas superfícies, trate a censura como uma convenção respeitada pelo assistente, não como
uma garantia técnica; se a garantia for indispensável, use a extensão `.mcpb` no chat do Claude
Desktop.

## O que a censura nunca cobriu

Títulos de documento, valores de categoria e memos comuns vão como estão. O QualiLab não anonimiza
o corpus: ele mascara **as faixas que você marcou**. Se um nome está no título do documento, ele
viaja.

## Código aberto

Licença MIT, e o servidor tem três arquivos sem dependência nenhuma — dá para ler o que ele faz. A
fonte fica em [QualiLab-mcp-rag](https://github.com/LuizPF42/QualiLab-mcp-rag), onde cada mudança é
verificada por um cliente MCP real.

## Contato

Dúvida ou problema de privacidade:
[abra uma issue](https://github.com/LuizPF42/QualiLab-mcp-rag/issues).
