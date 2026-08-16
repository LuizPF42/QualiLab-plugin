#!/usr/bin/env node
// QualiLab — porta B: servidor MCP de LEITURA sobre um arquivo .qualilab.
//
// O que é: a mesma superfície de tools da tela "MCP/RAG" do app, atravessando fronteira de
// PROCESSO. Lá os tools são funções JS chamadas na própria página (não é MCP, apesar do nome da
// tela); aqui são tools MCP de verdade, para um cliente externo — Claude Desktop, Claude Code —
// apontar para o corpus. Quem fala com o modelo passa a ser o cliente do fornecedor, com a
// assinatura do pesquisador; o QualiLab não vê chave nenhuma.
//
// POR QUE JAVASCRIPT, E POR QUE ISTO É PEQUENO: o Claude Desktop embute um Node.js — extensão
// .mcpb em Node instala com dois cliques, sem o pesquisador instalar runtime nenhum. E os
// executores JÁ SÃO JavaScript: ql-core.gen.mjs é o código da tela MCP/RAG extraído byte a byte
// do index.html (gen_core.py, com --check no CI). Este arquivo só carrega o .qualilab, monta o
// contexto e fala o protocolo. A máscara de censura, a busca, as contagens: NADA disso é
// reimplementado — paridade com a porta A por construção.
//
// SEM DEPENDÊNCIAS de propósito (nem o SDK oficial): o protocolo aqui é 4 métodos sobre
// JSON-RPC/stdio (initialize, tools/list, tools/call, ping), e o test_client.py — que usa o SDK
// oficial de CLIENTE — é quem prova a conformidade. Dependência zero significa que o .mcpb é só
// os nossos 3 arquivos + manifest, e que a máquina de desenvolvimento não precisa de npm.
//
// Uso direto (sem .mcpb):
//     node main.mjs CAMINHO.qualilab
//     node main.mjs PASTA                             (modo pasta; ver abaixo)
//     claude mcp add qualilab -- node "<caminho>/main.mjs" "<caminho>/projeto.qualilab"
//
// Há um package.json ao lado, pronto para publicar este servidor no npm como `qualilab-mcp` — o
// que daria um `npx -y qualilab-mcp` de uma linha, no molde do pdf-viewer da própria Anthropic.
// NÃO ESTÁ PUBLICADO, e por isso nenhum README menciona npx: prometer instalação que não existe é
// pior do que não oferecê-la. Se um dia publicar, o build já confere a versão do package.json.
//
// SÓ LEITURA: nenhum tool escreve; o arquivo é lido uma vez, no boot, sem recarga a quente.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { lerZip } from "./zip.mjs";
import { QL_PREAMBLE, QL_TOOLS, makeQlToolRunner, unpackPdfIndex } from "./ql-core.gen.mjs";

const VERSAO = "1.5.7";

/* ------------------------------------------------------------------------------------------
 * As TRÊS diferenças deliberadas em relação à porta A — e só elas (documentadas no README):
 * 1. suggest_terms não é anunciado (decisão D-C da spec): o índice semântico é cache do IDB do
 *    navegador, não viaja no .qualilab. A nota abaixo é ANEXADA à descrição de search_corpus
 *    (reescrever o texto lá dentro divergiria em silêncio na próxima edição do index.html), e o
 *    hint de query vazia é trocado pelo mesmo motivo.
 * 2. get_project ganha um campo `source`: o modelo precisa saber que isto é o retrato de um
 *    ARQUIVO, sem recarga a quente.
 * 3. coders sai dos AUTORES DOS TRECHOS (é o que a descrição promete); a porta A usa a lista de
 *    membros do projeto, que um arquivo não carrega.
 * ------------------------------------------------------------------------------------------ */
const NOTA_PORTA_B =
  " NESTE SERVIDOR a ferramenta suggest_terms nao existe (o indice semantico e um cache do" +
  " navegador do pesquisador e nao viaja no arquivo do projeto): ignore a mencao a ela e escolha" +
  " os termos a partir do que voce ja leu com list_codes, list_memos e get_document_content.";
const HINT_QUERY_VAZIA_B =
  "passe o termo a procurar; se não sabe que termos o corpus usa, leia list_codes e um documento antes";

/* MODO PASTA — diferenças 4 e 5, e as únicas que ACRESCENTAM ferramenta.
 * Quando o argumento é um DIRETÓRIO, o servidor deixa de ser "um arquivo lido no boot" e passa a
 * servir os .qualilab daquela pasta, com list_projects/open_project. É o que permite empacotar o
 * plugin uma vez e o pesquisador só largar arquivos numa pasta — não há seletor de arquivo neste
 * cliente, e o modelo não alcança a configuração para editá-la.
 * Continuam FORA do núcleo extraído: na porta A já existe um projeto aberto, e lá "listar projetos"
 * não quer dizer nada. Caminho de ARQUIVO segue funcionando igual, e é o que o .mcpb usa. */
const NOTA_PASTA =
  "\n\nNESTE SERVIDOR o material vem de uma PASTA que pode conter vários projetos. Antes de qualquer" +
  " outra coisa chame list_projects e depois open_project; só então get_project. Trocar de projeto no" +
  " meio da conversa é permitido (chame open_project de novo), mas avise o pesquisador que trocou, e" +
  " não misture numa mesma afirmação material de projetos diferentes.";
const TOOLS_PASTA = [
  { name: "list_projects",
    description: "Os projetos QualiLab disponíveis na pasta servida por este servidor. Chame antes de" +
      " get_project: enquanto nenhum projeto estiver aberto, as demais ferramentas recusam. O campo" +
      " open diz qual está aberto agora, ou nulo se nenhum.",
    parameters: { type: "object", properties: {} } },
  { name: "open_project",
    description: "Abre um dos projetos devolvidos por list_projects e o torna o corpus desta conversa," +
      " substituindo o anterior. Devolve o mesmo retrato de get_project. Use o nome de arquivo exato" +
      " que list_projects devolveu.",
    parameters: { type: "object", required: ["file"],
      properties: { file: { type: "string", description: "nome do arquivo como devolvido por list_projects" } } } },
];

// ---------------------------------------------------------------------------------------------
// carga do .qualilab (JSON plano ou zip com project.json + pdfindex/)
// ---------------------------------------------------------------------------------------------
function carregaQualilab(caminho) {
  const bruto = readFileSync(caminho);
  const pdfIdx = {};
  let db;
  if (bruto[0] === 0x50 && bruto[1] === 0x4b) { // "PK"
    const entradas = lerZip(bruto);
    const projeto = entradas.get("project.json");
    if (!projeto) throw new Error("zip sem project.json: isto é um .qualilab?");
    db = JSON.parse(projeto.toString("utf8"));
    for (const [nome, dados] of entradas) {
      if (nome.startsWith("pdfindex/") && nome.endsWith(".json")) {
        const p = unpackPdfIndex(dados.toString("utf8"));
        if (p) pdfIdx[nome.slice("pdfindex/".length, -".json".length)] = p;
      }
    }
  } else {
    // BOM tolerado (o app descarta na ingestão; um .qualilab editado à mão pode ter)
    let texto = bruto.toString("utf8");
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    db = JSON.parse(texto);
  }
  for (const chave of ["documents", "categories", "doc_values", "codes", "codings", "memos"])
    if (!Array.isArray(db[chave])) db[chave] = [];
  return { db, pdfIdx };
}

function montaContexto(db, pdfIdx) {
  const meta = db._meta || {};
  const autores = [];
  for (const c of db.codings) {
    const n = c.author_name;
    if (n && !autores.includes(n)) autores.push(n);
  }
  autores.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return {
    project: { id: meta.id || "file-project", name: meta.name },
    projectMode: meta.mode || "individual",
    docs: db.documents, codes: db.codes, cats: db.categories,
    allCodings: db.codings, allValues: db.doc_values, memos: db.memos,
    coders: autores.map(n => ({ name: n })),   // diferença 3: autores dos trechos
    pdfIdx,
  };
}

// ---------------------------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------------------------
// um argumento com "${...}" é template do manifesto que o cliente NÃO substituiu (user_config
// opcional não preenchido, ou instalação feita à mão): tratar como ausente e cair no padrão, em
// vez de procurar uma pasta chamada "${user_config.pasta}" e morrer no boot
const naoVazio = a => a && !a.startsWith("-") && !a.includes("${");
const alvo = process.argv.slice(2).find(naoVazio) || (naoVazio(process.env.QUALILAB_FILE) && process.env.QUALILAB_FILE)
  || join(process.env.USERPROFILE || process.env.HOME || ".", "QualiLab");

let pasta = null, arquivoUnico = null;
try {
  if (statSync(alvo).isDirectory()) pasta = resolve(alvo); else arquivoUnico = resolve(alvo);
} catch {
  console.error("qualilab-mcp: não achei " + alvo + "\n" +
    "  uso: node main.mjs CAMINHO.qualilab   (um projeto)\n" +
    "       node main.mjs CAMINHO_DA_PASTA   (vários; padrão ~/QualiLab)");
  process.exit(1);
}

// os nomes vêm SEMPRE desta lista, e open_project só aceita o que está nela: o modelo escolhe o
// arquivo, então aceitar caminho arbitrário deixaria ele ler qualquer coisa do disco
function listaArquivos() {
  if (!pasta) return [];
  try { return readdirSync(pasta).filter(n => n.toLowerCase().endsWith(".qualilab")).sort(); }
  catch { return []; }
}

/* S7 — PROJETO QUE DECLARA NÃO USAR IA NÃO ABRE AQUI.
   Este servidor lê o .qualilab e despeja corpus a cada turno do laço, que é literalmente o eixo do
   interruptor `restrict_ai` acontecendo FORA do aplicativo. Fechar as telas de IA no app e deixar
   esta porta aberta seria fechar a porta e deixar a janela.
   A decisão é de SESSÃO, então mora aqui e não no núcleo extraído pelo gen_core.py — mesma família
   das cinco diferenças deliberadas desta porta.
   NÃO é fronteira técnica, e nada aqui finge que seja: quem editar o JSON da configuração, ou
   tirar a declaração no próprio QualiLab e exportar de novo, passa. O que isto faz é o mesmo que o
   app faz — limitar a VAZÃO, que é o que importa quando o dano é proporcional à quantidade. */
const declaraSemIa = db => ((db && db._meta) || {}).restrict_ai === "all";
const RECUSA_HINT = "o pesquisador desativou os recursos de IA neste projeto, e o arquivo carrega essa" +
  " decisão. Não contorne: diga isso a ele. Se a decisão mudou, ele reativa em Projeto → Recursos de IA," +
  " dentro do QualiLab, e exporta o .qualilab de novo. Nesta pasta pode haver outros projetos —" +
  " list_projects mostra quais.";
const recusaSemIa = nomeArq => ({ error: `o projeto ${nomeArq} declara não usar IA`, hint: RECUSA_HINT });

let ctx = null, corredor = null, aberto = null;
let bloqueado = null;   // nome do arquivo recusado (modo arquivo único): toda chamada devolve a recusa
function abreProjeto(caminhoArq) {
  const { db, pdfIdx } = carregaQualilab(caminhoArq);
  if (declaraSemIa(db)) { const e = new Error("projeto declara não usar IA"); e.semIa = true; throw e; }
  ctx = montaContexto(db, pdfIdx);
  corredor = makeQlToolRunner(ctx);
  aberto = caminhoArq;
  return ctx;
}
function resumoDoAberto() {
  const red = ctx.codes.filter(c => c.is_redaction).length;
  return `${ctx.docs.length} documentos, ${ctx.codes.length} códigos, ` +
    `${ctx.allCodings.length} trechos, ${red} de censura — ${basename(aberto)}`;
}

if (arquivoUnico) {
  try { abreProjeto(arquivoUnico); } catch (e) {
    /* projeto declarado NÃO derruba o servidor, de propósito: com exit(1) o cliente mostra só
       "o servidor falhou" e ninguém fica sabendo POR QUE. Ele sobe e responde a recusa em toda
       chamada, que é a única forma de a explicação chegar ao modelo — e por ele, ao pesquisador. */
    if (e && e.semIa) { bloqueado = basename(arquivoUnico); console.error("qualilab-mcp: " + arquivoUnico + " declara não usar IA — nenhuma ferramenta vai responder sobre ele"); }
    else {
      console.error("qualilab-mcp: não consegui abrir " + arquivoUnico + " — " + (e && e.message || e));
      process.exit(1);
    }
  }
  if (!bloqueado) console.error("qualilab-mcp: " + resumoDoAberto());
} else {
  const achados = listaArquivos();
  // pasta com UM projeto abre sozinha: o caso comum não deve custar duas chamadas ao modelo
  if (achados.length === 1) {
    try { abreProjeto(join(pasta, achados[0])); console.error("qualilab-mcp: " + resumoDoAberto()); }
    catch (e) { console.error("qualilab-mcp: " + (e && e.semIa ? achados[0] + " declara não usar IA — não foi aberto"
                                                              : "falhei ao abrir " + achados[0] + " — " + (e && e.message || e))); }
  } else {
    console.error(`qualilab-mcp: ${achados.length} projeto(s) em ${pasta} — nenhum aberto ainda`);
  }
}

// diferença 1: a lista anunciada não tem suggest_terms, e search_corpus leva a nota anexada
const TOOLS = [
  ...(pasta ? TOOLS_PASTA : []),                                       // diferenças 4 e 5
  ...QL_TOOLS
    .filter(t => t.name !== "suggest_terms")
    .map(t => t.name === "search_corpus" ? { ...t, description: t.description + NOTA_PORTA_B } : t),
];
const ANUNCIADOS = new Set(TOOLS.map(t => t.name));

/* ANOTAÇÕES (`annotations` do MCP) — a submissão ao diretório da Anthropic EXIGE title e os hints
 * de leitura/destruição em toda ferramenta, e o cliente usa os dois: o title é o que aparece no
 * diálogo de permissão (o nome cru "get_document_content" não diz nada a quem não programa), e o
 * readOnlyHint é o que deixa o cliente parar de perguntar a cada chamada num laço de leitura.
 *
 * TODAS são readOnly, e isto é o produto, não uma conveniência: nenhuma ferramenta escreve, o
 * arquivo é aberto só para leitura e o .qualilab não é alterado. `open_project` entra junto porque
 * o que ela troca é QUAL arquivo está carregado nesta sessão — nada no disco muda.
 * openWorldHint FALSO: não há rede nem acesso fora da pasta servida; o universo é fechado e é o
 * que o pesquisador escolheu. */
const TITULOS = {
  list_projects: "Projetos na pasta",
  open_project: "Abrir projeto",
  get_project: "Retrato do projeto",
  list_documents: "Documentos do corpus",
  get_document_content: "Texto de um documento",
  search_corpus: "Buscar no corpus",
  list_codes: "Esquema de códigos",
  list_codings: "Trechos codificados",
  list_memos: "Memos do pesquisador",
};
// title fora E dentro de annotations de propósito: o campo de topo é da revisão nova do protocolo,
// e cliente de vintage anterior só lê o de dentro. Repetir custa nada; faltar deixa o nome cru.
function anotada(t) {
  const title = TITULOS[t.name];
  return {
    name: t.name, description: t.description, inputSchema: t.parameters,
    ...(title ? { title } : {}),
    annotations: { ...(title ? { title } : {}), readOnlyHint: true, destructiveHint: false,
                   idempotentHint: true, openWorldHint: false },
  };
}

/* O VOCABULÁRIO, numa constante só: ele vai no `instructions` do initialize E no corpo do prompt
 * de partida. Uma segunda cópia escrita à mão divergiria na próxima edição do index.html — o
 * QL_PREAMBLE é EXTRAÍDO de lá pelo gen_core, e texto copiado não acompanha a extração. */
const VOCABULARIO = QL_PREAMBLE + (pasta ? NOTA_PASTA : "");

/* PROMPTS — o que a skill é para o plugin, o prompt é para a extensão. O .mcpb não tem mecanismo
 * de skills (é um pacote de SERVIDOR, não de instruções), e o chat do Claude Desktop é justamente
 * a superfície onde o pesquisador não-técnico chega sem saber o que pedir. Eles aparecem na
 * interface como pontos de partida, e cada um já carrega a ordem de entrada correta — o erro mais
 * comum do modelo aqui é analisar antes de chamar get_project.
 * SERVIDOS DE VERDADE (prompts/list e prompts/get), e não só declarados no manifesto: declarar sem
 * implementar deixa um botão que falha ao ser clicado. */
const PROMPTS = [
  /* O DEGRAU ANTERIOR AOS OUTROS TRÊS, e vem primeiro na lista porque é onde se começa. Os outros
   * são TAREFAS: quem escolhe "mapear o esquema" já sabe o que quer. Faltava a porta de quem abre
   * o chat sem saber o que pedir e teria de acertar o primeiro prompt no chute — este abre o
   * projeto e DEVOLVE A BOLA com o que dá para pedir, em vez de sair analisando por conta.
   * O vocabulário viaja aqui além do `instructions` de propósito: nem todo cliente injeta as
   * instructions do servidor no contexto do modelo, e neste turno a chegada é garantida. */
  {
    name: "qualilab",
    title: "QualiLab — começar aqui",
    description: "Ponto de partida: ensina o vocabulário ao assistente, abre o projeto e lista o" +
      " que dá para pedir a partir dele.",
    arguments: [],
    texto: () =>
      // sem repetir o imperativo: o VOCABULARIO já abre mandando lê-lo antes de chamar ferramenta,
      // e duas ordens iguais em sequência leem como texto gerado, não como enquadramento
      "Vamos trabalhar com o meu projeto QualiLab. O que vem abaixo é o vocabulário desta" +
      " ferramenta, e o erro mais comum aqui é analisar antes de abrir o projeto.\n\n" +
      VOCABULARIO + "\n\n" +
      (pasta
        ? "Agora abra o projeto: chame list_projects, depois open_project (se houver mais de um," +
          " me pergunte qual) e só então get_project."
        : "Agora abra o projeto: comece chamando get_project.") +
      "\n\nFeito isso, me diga em três ou quatro linhas o que há aqui — quantos documentos," +
      " quantos códigos, quantos trechos, se existe gabarito e quanto do corpus está sob censura" +
      " — e então me ofereça, em lista curta, o que dá para pedir a partir deste projeto: mapear" +
      " o esquema de códigos, reunir as evidências de um código, buscar um termo no corpus, ler" +
      " um documento, levantar os memos. Não analise conteúdo ainda: espere eu escolher.",
  },
  {
    name: "explorar_projeto",
    title: "Explorar um projeto",
    description: "Abre um projeto e faz o retrato inicial: corpus, esquema de códigos e censura.",
    arguments: [],
    // o texto cita só as ferramentas que EXISTEM neste modo: em arquivo único não há
    // list_projects/open_project, e mandar chamar ferramenta inexistente gasta um turno e ensina
    // o modelo a duvidar da própria lista
    texto: () =>
      (pasta
        ? "Abra o projeto QualiLab disponível e me dê o retrato inicial. Siga esta ordem: chame" +
          " list_projects, depois open_project no que houver (se houver mais de um, me pergunte" +
          " qual), e só então get_project."
        : "Me dê o retrato inicial deste projeto QualiLab. Comece chamando get_project.") +
      " Depois me diga, em texto corrido: quantos documentos há e de que tipo, como" +
      " está organizado o esquema de códigos, quais camadas e codificadores existem, e quanto do" +
      " corpus está sob censura. Não analise conteúdo ainda — quero saber com o que estou lidando.",
  },
  {
    name: "mapear_codebook",
    title: "Mapear o esquema de códigos",
    description: "Descreve a árvore de códigos com contagens, separando famílias de códigos folha.",
    arguments: [],
    texto: () =>
      "Mapeie o esquema de códigos deste projeto. Chame get_project e depois list_codes. Ao" +
      " apresentar, separe as FAMÍLIAS (códigos com filhos, que agrupam e não recebem trechos" +
      " diretamente) dos códigos folha, e para cada uma mostre os dois números de contagem" +
      " (diretos e com descendentes) explicando o que cada um significa. Diga de que camada vêm as" +
      " contagens. Ao final, aponte o que chama atenção: códigos muito usados, famílias vazias," +
      " ramos desbalanceados.",
  },
  {
    name: "evidencias_de_codigo",
    title: "Reunir evidências de um código",
    description: "Junta os trechos codificados com um código, com a fonte de cada um.",
    arguments: [
      { name: "codigo", description: "nome do código a investigar", required: true },
    ],
    texto: (a) =>
      `Reúna as evidências do código "${a.codigo || "(peça o nome ao pesquisador)"}" neste projeto.` +
      " Chame get_project, ache o código com list_codes e traga os trechos com list_codings. Para" +
      " cada trecho que citar, diga o documento, a camada e o codificador de onde veio, e cite" +
      " apenas texto que a ferramenta devolveu nesta conversa. Se precisar de contexto ao redor de" +
      " um trecho, leia a janela com get_document_content antes de interpretar. Ao final, resuma o" +
      " que os trechos têm em comum e o que os divide — dizendo quantos você leu de quantos existem.",
  },
];

async function executa(nome, args) {
  // tool fora da lista anunciada (suggest_terms, propose_codings, alucinação): o erro tem de
  // listar as ferramentas DESTA porta — o default do corredor listaria as 8 da porta A
  if (!ANUNCIADOS.has(nome))
    return { error: `ferramenta desconhecida: ${nome}`,
             hint: `as disponíveis são ${TOOLS.map(t => t.name).join(", ")}` };
  /* S7 — modo arquivo único com projeto declarado: a recusa vem ANTES de tudo, inclusive de
     list_projects (que nem existe aqui). É o equivalente, nesta porta, de as telas de IA sumirem
     no app: não há caminho que devolva material deste projeto. */
  if (bloqueado) return recusaSemIa(bloqueado);
  if (nome === "list_projects") {
    const itens = listaArquivos();
    return { items: itens.map(f => ({ file: f, open: aberto ? basename(aberto) === f : false })),
             total: itens.length, returned: itens.length,
             open: aberto ? basename(aberto) : null, folder: pasta,
             ...(itens.length ? {} : { notes: ["a pasta não tem nenhum arquivo .qualilab"] }) };
  }
  if (nome === "open_project") {
    const pedido = args && args.file;
    const itens = listaArquivos();
    if (!itens.includes(pedido))                       // só nomes da lista — ver comentário em listaArquivos
      return { error: `projeto não encontrado: ${pedido == null ? "(nenhum)" : pedido}`,
               hint: itens.length ? `os desta pasta são ${itens.join(", ")}`
                                  : "a pasta não tem nenhum arquivo .qualilab" };
    try { abreProjeto(join(pasta, pedido)); } catch (e) {
      // S7: o projeto que declara não usar IA tem recusa PRÓPRIA — cair na frase genérica de
      // "arquivo corrompido" mandaria o modelo tentar de novo, e a decisão é do pesquisador, não
      // um defeito do arquivo.
      if (e && e.semIa) return recusaSemIa(pedido);
      return { error: `não consegui abrir ${pedido}: ${e && e.message || e}`,
               hint: "o arquivo pode estar corrompido ou não ser um .qualilab; tente outro de list_projects" };
    }
    console.error("qualilab-mcp: abriu " + resumoDoAberto());
    nome = "get_project"; args = {};                   // devolve o mesmo retrato, como a descrição promete
  }
  if (!corredor)
    return { error: "nenhum projeto aberto",
             hint: "chame list_projects e depois open_project antes de qualquer outra ferramenta" };
  let r;
  try {
    r = await corredor.run(nome, args || {});
  } catch (e) { // nenhum tool lança por contrato; se lançar, vira DADO — o modelo precisa sair dele
    return { error: `falha ao executar ${nome}: ${e && e.message || e}`,
             hint: "tente outros argumentos ou outra ferramenta; o projeto não foi alterado" };
  }
  if (nome === "get_project" && r && !r.error)
    r = { ...r, source: { file: basename(aberto), ...(pasta ? { folder: pasta } : {}),
      note: "retrato do projeto no momento da exportação deste arquivo; o servidor não relê o arquivo" +
        (pasta ? ", mas open_project troca de projeto a qualquer momento" : " enquanto roda") } };
  if (nome === "search_corpus" && r && r.error === "query vazia")
    r = { ...r, hint: HINT_QUERY_VAZIA_B };
  return r;
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC 2.0 sobre stdio (mensagens delimitadas por \n — o transporte stdio do MCP).
// Feito à mão de propósito: são 4 métodos, e o test_client.py (SDK oficial de CLIENTE) é quem
// prova a conformidade. isError fica FALSO mesmo em {error,hint}: o envelope de erro é resposta
// que o modelo precisa LER para se corrigir (spec §3), não falha de transporte.
// ---------------------------------------------------------------------------------------------
function responde(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondeErro(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (linha) => {
  linha = linha.trim();
  if (!linha) return;
  let msg;
  try { msg = JSON.parse(linha); } catch { return; } // lixo no stdin: ignora, não derruba
  const { id, method, params } = msg;
  if (method === undefined) return;                  // resposta a request nosso (não fazemos nenhum)

  if (method === "initialize") {
    responde(id, {
      // ecoa a versão pedida: este servidor só usa o núcleo do protocolo (tools), estável em
      // todas as revisões; recusar versão nova quebraria clientes à toa
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "qualilab", title: "QualiLab — leitura do corpus", version: VERSAO },
      instructions: VOCABULARIO,
    });
  } else if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    // notificações não têm resposta
  } else if (method === "ping") {
    responde(id, {});
  } else if (method === "tools/list") {
    responde(id, { tools: TOOLS.map(anotada) });
  } else if (method === "tools/call") {
    const saida = await executa(params && params.name, params && params.arguments);
    responde(id, { content: [{ type: "text", text: JSON.stringify(saida) }], isError: false });
  } else if (method === "prompts/list") {
    responde(id, { prompts: PROMPTS.map(p => ({
      name: p.name, title: p.title, description: p.description, arguments: p.arguments })) });
  } else if (method === "prompts/get") {
    const p = PROMPTS.find(x => x.name === (params && params.name));
    if (!p) {
      respondeErro(id, -32602, "prompt desconhecido: " + (params && params.name) +
        " — os desta extensão são " + PROMPTS.map(x => x.name).join(", "));
    } else {
      responde(id, { description: p.description, messages: [
        { role: "user", content: { type: "text", text: p.texto((params && params.arguments) || {}) } }] });
    }
  } else if (method === "resources/list" || method === "resources/templates/list") {
    // LISTA VAZIA, e não -32601: cliente real pergunta mesmo sem a capability anunciada. O app do
    // ChatGPT chama resources/list logo após o initialize e registra o erro
    // (`Failed to list resources ... Mcp error: -32601`); responder o erro correto pelo protocolo
    // custava um servidor considerado problemático por um cliente que só queria saber que não há
    // nada. Resources continua vazio de verdade — não servimos nenhum, e anunciar que sim seria
    // pior. Prompts saiu daqui em 1.5.1: agora são servidos, e a capability é anunciada.
    responde(id, method === "resources/list" ? { resources: [] } : { resourceTemplates: [] });
  } else if (id !== undefined) {
    respondeErro(id, -32601, "método não suportado: " + method);
  }
});
rl.on("close", () => process.exit(0));
