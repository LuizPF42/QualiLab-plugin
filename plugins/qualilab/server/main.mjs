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
//     claude mcp add qualilab -- node "<caminho>/main.mjs" "<caminho>/projeto.qualilab"
//
// SÓ LEITURA: nenhum tool escreve; o arquivo é lido uma vez, no boot, sem recarga a quente.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { lerZip } from "./zip.mjs";
import { QL_PREAMBLE, QL_TOOLS, makeQlToolRunner, unpackPdfIndex } from "./ql-core.gen.mjs";

const VERSAO = "1.5.0";

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

let ctx = null, corredor = null, aberto = null;
function abreProjeto(caminhoArq) {
  const { db, pdfIdx } = carregaQualilab(caminhoArq);
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
    console.error("qualilab-mcp: não consegui abrir " + arquivoUnico + " — " + (e && e.message || e));
    process.exit(1);
  }
  console.error("qualilab-mcp: " + resumoDoAberto());
} else {
  const achados = listaArquivos();
  // pasta com UM projeto abre sozinha: o caso comum não deve custar duas chamadas ao modelo
  if (achados.length === 1) {
    try { abreProjeto(join(pasta, achados[0])); console.error("qualilab-mcp: " + resumoDoAberto()); }
    catch (e) { console.error("qualilab-mcp: falhei ao abrir " + achados[0] + " — " + (e && e.message || e)); }
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

async function executa(nome, args) {
  // tool fora da lista anunciada (suggest_terms, propose_codings, alucinação): o erro tem de
  // listar as ferramentas DESTA porta — o default do corredor listaria as 8 da porta A
  if (!ANUNCIADOS.has(nome))
    return { error: `ferramenta desconhecida: ${nome}`,
             hint: `as disponíveis são ${TOOLS.map(t => t.name).join(", ")}` };
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
      capabilities: { tools: {} },
      serverInfo: { name: "qualilab", title: "QualiLab — leitura do corpus", version: VERSAO },
      instructions: QL_PREAMBLE + (pasta ? NOTA_PASTA : ""),
    });
  } else if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    // notificações não têm resposta
  } else if (method === "ping") {
    responde(id, {});
  } else if (method === "tools/list") {
    responde(id, { tools: TOOLS.map(t => ({
      name: t.name, description: t.description, inputSchema: t.parameters })) });
  } else if (method === "tools/call") {
    const saida = await executa(params && params.name, params && params.arguments);
    responde(id, { content: [{ type: "text", text: JSON.stringify(saida) }], isError: false });
  } else if (method === "resources/list" || method === "resources/templates/list"
             || method === "prompts/list") {
    // LISTA VAZIA, e não -32601: cliente real pergunta mesmo sem a capability anunciada. O app do
    // ChatGPT chama resources/list logo após o initialize e registra o erro
    // (`Failed to list resources ... Mcp error: -32601`); responder o erro correto pelo protocolo
    // custava um servidor considerado problemático por um cliente que só queria saber que não há
    // nada. Não anunciamos as capabilities porque de fato não servimos resources nem prompts —
    // dizer que sim seria pior.
    responde(id, method === "prompts/list" ? { prompts: [] }
      : method === "resources/list" ? { resources: [] } : { resourceTemplates: [] });
  } else if (id !== undefined) {
    respondeErro(id, -32601, "método não suportado: " + method);
  }
});
rl.on("close", () => process.exit(0));
