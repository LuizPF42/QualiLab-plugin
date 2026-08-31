# QualiLab — leitura do corpus, dentro do seu assistente

Aponta o **Claude**, o **ChatGPT**, o **Gemini** ou o **Google Antigravity** que você já usa para o corpus de um projeto
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
- **A censura do pesquisador é aplicada no servidor.** Faixas marcadas como sensíveis chegam ao
  modelo mascaradas com `█`, e a máscara preserva o comprimento do texto — as posições de caractere
  continuam válidas. **Onde isso é uma fronteira real:** no chat do Claude Desktop (o `.mcpb`), em
  que o modelo não alcança o disco e o servidor é o único caminho até o corpus. **Onde não é:** em
  clientes agênticos (Cowork, Claude Code, ChatGPT/Codex, Antigravity) o assistente tem ferramentas de arquivo
  próprias, e o `.qualilab` é um formato de trabalho que carrega o texto **cru** — se ele abrir o
  arquivo por fora, lê sem máscara. Ali a censura é convenção respeitada, não tranca. Detalhes em
  [PRIVACY.md](PRIVACY.md).
- **Projeto que declara não usar IA não abre aqui.** Desde a 1.4.32, o QualiLab deixa desligar os
  recursos de IA de um projeto (Projeto → Recursos de IA), e essa decisão viaja dentro do
  `.qualilab`. Este pacote a respeita: com **um arquivo só**, ele sobe e toda ferramenta responde
  explicando o motivo; com **uma pasta**, a lista continua completa e quem recusa é a abertura —
  os outros projetos seguem abrindo. Existe porque este servidor entrega corpus ao modelo a cada
  turno, que é exatamente o que aquela chave desliga no aplicativo. Como a censura, **não é uma
  tranca**: quem reativar a IA no próprio QualiLab e exportar de novo, passa.
- **Só lê os arquivos que você separou.** O acesso é à pasta que você indicar (por padrão
  `QualiLab`, na sua pasta de usuário), e só a arquivos `.qualilab` dentro dela.

## Requisito, e ele não vale para todos

| Cliente | Instalação | Precisa de Node.js? |
| :-- | :-- | :-- |
| **App do Claude** — chat **e** Cowork | arquivo `.mcpb` (Releases) | **não** — o app fornece o runtime |
| ChatGPT (app) / Codex | marketplace deste repo | **não** — o app provisiona o runtime dele |
| Claude Code no terminal | marketplace deste repo | **sim**, `node` no PATH |
| **Gemini CLI** | `gemini extensions install` | **já está lá** — o Gemini CLI é um programa Node |
| Gemini Code Assist (VS Code / JetBrains) | um bloco em `settings.json` | **sim**, `node` no PATH |
| **Google Antigravity** (IDE / CLI / 2.0) | copiar a pasta do plugin | **sim**, `node` no PATH |
| Gemini (app de chat, gemini.google.com) | **não dá** — veja abaixo | — |

**Se você usa o aplicativo do Claude, instale a extensão `.mcpb` e pare por aí.** Ela atende as
duas superfícies do app — o **chat** e o **Cowork** — e não exige instalar nada: o runtime vem
junto com o Claude Desktop. (Medido: uma extensão instalada em *Configurações → Extensões* responde
também nas sessões de modo agente.) O marketplace deste repositório **não** dá ferramenta nenhuma
ao chat, então ele não substitui a extensão.

O marketplace serve dois casos: o **ChatGPT/Codex** — onde o app resolve o runtime sozinho, também
sem instalar nada — e o **Claude Code no terminal**, que é o único caminho em que o `node` precisa
estar no PATH do sistema. Se for o seu caso e você não tem Node, instale a versão LTS em
[nodejs.org](https://nodejs.org) e **reinicie o computador** (ou pelo menos saia e entre de novo na
sua conta).

> Reiniciar só o aplicativo pode não bastar, e o sintoma engana: o plugin aparece instalado,
> mas o assistente diz que não tem as ferramentas. É que cada programa herda o PATH de quem o
> abriu, e o Windows não avisa os programas já em execução de que o PATH mudou — inclusive o
> Explorer, que é quem abre tudo. Depois de reiniciar, confira num terminal novo que `node -v`
> responde.

**Não quer reiniciar, ou não quer instalar o Node?** O pacote traz um lançador de resgate para
Windows que procura o Node onde ele costuma estar, em vez de depender do PATH — e que aproveita o
runtime que o **app do ChatGPT** instala sozinho, se você o tiver. Na pasta do plugin instalado,
troque em `mcp-claude.json` (Claude) ou `mcp-codex.json` (Codex):

```json
"command": "cmd.exe",
"args": ["/d", "/s", "/c", "${CLAUDE_PLUGIN_ROOT}\\server\\run-windows.cmd"]
```

No Codex, use `".\\server\\run-windows.cmd"` (ele não interpola a variável). Depois reinicie o
cliente. O arquivo é um `.cmd` de vinte linhas: dá para ler antes de confiar.

## Instalar

### Aplicativo do Claude — chat e Cowork (recomendado, sem instalar nada)

Baixe o `qualilab.mcpb` da [última Release](../../releases/latest) e instale em
**Configurações → Extensões → Configurações avançadas**. Só isso: as ferramentas passam a existir
tanto no chat quanto no Cowork, e nenhum runtime precisa ser instalado.

> Duplo clique no arquivo e arrastar para a janela **não funcionam** na versão do Claude Desktop
> distribuída pela Microsoft Store, e não é defeito do pacote — aquele pacote não declara
> associação de tipo de arquivo. Use o menu.

> **A extensão não se atualiza sozinha.** Um `.mcpb` instalado deste jeito é uma cópia local: nada
> nele aponta de volta para este repositório, então versão nova não chega. Para atualizar, baixe o
> `.mcpb` da [última Release](../../releases/latest) e instale por cima — vale a pena conferir de
> vez em quando. (O plugin do Claude Code/Cowork e do Codex, abaixo, **se atualiza**: lá quem
> entrega versão nova é o marketplace.)

### Claude Code no terminal

É o único caminho que exige `node` no PATH (veja a tabela acima). No aplicativo do Claude, prefira
a extensão.

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

### Gemini CLI

Este repositório também é uma **extensão do Gemini CLI** — o `gemini-extension.json` está na raiz,
que é onde o instalador procura. Uma linha:

```
gemini extensions install https://github.com/LuizPF42/QualiLab-plugin
```

Depois reinicie o `gemini`. Não há Node a instalar: o Gemini CLI **é** um programa Node, então o
runtime que este servidor precisa já veio com ele — a seção do PATH acima não vale aqui.

Além das ferramentas, a extensão traz o vocabulário (o `GEMINI.md`, que é a mesma coisa que a
*skill* entregue ao Claude Code e ao Codex) e os pontos de partida como comandos de barra:
`/qualilab` — para quem abre a conversa sem saber o que pedir —, `/explorar_projeto`,
`/mapear_codebook` e `/evidencias_de_codigo`.

Para servir uma pasta que não seja `~/QualiLab`, edite o `gemini-extension.json` da extensão
instalada (a pasta que o instalador criou dentro de `~/.gemini/extensions/`) e acrescente o
caminho aos `args`:

```json
"args": ["${extensionPath}${/}plugins${/}qualilab${/}server${/}main.mjs", "C:\\Users\\voce\\Documentos\\corpus"]
```

### Gemini Code Assist (VS Code / JetBrains)

O Code Assist lê servidores MCP de `~/.gemini/settings.json` — ou de `.gemini/settings.json` na raiz
do projeto, que dá para versionar e compartilhar com a equipe. Clone este repositório onde quiser e
aponte para ele:

```json
{
  "mcpServers": {
    "qualilab": {
      "command": "node",
      "args": ["/caminho/para/QualiLab-plugin/plugins/qualilab/server/main.mjs"]
    }
  }
}
```

Este é o único caminho do Gemini em que o `node` precisa estar no PATH do sistema — vale a seção
sobre reiniciar o computador, mais acima. (O Code Assist compartilha a pasta `~/.gemini` com o
Gemini CLI, então a extensão instalada acima pode acabar valendo para os dois; o bloco em
`settings.json` é o caminho documentado, e é o que eu recomendo se quiser garantia.)

### Google Antigravity (IDE / CLI / 2.0)

O Antigravity descobre plugins automaticamente na pasta global de configurações ou no diretório
`.agents/` do seu projeto.

**Instalação global (disponível em todos os projetos):**

Clone ou copie a pasta `plugins/qualilab` do repositório para a sua configuração do Antigravity:

- **Windows**: `C:\Users\<você>\.gemini\config\plugins\qualilab`
- **Linux / macOS**: `~/.gemini/config/plugins/qualilab`

**Instalação no projeto (compartilhada via repositório):**

Copie `plugins/qualilab` para a pasta `.agents/plugins/qualilab` na raiz do seu projeto.

O Antigravity carrega a skill `qualilab` e inicia o servidor MCP via `mcp_config.json`
automaticamente. Vale a seção sobre o `node` no PATH, mais acima.

### Gemini no navegador (gemini.google.com) — o que **não** dá

O app de chat do Gemini aceita apps personalizados, mas só pela **URL de um servidor MCP**: um
endereço na internet, que o Google alcança. Este pacote não tem endereço nenhum — ele é um programa
que roda na sua máquina e conversa pela entrada e saída padrão, e é justamente por isso que o
corpus não sai do seu computador.

Para caber ali, o `.qualilab` teria de ficar atrás de um servidor público, e as três promessas do
começo deste arquivo cairiam juntas: passaria a existir um servidor no caminho, o corpus sairia da
sua máquina, e a censura do pesquisador dependeria de uma máquina que não é a sua. **Não vamos
fazer isso**, e é melhor dizer isso do que oferecer um túnel e chamar de compatibilidade.

Se você quer o Gemini lendo o seu corpus hoje, o caminho é o **Gemini CLI**, acima: mesma conta,
mesmo modelo, e o corpus continua onde está.

## Usar

1. No QualiLab, com o projeto aberto: **exportar ▾ → salvar `.qualilab`**.
2. Deixe o arquivo na pasta **`QualiLab`** da sua pasta de usuário (`~/QualiLab`, ou
   `C:\Users\<você>\QualiLab`). Crie a pasta se não existir.
3. Na conversa, peça para listar os projetos e abrir o que interessa. Com um projeto só na pasta,
   ele abre sozinho.

Cada projeto é lido **uma vez, quando é aberto**: o que o assistente enxerga é o retrato do
momento em que você exportou. Mudou o projeto no app? Exporte de novo e peça para abrir outra vez
— sem reinstalar nada.

Se o assistente responder que **o projeto declara não usar IA**, não é defeito: aquele projeto tem
os recursos de IA desligados no QualiLab, e o pacote respeita isso (veja a lista acima). Para
mudar, reative em **Projeto → Recursos de IA** no aplicativo e exporte o `.qualilab` de novo.

### O que o assistente ganha

`list_projects` · `open_project` · `get_project` · `list_documents` · `get_document_content` ·
`search_corpus` · `list_codes` · `list_codings` · `list_memos`

São as mesmas ferramentas da tela **MCP/RAG** do QualiLab — literalmente o mesmo código, extraído
do app. O que muda é quem paga a conversa: na tela do app, você traz a sua chave de API; aqui,
quem fala com o modelo é a assinatura que você já tem.

Junto delas vai o **vocabulário**: o pacote ensina ao assistente que código com filhos é família e
não recebe trechos direto (por isso as contagens vêm em dois números), que camada individual não é
a final, e que faixa de `█` é censura deliberada — não lacuna do corpus, e não algo a inferir. No
plugin do Claude Code e do Codex isso é uma *skill*; na extensão do Gemini CLI é o `GEMINI.md`;
na extensão do Claude Desktop, viaja junto do servidor.

E se você abrir a conversa sem saber o que pedir, há três pontos de partida prontos: **explorar
projeto**, **mapear o esquema de códigos** e **reunir evidências de um código** — cada um já na
ordem certa de chamadas. Eles aparecem na interface da extensão do Claude Desktop, e como
comandos de barra no Gemini CLI.

Elas devolvem **janelas** do corpus, não o corpus inteiro: o assistente lê trechos, e boas
respostas dependem de ele dizer de onde tirou o que afirma. As descrições das ferramentas pedem
isso a ele; vale conferir mesmo assim.

## Licença e origem

MIT. Este repositório é **gerado**: o servidor e os manifestos vêm de um repositório privado, onde
o núcleo é extraído do próprio código do aplicativo QualiLab — as duas portas de leitura rodam
literalmente o mesmo código, e a máscara de censura não é reimplementada em lugar nenhum. Cada
mudança é verificada ali por um cliente MCP real. Não edite os arquivos daqui — a próxima
publicação sobrescreve.
