# QualiLab — leitura do corpus, dentro do seu assistente

Aponta o **Claude** ou o **ChatGPT** que você já usa para o corpus de um projeto
[QualiLab](https://github.com/LuizPF42/QualiLab): documentos, códigos, trechos codificados e
memos. O assistente passa a **pedir** o material em vez de recebê-lo colado numa caixa de texto.

## Antes de instalar, o que isto faz e o que não faz

O seu cliente vai avisar, em vermelho, que extensões de terceiros não são controladas pelo
fornecedor. O aviso é justo, e a resposta é esta:

- **Só leitura.** Nenhuma das ferramentas escreve. O seu `.qualilab` não é alterado, e nada é
  gravado nele.
- **Nenhuma chave de API.** Quem fala com o modelo é o cliente que você já paga. Este pacote não
  vê chave nenhuma e não faz requisição de rede.
- **Nenhum servidor no caminho.** O corpus sai do arquivo, na sua máquina, direto para o cliente.
  Não há nuvem do QualiLab envolvida.
- **A censura do pesquisador é preservada.** Faixas marcadas como sensíveis chegam ao modelo
  mascaradas com `█`, e a máscara preserva o comprimento do texto — as posições de caractere
  continuam válidas.
- **Só lê os arquivos que você separou.** O acesso é à pasta que você indicar (por padrão
  `QualiLab`, na sua pasta de usuário), e só a arquivos `.qualilab` dentro dela.

## Requisito, e ele não vale para os três

| Cliente | Instalação | Precisa de Node.js? |
| :-- | :-- | :-- |
| Claude Desktop | arquivo `.mcpb` (Releases) | **não** — o Claude Desktop fornece o runtime |
| Claude Code | marketplace deste repo | **sim**, `node` no PATH |
| ChatGPT (app) / Codex | marketplace deste repo | **sim**, `node` no PATH |

Nos dois últimos, quem lança o servidor é o cliente, e ele resolve o comando `node` pelo PATH do
sistema. Se você não tem Node, instale a versão LTS em [nodejs.org](https://nodejs.org) e
**reinicie o cliente**.

## Instalar

### Claude Desktop

Baixe o `qualilab.mcpb` da [última Release](../../releases/latest) e instale em
**Configurações → Extensões → Configurações avançadas**.

> Duplo clique no arquivo e arrastar para a janela **não funcionam** na versão do Claude Desktop
> distribuída pela Microsoft Store, e não é defeito do pacote — aquele pacote não declara
> associação de tipo de arquivo. Use o menu.

### Claude Code

Em **Adicionar marketplace**, o campo **URL** é `LuizPF42/QualiLab-plugin` — depois
**Sincronizar**, e instale o plugin `qualilab`. Na linha de comando:

```
/plugin marketplace add LuizPF42/QualiLab-plugin
/plugin install qualilab@qualilab
```

Depois, `/reload-plugins` (ou reinicie a sessão).

### ChatGPT (app) / Codex

Em **Configurações → Modo desenvolvedor → Plugins → Adicionar marketplace de plugins**:

- **Origem**: `LuizPF42/QualiLab-plugin`
- **Referência do Git**: `main`
- **Caminhos esparsos**: deixe **vazio** — o marketplace está na raiz do repositório.

Depois, instale o plugin `qualilab`. Na linha de comando:

```
codex plugin marketplace add https://github.com/LuizPF42/QualiLab-plugin
codex plugin add qualilab@qualilab
```

**Reinicie o app depois de instalar.** A configuração dos servidores é lida só na inicialização,
e quase todo sintoma de "não apareceu ferramenta nenhuma" é isso.

## Usar

1. No QualiLab, com o projeto aberto: **exportar ▾ → salvar `.qualilab`**.
2. Deixe o arquivo na pasta **`QualiLab`** da sua pasta de usuário (`~/QualiLab`, ou
   `C:\Users\<você>\QualiLab`). Crie a pasta se não existir.
3. Na conversa, peça para listar os projetos e abrir o que interessa. Com um projeto só na pasta,
   ele abre sozinho.

Cada projeto é lido **uma vez, quando é aberto**: o que o assistente enxerga é o retrato do
momento em que você exportou. Mudou o projeto no app? Exporte de novo e peça para abrir outra vez
— sem reinstalar nada.

### O que o assistente ganha

`list_projects` · `open_project` · `get_project` · `list_documents` · `get_document_content` ·
`search_corpus` · `list_codes` · `list_codings` · `list_memos`

São as mesmas ferramentas da tela **MCP/RAG** do QualiLab — literalmente o mesmo código, extraído
do app. O que muda é quem paga a conversa: na tela do app, você traz a sua chave de API; aqui,
quem fala com o modelo é a assinatura que você já tem.

Elas devolvem **janelas** do corpus, não o corpus inteiro: o assistente lê trechos, e boas
respostas dependem de ele dizer de onde tirou o que afirma. As descrições das ferramentas pedem
isso a ele; vale conferir mesmo assim.

## Licença e origem

MIT. Este repositório é **gerado**: a fonte do servidor e dos manifestos é
[LuizPF42/QualiLab-mcp-rag](https://github.com/LuizPF42/QualiLab-mcp-rag), onde o mesmo código é
verificado por um cliente MCP real a cada mudança. Não edite os arquivos daqui — a próxima
publicação sobrescreve.
