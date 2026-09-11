// GERADO por mcp-server/gen_core.py a partir de src/ — NAO EDITE ESTE ARQUIVO.
// E o MESMO codigo da tela MCP/RAG (porta A), extraido byte a byte: executores, descricoes
// e preambulo. Mudou algo la? Rode `py -3 mcp-server/gen_core.py` e commite este arquivo.
// O CI roda `--check` e falha quando os dois divergem.

/* MOTOR UNICO de busca textual — serve a busca do documento aberto (a search-bar do leitor) E a
   busca global ("pesquisar +"). Ser o mesmo motor nao e economia de codigo: e o que garante que
   os offsets dos dois batam, pra clicar num resultado global abrir o leitor no match exato (o
   pendingJump ancora por `start`, que so vira fronteira de run se o leitor achar o MESMO match).
   opts: { re: o padrao e regex do usuario, cs: diferencia maiusculas, whole: palavra inteira }.
   Devolve { spans:[[start,end],...], error } — `error` so em regex invalida, pra UI avisar em vez
   de fingir "nenhuma ocorrencia". `cap` herda o teto da busca do leitor: buscar "a" num documento
   grande gerava dezenas de milhares de spans no DOM -> congelamento. */
const WORD_CH = /[\p{L}\p{N}_]/u;
function findMatches(text, query, opts, cap){
  const o = opts||{};
  const q = o.re ? (query||'') : (query||'').trim();
  if(!q || !text) return { spans:[] };
  // minimo de 2 chars so no modo literal (com regex o usuario sabe o que esta pedindo)
  if(!o.re && q.length<2) return { spans:[] };
  let rx;
  try{
    rx = new RegExp(o.re ? q : q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g' + (o.cs?'':'i'));
  }catch(e){ return { spans:[], error:String(e.message||e) }; }
  const out=[]; const max=cap||2000; let m;
  while(out.length<max && (m = rx.exec(text))!==null){
    const s=m.index, e=s+m[0].length;
    if(e===s){ rx.lastIndex++; continue; }   // padrao de largura zero ("a*") -> laco infinito
    // "palavra inteira" e checado nas BORDAS do match, nunca embutido no padrao: \b erra em
    // portugues (no regex do JS "ç"/"ã" nao sao word chars, entao \bção casaria no meio de
    // "acao"), e mexer no padrao do usuario quebraria o modo regex.
    if(!o.whole || ((s===0 || !WORD_CH.test(text[s-1])) && (e===text.length || !WORD_CH.test(text[e]))))
      out.push([s,e]);
  }
  return { spans:out };
}

/* mascara trechos marcados como censura (code.is_redaction) antes de mandar pra IA — so
   considera o codigo da PROPRIA linha de coding, nao verifica sobreposicao com OUTROS codigos
   no mesmo span (ex.: um trecho com "Tema X" que por acaso contem um nome ja censurado por
   outro codigo continuaria aparecendo intacto aqui). Cobertura parcial, de proposito por ora —
   ver CLAUDE.md ("Censura — proximos passos") pra fechar essa lacuna e estender pra exports. */
/* Detects a redaction coding whose anchor no longer matches the document. Every coding this
   app creates or imports stores quote === content.slice(span_start, span_end) at creation
   (applyCode, importQDPX's pushCodingsFor, remapSpans all rewrite it), so a mismatch is NEVER
   a legitimate state: it means the content changed under the coding without a remap — write
   queue replaying after an admin edited the text, a .qualilab merged over different content,
   or a file crafted outside the app. When that happens the span points at the WRONG text and
   every span-based mask built from it is misplaced (adversarial review of 1.4.21, finding 1:
   3 inserted chars exposed 3 chars of the censored name). There is no way to know where the
   censored text went, so every consumer FAILS CLOSED: the whole document is masked. Loud and
   over-masking, which is the recoverable failure mode — the researcher sees it and re-anchors;
   the alternative leaks silently. A redaction coding with an INVALID span but a non-empty
   quote counts as broken too: today it silently contributes no range at all, which leaves its
   target visible. Empty quote with a collapsed span is legitimate (remapSpans clamps a fully
   deleted region to zero length) and is NOT flagged.
   Consumers: maskRedactedContent (below), redactionRanges and maskQuoteSpans (transparency),
   and through them the MCP tools (this helper is extracted by gen_core.py). */
function brokenRedactionAnchor(content, codings, maskedCodeIds){
  if(!maskedCodeIds || !maskedCodeIds.size) return false;
  if(typeof content !== 'string') return true;
  return (codings||[]).some(c=>{
    if(!maskedCodeIds.has(c.code_id)) return false;
    const q = typeof c.quote === 'string' ? c.quote : '';
    if(!q) return false;
    if(!(c.span_start>=0 && c.span_end>c.span_start && c.span_end<=content.length)) return true;
    return content.slice(c.span_start, c.span_end) !== q;
  });
}
/* Label used by the fail-closed branch of the prose masks. One constant, not a literal in each
   caller: a second spelling would be the duplicated-mask bug class all over again. */
const REDACTION_DESYNC_LABEL = '[documento omitido por segurança: uma censura perdeu a âncora após o texto mudar — reaplique a censura neste documento]';
/* O rotulo da mascara de PROSA. Ele tinha a disciplina do vizinho acima escrita no comentario e
   nao aplicada a si mesmo: era LITERAL em 16 pontos de src/ (a mascara aqui, o maskSlice e o
   maskQuoteSpans da transparencia, o fallback do TextQuoteSelector do W3C, o span .redacted do
   leitor ATI, o Relatorio, e as 8 telas de IA — metade delas EXPLICANDO a grafia ao modelo).
   Uma segunda grafia ali nao quebra nada: ela vaza em silencio, que e a assinatura desta area.
   SAO DUAS GRAFIAS, E A SEGUNDA E LEGITIMA: '[censurado]', mais curta, e a que o maskQuoteSpans
   usa para a PORCAO de um quote (o trecho continua legivel em volta, e o rotulo longo comeria a
   frase). Ela vira REDACTED_PART_LABEL, abaixo. A assimetria que sobra esta MEDIDA e NAO foi
   mexida aqui de proposito: o maskSlice tambem mascara porcao e usa a LONGA. Igualar muda o que
   sai no leitor ATI e no W3C, ou seja, e mudanca de ARTEFATO — decisao a tomar com os olhos
   abertos e teste proprio, nao carona numa extracao de constante.
   ⚠️ NAO E ROTULO DE INTERFACE, e por isso ele NAO passa pelo catalogo de idioma: esta string
   sai no HTML do leitor ATI, no `exact` do W3C e no retorno dos tools de leitura — ou seja, chega
   a TERCEIROS e ao MODELO, e num artefato de transparencia o rotulo e parte do dado publicado.
   Traduzi-lo com a UI faria o mesmo arquivo mudar de conteudo conforme a lingua do navegador de
   quem exportou. Quem quiser i18n aqui decide POR ARTEFATO, nao por navegador.
   O `█` do opts.fill nao e afetado: ele preserva comprimento e nao usa rotulo nenhum. */
const REDACTED_LABEL = '[trecho censurado]';

/* DUAS MASCARAS, DOIS CONTEXTOS (decidido em 29/jul, spec em to-do/spec-mcp-tools.md):
   - prosa SEM offsets (prompt das telas de IA, ATI, W3C, Relatorio) -> rotulo '[trecho censurado]';
   - superficie COM offsets (os tools de leitura do corpus) -> opts.fill, que PRESERVA O
     COMPRIMENTO trocando cada caractere por █.
   Nao e estetica: o rotulo tem 18 chars e substitui faixa de qualquer tamanho, entao todo offset
   DEPOIS da primeira faixa mascarada passaria a apontar pro lugar errado — e os tools servem
   span_start/span_end contra este mesmo texto. Uma funcao so, com opcao: mascara duplicada e
   exatamente a classe de bug que "vaza em silencio". */
function maskRedactedContent(content, codings, maskedCodeIds, opts){
  if(!maskedCodeIds || !maskedCodeIds.size) return content;
  // Fail closed BEFORE building ranges: a desynced anchor means the ranges below would mask
  // the wrong place, and an invalid-span redaction would contribute no range at all.
  if(brokenRedactionAnchor(content, codings, maskedCodeIds))
    return (opts && opts.fill) ? '█'.repeat(content.length) : REDACTION_DESYNC_LABEL;
  const ranges = (codings||[])
    .filter(c=>maskedCodeIds.has(c.code_id) && c.span_start>=0 && c.span_end>c.span_start)
    .map(c=>[c.span_start, c.span_end]).sort((a,b)=>a[0]-b[0]);
  if(!ranges.length) return content;
  const merged=[]; for(const r of ranges){ const last=merged[merged.length-1]; if(last && r[0]<=last[1]) last[1]=Math.max(last[1],r[1]); else merged.push([...r]); }
  const fill = !!(opts && opts.fill);
  let out='', pos=0;
  for(const [s,e] of merged){
    out += content.slice(pos,s) + (fill ? '█'.repeat(Math.max(0, Math.min(e, content.length) - s)) : REDACTED_LABEL);
    pos = e;
  }
  return out + content.slice(pos);
}

/* ===== O NOME DO AUTOR: O QUE SE GRAVA x O QUE SE MOSTRA (fatia 1 do item EN) =====
   ACHADO MEDIDO em 31/ago/2026, e ele e da familia do coderKey da v1.4.28: o app GRAVA
   'anonimo' (sem acento — o default do SupabaseStore, o do joinProject e o do ensureAuthor da
   exportacao) e EXIBE 'anônimo' (com acento, em ~24 pontos, como fallback de author_name vazio).
   SINTOMA, e ele passa por dado: no MESMO projeto as duas grafias aparecem lado a lado, e onde a
   identidade e por NOME — o `'__nm__'+author_name` logo acima, que e como todo material
   IMPORTADO e agrupado — elas contam como DUAS PESSOAS. Nada quebra e nada avisa; a
   Reconciliacao mostra dois chips onde ha um codificador.

   authorLabel e a fronteira: nome gravado entra, rotulo sai. E ela unifica as duas grafias, que
   e a metade que conserta o bug de verdade — trocar so o fallback deixaria o 'anonimo' JA
   GRAVADO no banco das pessoas aparecendo cru ao lado do outro.

   O PRECO ACEITO, escrito para nao ser descoberto por acidente: quem se chamar literalmente
   "anonimo" sera exibido como anônimo. E aceitavel porque o valor gravado nao muda (a identidade
   e a chave continuam intactas), o caso e improvavel, e a alternativa e a divergencia visivel
   que isto existe para fechar.

   ORIGENS DE IMPORTACAO tambem passam por aqui, e sao MAPA EXPLICITO, nunca heuristica: so
   'Planilha' e portugues ('Taguette' e 'Zotero' sao nomes proprios e nao se traduzem). Nome de
   PESSOA jamais entra nesse mapa — ele e dado do pesquisador. */
const AUTHOR_ANON = 'anonimo';        // o VALOR gravado quando nao ha nome (sem acento)
const AUTHOR_LABELS = { 'anonimo': 'anônimo', 'anônimo': 'anônimo', 'Planilha': 'Planilha' };
function authorLabel(n){
  const s = (n==null ? '' : String(n)).trim();
  if(!s) return AUTHOR_LABELS[AUTHOR_ANON];
  return AUTHOR_LABELS[s] || s;
}

/* S05 — SUBIR A HIERARQUIA SEM RISCO DE NÃO TERMINAR. A FK de `codes.parent_id` garante que o
   pai EXISTE, nunca que a árvore seja acíclica: com A→B e B→A, todo `while(p) p=parentOf[p]`
   roda para sempre e CONGELA a aba — a de quem criou o ciclo e a de todo mundo que carregar o
   mesmo esquema. O trigger `codes_acyclic_guard` fecha a porta da nuvem; esta função fecha a do
   CLIENTE, que é por onde entra o resto: `.qualilab` de terceiro (o contrato mínimo exige só
   `documents[]`), rascunho e arquivo, que não têm trigger nenhum.
   DEVOLVE OS ANCESTRAIS EM ORDEM, e para no primeiro repetido — um ciclo produz a subida até
   fechar e nada mais. `visto` em vez de só um teto porque o Set responde a pergunta certa
   ("já passei por aqui?") e o teto responde outra ("está fundo demais?"); os dois juntos custam
   nada e o segundo ainda protege contra cadeia legítima absurda vinda de arquivo. */
const ANCESTOR_MAX_DEPTH = 64;
function ancestorsOf(id, getParent){
  const out = [], visto = new Set([id]);
  let p = getParent(id);
  while(p && !visto.has(p) && out.length < ANCESTOR_MAX_DEPTH){ out.push(p); visto.add(p); p = getParent(p); }
  return out;
}

/* contagem por código AGREGADA na família: cada codificação conta no próprio código e sobe a
   cadeia de pais. Virou obrigatório quando família passou a NÃO receber trechos — a contagem direta
   dela é sempre zero, e a árvore ficaria dizendo que a família não é usada quando todo o uso está
   nos filhos.
   NÃO DEDUPLICA, e isso é escolha: um trecho codificado com DOIS subcódigos da mesma família conta
   2 nela. É a conta do NVivo; o ATLAS.ti faz o contrário (conta 1, e explica a diferença no manual
   com um caso de 44 vs 41). Somamos porque a unidade que o painel conta em todo lugar é a
   CODIFICAÇÃO, não o pedaço de texto — deduplicar aqui e somar ali seria pior que qualquer das
   duas. A UI diz "inclui os subcódigos" no title, porque contagem agregada sem aviso é armadilha. */
function aggCounts(codings, codes){
  const direct={}; (codings||[]).forEach(c=>{ direct[c.code_id]=(direct[c.code_id]||0)+1; });
  const parentOf={}; (codes||[]).forEach(c=>{ parentOf[c.id]=c.parent_id; });
  const agg={...direct};
  Object.entries(direct).forEach(([codeId,n])=>{ for(const p of ancestorsOf(codeId, x=>parentOf[x])) agg[p]=(agg[p]||0)+n; });
  return agg;
}

/* consolida codificações do MESMO pedaço de texto — (documento, código, span exato) — numa
   entrada só, listando quem aplicou. É a outra ponta do aggCounts acima: ele conta CODIFICAÇÃO
   (a unidade da árvore e dos Gráficos), este agrupa por PEDAÇO DE TEXTO (a unidade de quem LÊ ou
   ENVIA o trecho). Em projeto coletivo, 3 pesquisadores marcando a mesma frase com o mesmo código
   são 3 codificações e 1 pedaço; repetir a citação por codificador não acrescenta nada a quem lê
   e, no prompt da IA, multiplica o material pelo tamanho da equipe.
   Só funde span EXATO: dois trechos com texto igual em posições diferentes são ocorrências
   distintas e ficam ambos. A ordem de inserção é preservada (o Map garante), então a lista
   consolidada sai na mesma ordem em que a original entrou.
   O code_id ENTRA na chave porque há chamador que mistura códigos na mesma lista (o material do
   painel Sugerir Codificação); onde a lista já é de um código só, ele é inofensivo. */
function groupCodingSpans(list){
  const groups = new Map();
  (list||[]).forEach(c=>{
    const key = c.document_id+'|'+c.code_id+'|'+c.span_start+'|'+c.span_end;
    let g = groups.get(key);
    if(!g){
      g = { key, rep:c, items:[], authors:[], hasFinal:false,
            document_id:c.document_id, code_id:c.code_id,
            span_start:c.span_start, span_end:c.span_end, quote:c.quote };
      groups.set(key, g);
    }
    g.items.push(c);
    const a = authorLabel(c.author_name);
    if(!g.authors.includes(a)) g.authors.push(a);
    if(c.layer==='final') g.hasFinal = true;
  });
  return [...groups.values()];
}

/* Serializacao COMPACTA do indice pra persistencia (decisao do autor 18/jul: persistir SIM).
   Frags viram arrays [start,end,page,x,y,w,h,conf,origem-codigo] (bbox 4 casas, conf 2) — um doc
   OCR de ~200 pags fica em poucos MB. O content vai JUNTO: e ele que permite reancorar
   (remapIndexToContent) quando o texto for editado depois. NUNCA vai pro localStorage. */
const PDF_INDEX_ORIGENS = ['nativo','ocr','vlm','humano'];

function unpackPdfIndex(raw){                    // string/objeto -> { content, index } | null (tolerante)
  try{
    const o = typeof raw==='string' ? JSON.parse(raw) : raw;
    if(!o || o.v!==1 || typeof o.content!=='string' || !Array.isArray(o.frags)) return null;
    return { content: o.content, index: o.frags.map(a=>({ start:a[0], end:a[1], page:a[2],
      x:a[3], y:a[4], w:a[5], h:a[6], conf:a[7], origem: PDF_INDEX_ORIGENS[a[8]]||'nativo' })) };
  }catch(e){ return null; }
}

/* SINAL DE QUALIDADE da extracao (triagem do batch import: achar os docs podres entre 50 sem
   perseguir cada excecao — a saida holistica do whack-a-mole). Sinais DETERMINISTICOS e baratos
   sobre o content, + a confianca do OCR quando o indice §4 esta a mao. Nao decide nada sozinho:
   vira aviso com sugestao (OCR / ✏ editar). */
function extractionHealth(content, index){
  const flags = [];
  const len = (content||'').length;
  if(!len) return { ok:false, flags:['documento vazio (PDF escaneado sem camada de texto?). Rode o ◎ OCR'] };
  if(len >= 400){
    const spaces = (content.match(/[ \n\t]/g)||[]).length;
    if(spaces/len < 0.06) flags.push('texto quase sem espaços (PDF sem caractere de espaço). Rode o ◎ OCR');
  }
  const bad = (content.match(/[�■□]/g)||[]).length;   // � ■ □ (fonte com codificação quebrada)
  if(bad > 3 && bad/len > 0.003) flags.push(bad+' caracteres ilegíveis (fonte com codificação quebrada). Rode o ◎ OCR');
  if(index && index.length){
    const ocr = index.filter(f=>f.origem==='ocr' && typeof f.conf==='number');
    if(ocr.length >= 30){
      const mean = ocr.reduce((s,f)=>s+f.conf,0)/ocr.length;
      if(mean < 0.75) flags.push('OCR com confiança baixa (média '+Math.round(mean*100)+'%). Revise com ✏ editar');
    }
  }
  return { ok: flags.length===0, flags };
}

function pageOfOffset(index, off){               // offset no content -> pagina (frag mais proximo com pagina)
  if(!index || !index.length) return null;
  let lo=0, hi=index.length-1;
  while(lo<hi){ const m=(lo+hi+1)>>1; if(index[m].start<=off) lo=m; else hi=m-1; }
  let best=null, bd=Infinity;
  for(const f of [index[lo-1], index[lo], index[lo+1]]){
    if(!f || f.page==null) continue;
    const dist = off < f.start ? f.start-off : (off >= f.end ? off-f.end+1 : 0);
    if(dist < bd){ bd=dist; best=f; }
  }
  return best ? best.page : null;
}

/* ===== MCP/RAG — SUPERFICIE DE LEITURA DO CORPUS (jul/2026) ==================================
   Oito tools de SO-LEITURA que o modelo chama pra PEDIR o material, em vez de receber um recorte
   fechado antes da pergunta. Contrato (nomes, argumentos, envelope, textos) fechado em
   to-do/spec-mcp-tools.md; este bloco e a promocao dele pro codigo.

   O ENTREGAVEL DURAVEL SAO AS DESCRICOES, nao os executores: eles so COMPOEM funcoes que ja
   existiam (findMatches, maskRedactedContent, aggCounts, extractionHealth, semSuggest,
   pageOfOffset). Se um executor precisar de logica NOVA de dominio, o desenho esta errado — e a
   mascara de censura, em especial, nao pode ser reimplementada em lugar nenhum.

   ISTO NAO E MCP, apesar do nome da tela: os tools sao funcoes JS chamadas na propria pagina, e
   MCP so existe pra atravessar fronteira de PROCESSO. O contrato e que e o mesmo de um servidor
   MCP de verdade (o spike do M0) — dai os nomes e o envelope identicos.

   ONTOLOGIA E CONDUTA MORAM NO PREAMBULO, nao em cada descricao: as descricoes sao reenviadas a
   CADA turno do laco, entao repetir o vocabulario oito vezes multiplicaria esse texto por oito em
   todas as chamadas.
   =============================================================================================== */
// LIMITES DA SUPERFICIE DE LEITURA — soltos em ago/2026 junto com os do painel (ver a nota do
// IA_DOC_CHAR_LIMIT). QL_LIMIT_* e QL_WINDOW_* sao EXTRAIDOS pelo gen_core.py e valem tambem na
// porta B (extensao/plugins), onde quem administra o contexto e o cliente do fornecedor: la um teto
// nosso baixo so impedia o modelo de pedir o que ele podia receber. A janela PADRAO subiu junto com
// o maximo de proposito — o default e o que o modelo usa quando nao pensa no assunto, e 8k fazia
// toda leitura nascer truncada. QL_MAX_STEPS/QL_CHAR_BUDGET sao do laco da TELA (nao viajam pro
// servidor) e continuam existindo: sao a defesa contra laco caro, e nenhum deles e silencioso.
const QL_LIMIT_DEF = 100, QL_LIMIT_MAX = 1000;
const QL_WINDOW_DEF = 30000, QL_WINDOW_MAX = 400000;
const QL_MAX_STEPS = 24;                // passos do laco por pergunta
// NAO volte a igualar isto ao IA_TOTAL_CHAR_LIMIT (era 600k, "= IA_TOTAL_CHAR_LIMIT", e ESTOUROU):
// nas telas de IA aquele numero e material enviado UMA vez num prompt de uma rodada; aqui e o que
// ACUMULA no historico de um laco, e o historico inteiro e reenviado a cada passo. Pior, a unidade
// e caractere de JSON (uuid, chaves repetidas, \n escapado), que tokeniza a ~2,6 chars/token: 600k
// davam ~230k tokens e a Anthropic recusava a conversa inteira com "prompt is too long". 250k dao
// ~75k tokens, com folga pro preambulo, pra prosa dos passos e pra resposta final. Modelo de janela
// grande (Gemini 1M) aguentaria mais, mas o teto e o mesmo pros quatro de proposito: o pesquisador
// troca de provedor sem que o comportamento da tela mude.
const QL_CHAR_BUDGET = 250000;          // teto de material devolvido pelos tools numa conversa

const QL_PREAMBLE = `Você está analisando um projeto de pesquisa qualitativa no QualiLab. Leia este vocabulário antes de chamar qualquer ferramenta; os termos abaixo têm significado técnico aqui.

Documento: uma unidade do corpus (entrevista, decisão, artigo). Tem um conteúdo de texto puro, e é sobre as posições de caractere desse texto que tudo o mais se ancora.
Código: um rótulo do esquema de análise, organizado em árvore. Código COM FILHOS é uma família: ela agrupa e, por construção, não recebe trechos diretamente. Por isso toda contagem vem em dois números, count_direct e count_with_descendants — família com direto 0 e agregado 1070 é o normal, não um erro.
Trecho (coding): a aplicação de UM código a UM intervalo de caracteres de UM documento, por UM codificador, em UMA camada. Dois códigos no mesmo intervalo são dois trechos. Já o MESMO código no MESMO intervalo, aplicado por várias pessoas, são várias codificações de um pedaço de texto só: list_codings devolve esse pedaço UMA vez, com o campo codings listando cada aplicação — três pessoas concordando não é evidência três vezes maior.
Camada: "individual" é o trabalho de cada pesquisador; "final" é o gabarito consolidado da equipe. Quando as duas existem, a final é a que a equipe sustenta.
Categoria (atributo): um campo preenchido por documento (tipo, ano, tribunal). É metadado do documento, não codificação de trecho.
Memo: texto escrito pelo pesquisador sobre o projeto, um documento, um código ou um trecho. É o raciocínio dele, não dado bruto.

Conduta, sem exceção:
1. Chame get_project antes de qualquer outra coisa.
2. Nunca cite um trecho que você não recebeu de uma ferramenta nesta conversa. Se precisa do texto, peça o texto. Não reconstrua de memória e não parafraseie citação.
3. Ao afirmar algo sobre codificação, diga em que camada e de que codificador ela vem.
4. Faixas de █ são conteúdo censurado de propósito pelo pesquisador (nomes, dados identificáveis). São recorte deliberado, não lacuna do corpus e não falha de extração: não tente inferir o que está sob a máscara, não conte como dado ausente e não conclua que "o corpus não menciona" a partir delas. Elas preservam o comprimento do texto original, então os offsets continuam válidos.
5. Você lê janelas, não documentos inteiros. Se sua conclusão vale só para o que leu, diga isso. Quando um retorno traz next_offset ou next_start diferente de nulo, há mais material: ou continue lendo, ou declare que parou.
6. Ao usar contagem, diga qual das duas (direta ou agregada).
7. Você não altera o projeto. Nenhuma ferramenta escreve. Sugestões de codificação são feitas ao pesquisador em palavras, para ele decidir na interface.
8. Responda em português, com a sobriedade de quem escreve para publicação: sem elogiar a pergunta, sem prometer o que não leu.`;

const QL_LAYER_PARAM = { type:'string', enum:['auto','final','individual','all'], description:'auto (padrão) = gabarito quando existir, senão individual' };

const QL_TOOLS = [
  {
    name: 'get_project',
    description: 'Retrato do projeto e do que existe nele. CHAME ANTES DE QUALQUER OUTRA FERRAMENTA: é aqui que você descobre se o projeto é individual ou coletivo, quais codificadores existem, se há gabarito (camada final), quais categorias podem filtrar documentos e quanto do corpus está sob censura. Se redaction.codings for maior que zero, avise o pesquisador, uma vez, de que a análise corre sobre texto parcialmente mascarado.',
    parameters: { type:'object', properties:{} },
  },
  {
    name: 'list_documents',
    description: 'Inventário do corpus. Use para escolher o que ler: os ids devolvidos aqui são os únicos aceitos por get_document_content, list_codings e list_memos. extraction_warning presente significa que o texto pode estar corrompido na origem (PDF sem camada de texto, sem espaços, fonte quebrada, OCR de baixa confiança) — não trate ruído de extração como achado sobre o corpus, e diga ao pesquisador qual documento é.',
    parameters: { type:'object', properties:{
      query: { type:'string', description:'filtra por nome; casamento parcial, ignora acento e caixa' },
      category_id: { type:'string', description:'id de categoria como retornado por get_project' },
      value: { type:'string', description:'valor da categoria a casar; use junto de category_id' },
      include_values: { type:'boolean', description:'traz os atributos preenchidos de cada documento (padrão falso)' },
      layer: QL_LAYER_PARAM,
      order: { type:'string', enum:['name','import','length','codings'], description:'padrão name' },
      offset: { type:'integer' }, limit: { type:'integer', description:'padrão 100, máximo 1000' },
    } },
  },
  {
    name: 'get_document_content',
    description: 'O texto de um documento, em janela. Este texto é o REFERENCIAL DE POSIÇÕES de todo o projeto: os offsets de list_codings e de search_corpus são posições de caractere nesta string, contadas do início do documento, inclusive quando você pediu uma janela do meio. Leia mais janelas antes de concluir sobre o documento inteiro, ou diga explicitamente que leu de start a end de total_length.',
    parameters: { type:'object', properties:{
      document_id: { type:'string', description:'id como retornado por list_documents' },
      start: { type:'integer', description:'offset inicial no documento; padrão 0' },
      length: { type:'integer', description:'tamanho da janela; padrão 30000, máximo 400000 (cabe um documento inteiro numa chamada)' },
    }, required:['document_id'] },
  },
  {
    name: 'search_corpus',
    description: 'Busca literal ou por expressão regular em todos os documentos visíveis. É o caminho para achar ocorrências de um termo que você já conhece; para descobrir que termos o corpus usa, chame antes suggest_terms. A busca roda sobre o texto MASCARADO, então termo censurado não é encontrável por construção: zero ocorrências nunca prova ausência no corpus original, e isso precisa ser dito se a contagem for o ponto da resposta.',
    parameters: { type:'object', properties:{
      query: { type:'string' },
      regex: { type:'boolean', description:'padrão falso' },
      case_sensitive: { type:'boolean', description:'padrão falso' },
      whole_word: { type:'boolean', description:'padrão falso; recomendado em termos curtos, senão "ato" casa dentro de "contrato"' },
      document_ids: { type:'array', items:{ type:'string' }, description:'restringe a documentos, ids de list_documents' },
      context: { type:'integer', description:'caracteres de cada lado; padrão 120, máximo 400' },
      offset: { type:'integer' }, limit: { type:'integer' },
    }, required:['query'] },
  },
  {
    name: 'suggest_terms',
    description: 'Descobre como o corpus FALA de um assunto. Devolve palavras e expressões extraídas do próprio texto dos documentos, ordenadas por proximidade de sentido com a consulta, calculada por um modelo de vetores que roda no navegador do pesquisador. Não devolve trechos: serve para você escolher os termos que vai passar a search_corpus. Se vier available falso, isso significa índice ausente, NÃO ausência de termos parecidos — não conclua nada a partir disso. Proximidade de vetor não é sinonímia: confirme com search_corpus antes de afirmar que o corpus trata do tema.',
    parameters: { type:'object', properties:{
      query: { type:'string', description:'o sentido procurado, em linguagem natural, curto' },
      limit: { type:'integer', description:'padrão 30, máximo 200' },
    }, required:['query'] },
  },
  {
    name: 'list_codes',
    description: 'O esquema de análise, como árvore. Use o campo path ao falar de um código com o pesquisador: nomes de subcódigos se repetem entre famílias. A contagem agregada soma cada trecho uma vez por código da cadeia, sem deduplicar (um trecho com dois subcódigos irmãos conta duas vezes na família), então não some contagens de níveis diferentes. Códigos de censura não aparecem aqui: eles não são categorias analíticas, e o que existe deles está declarado em get_project.',
    parameters: { type:'object', properties:{
      parent_id: { type:'string', description:'id de um código; ausente = árvore inteira a partir da raiz' },
      depth: { type:'integer', description:'níveis a devolver; padrão todos' },
      include_definition: { type:'boolean', description:'traz o memo de definição do código (padrão verdadeiro)' },
    } },
  },
  {
    name: 'list_codings',
    description: 'Os trechos codificados, com o texto de cada um. É a evidência: quando você afirma que o corpus diz algo, a citação sai daqui ou de get_document_content. O campo quote é o texto real do documento naquele intervalo — cite verbatim, e nunca atribua a um codificador o que veio de outro, nem trate trabalho individual de uma pessoa como posição da equipe. Um item é UM PEDAÇO DE TEXTO, não uma aplicação de código: quando o mesmo intervalo recebeu o mesmo código de mais de um codificador (ou de um codificador e do gabarito), o item traz coding_count e codings — uma entrada por aplicação, com autor e camada — no lugar dos campos author/layer do topo. Trechos de códigos de censura não são listados.',
    parameters: { type:'object', properties:{
      code_id: { type:'string', description:'id como retornado por list_codes' },
      include_descendants: { type:'boolean', description:'inclui a subárvore do código (padrão falso)' },
      document_id: { type:'string', description:'id como retornado por list_documents' },
      layer: QL_LAYER_PARAM,
      author: { type:'string', description:'nome como listado em get_project.coders' },
      offset: { type:'integer' }, limit: { type:'integer' },
    } },
  },
  {
    name: 'list_memos',
    description: 'As notas escritas pelo pesquisador: sobre o projeto, sobre um documento, sobre um código (definição) ou sobre um trecho. É raciocínio humano sobre o material, não material: cite como opinião do pesquisador, atribuída, nunca como achado do corpus. Se um memo contradiz o que você leu no texto, aponte a divergência em vez de escolher um lado.',
    parameters: { type:'object', properties:{
      scope: { type:'string', enum:['project','document','code','coding','all'], description:'padrão all' },
      target_id: { type:'string', description:'id do documento, código ou trecho, conforme o escopo' },
      offset: { type:'integer' }, limit: { type:'integer' },
    } },
  },
];

const qlNorm = s => String(s==null?'':s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const qlInt = (v, def, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
// envelope comum: total sempre declarado e next_offset dizendo se sobrou material (a conduta 5 do
// preambulo depende disso — sem o total, "li tudo" e indistinguivel de "li a primeira pagina").
function qlPage(items, a, extra){
  const off = qlInt(a.offset, 0, 0, Math.max(0, items.length));
  const lim = qlInt(a.limit, QL_LIMIT_DEF, 1, QL_LIMIT_MAX);
  const slice = items.slice(off, off+lim);
  return { items: slice, total: items.length, returned: slice.length,
    next_offset: (off+slice.length < items.length) ? off+slice.length : null, ...(extra||{}) };
}
// 'auto' = gabarito quando existir, senao individual (a regra do pickTransparencyLayer)
function qlLayer(rows, layer){
  const l = layer || 'auto';
  if(l === 'all') return rows;
  if(l === 'final' || l === 'individual') return rows.filter(r=>(r.layer||'individual')===l);
  return rows.filter(r=>(r.layer||'individual') === (rows.some(x=>x.layer==='final') ? 'final' : 'individual'));
}

/* O suggest_terms so pode devolver termo que o modelo TEM DIREITO DE LER, e o filtro e AQUI, na
   fronteira, nao na construcao do indice. Por que aqui: o indice semantico e construido do texto
   CRU e deve continuar sendo — ele tambem serve o "≈ termos" do LEITOR, que e tela de TRABALHO,
   onde a censura aparece (mesma assimetria de o leitor mostrar o texto enquanto o ATI mascara).
   Mascarar na construcao degradaria a busca do pesquisador para proteger OUTRA superficie, e
   ainda obrigaria a um segundo indice (o semVocabHash invalidaria o cache).
   O QUE ESTA EM JOGO: o indice nunca sai da maquina, mas o RETORNO desta ferramenta atravessa
   para o modelo, que em BYOK e a API do provedor. E um nome censurado e exatamente o n-grama
   repetido que o vocabulario melhor captura — entrega-lo aqui desmentiria o proprio QL_PREAMBLE,
   que a cada turno manda o modelo nao inferir o que esta sob a mascara.
   REGRA: sobrevive o termo que ainda ocorre no texto MASCARADO. Quem nao ocorre em lugar nenhum
   vivia so dentro de faixa censurada e sai. A contagem tambem passa a ser a do mascarado — dizer
   "10 ocorrencias" e o modelo achar 7 com search_corpus e a mesma incoerencia por outra porta.
   A OMISSAO E DECLARADA pelo chamador (campo `notes`): corte silencioso e o bug do materialDesc,
   em que o modelo le o recorte NOSSO como lacuna do corpus e conclui "isto nao e mencionado".
   Custo: uma varredura por termo sobre o corpus mascarado, limitada pelo `cap` do findMatches e
   pela contagem crua (o mascarado nunca tem mais ocorrencias que o cru). */
function qlVisibleTerms(termos, textosMascarados){
  const vivos = [];
  let omitidos = 0;
  for(const x of (termos || [])){
    // FAIL-CLOSED: termo que ja contenha o caractere de faixa nunca sai daqui. Hoje o
    // vocabulario nao consegue produzir um (o tokenizador do extractVocab so aceita letra),
    // mas a invariante "nada com censura atravessa" nao pode depender dessa suposicao — e
    // sem esta linha ele PASSARIA, porque o █ de fato ocorre no texto mascarado.
    if(String(x.w || '').includes('█')){ omitidos++; continue; }
    let n = 0;
    for(const texto of textosMascarados){
      if(!texto) continue;
      const r = findMatches(texto, x.w, { re:false, cs:false, whole:false }, Math.max(1, x.n || 1));
      n += (r.spans || []).length;
    }
    if(n > 0) vivos.push({ ...x, n });
    else omitidos++;
  }
  return { termos: vivos, omitidos };
}

/* Os executores. Devolvem SEMPRE um objeto serializavel; erro e { error, hint } com o tool que
   resolve — nunca excecao (o laco entrega o erro ao modelo, que precisa conseguir sair dele). */
function makeQlToolRunner(ctx){
  const { project, projectMode, docs, codes, cats, allCodings, allValues, memos, coders, pdfIdx } = ctx;
  const docById = {}; docs.forEach(d=>{ docById[d.id] = d; });
  const codeById = {}; codes.forEach(c=>{ codeById[c.id] = c; });
  const redIds = new Set(codes.filter(c=>c.is_redaction).map(c=>c.id));
  const codingsOfDoc = {}; allCodings.forEach(c=>{ (codingsOfDoc[c.document_id] = codingsOfDoc[c.document_id] || []).push(c); });
  const kidsOf = {}; codes.forEach(c=>{ if(c.parent_id) (kidsOf[c.parent_id] = kidsOf[c.parent_id] || []).push(c); });
  const memoOf = {}; (memos||[]).forEach(m=>{ memoOf[m.scope+':'+m.target_id] = m; });
  const agg = aggCounts(allCodings, codes);
  const direct = {}; allCodings.forEach(c=>{ direct[c.code_id] = (direct[c.code_id]||0)+1; });
  // o texto MASCARADO e a unica versao que sai daqui, e ele e o referencial dos offsets: o quote
  // de list_codings e uma FATIA dele, nao um campo mascarado a parte — assim os dois nao tem como
  // divergir (era o jeito de o quote e o content discordarem sobre onde a censura comeca).
  const maskCache = {};
  const maskedOf = id => {
    if(maskCache[id] == null) maskCache[id] = maskRedactedContent(docById[id]?.content || '', codingsOfDoc[id] || [], redIds, { fill:true });
    return maskCache[id];
  };
  const pathOf = id => { const o=[]; let c=codeById[id], g=0; while(c && g++<12){ o.unshift(c.name); c = c.parent_id ? codeById[c.parent_id] : null; } return o.join(': '); };
  const pageOf = (docId, off) => { const e = pdfIdx && pdfIdx[docId]; return (e && e.index) ? pageOfOffset(e.index, off) : null; };
  const pagesOf = docId => { const e = pdfIdx && pdfIdx[docId]; if(!(e && e.index && e.index.length)) return null; let mx=null; for(const f of e.index) if(f.page!=null && (mx==null || f.page>mx)) mx=f.page; return mx; };
  const subtree = id => { const out=new Set([id]); const walk=x=>(kidsOf[x]||[]).forEach(k=>{ out.add(k.id); walk(k.id); }); walk(id); return out; };
  const analyticCodings = allCodings.filter(c=>!redIds.has(c.code_id));
  // UM PEDACO DE TEXTO por linha, nao uma codificacao (recebe um grupo do groupCodingSpans, o mesmo
  // consolidador das telas do app): o mesmo intervalo marcado com o MESMO codigo por tres pessoas —
  // ou por alguem e pelo gabarito — sao tres codificacoes e UM pedaco, e repetir a citacao por
  // codificador enche a janela do modelo com o tamanho da EQUIPE. Nao e o caso raro: com camada
  // 'all', e com 'auto' num projeto coletivo que ainda nao reconciliou, e o normal.
  // Nada de autoria se perde (conduta 3 do preambulo): com UMA codificacao o item e o de sempre
  // (id/author/layer/created_at/memo no topo, forma inalterada, e e o caso dominante); com mais de
  // uma, esses campos saem para dentro de `codings`, uma entrada por aplicacao, com a nota de trecho
  // de cada uma. Assimetrico de proposito — a forma expandida no caso comum custaria MAIS tokens
  // que a duplicata que ela evita.
  const codingRow = g => {
    const c = g.rep;
    const m = maskedOf(c.document_id);
    const pg = pageOf(c.document_id, c.span_start);
    const base = { document_id:c.document_id, document_name:docById[c.document_id]?.name || '(documento removido)',
      code: { id:c.code_id, name:codeById[c.code_id]?.name || '(código removido)', path:pathOf(c.code_id) },
      span_start:c.span_start, span_end:c.span_end,
      // A lost anchor NEVER falls back to the stored quote: it cannot be verified against the
      // served (masked) text and may carry the censored text itself — finding 2 of the 1.4.21
      // adversarial review. The omission is declared in the list_codings envelope notes.
      quote: (c.span_start>=0 && c.span_end>c.span_start) ? m.slice(c.span_start, c.span_end) : '',
      ...(pg!=null ? { page:pg } : {}) };
    const quem = x => { const nota = memoOf['coding:'+x.id];
      return { layer: x.layer||'individual', author: authorLabel(x.author_name), created_at: x.created_at,
        ...(nota ? { memo:nota.content } : {}) }; };
    return g.items.length === 1
      ? { id:c.id, ...base, ...quem(c) }
      : { ...base, coding_count: g.items.length, codings: g.items.map(x=>({ id:x.id, ...quem(x) })) };
  };

  async function run(name, args){
    const a = args || {};
    switch(name){
      case 'get_project': {
        const redC = allCodings.filter(c=>redIds.has(c.code_id));
        let mascarados = 0;
        docs.forEach(d=>{
          const r = redC.filter(c=>c.document_id===d.id && c.span_end>c.span_start).map(c=>[c.span_start,c.span_end]).sort((x,y)=>x[0]-y[0]);
          let fim = -1; r.forEach(([s,e])=>{ mascarados += Math.max(0, e - Math.max(s, fim)); fim = Math.max(fim, e); });
        });
        return {
          name: project?.name || '(sem nome)',
          mode: projectMode === 'individual' ? 'individual' : 'collective',
          coders: (coders||[]).map(x=>x.name||x).filter(Boolean),
          layers_present: [...new Set(allCodings.map(c=>c.layer||'individual'))],
          counts: { documents: docs.length, codes: codes.filter(c=>!redIds.has(c.id)).length,
            codings: analyticCodings.length, corpus_chars: docs.reduce((s,d)=>s+(d.content||'').length, 0) },
          categories: (cats||[]).map(c=>({ id:c.id, name:c.name, kind:c.kind, ...((c.options||[]).length ? { options:c.options } : {}) })),
          redaction: { codes: redIds.size, codings: redC.length, chars_masked: mascarados,
            code_names: codes.filter(c=>redIds.has(c.id)).map(c=>c.name) },
        };
      }
      case 'list_documents': {
        let list = docs.slice();
        if(a.query){ const q = qlNorm(a.query); list = list.filter(d=>qlNorm(d.name).includes(q)); }
        if(a.category_id){
          const cat = (cats||[]).find(c=>c.id===a.category_id);
          if(!cat) return { error:'category_id desconhecido', hint:'as categorias e seus ids vêm de get_project' };
          const vals = qlLayer((allValues||[]).filter(v=>v.category_id===a.category_id), a.layer);
          const alvo = a.value == null ? null : qlNorm(a.value);
          const ok = new Set(vals.filter(v=>alvo==null ? String(v.value||'').trim() : qlNorm(v.value)===alvo).map(v=>v.document_id));
          list = list.filter(d=>ok.has(d.id));
        }
        const nC = {}; analyticCodings.forEach(c=>{ nC[c.document_id] = (nC[c.document_id]||0)+1; });
        const ordem = a.order || 'name';
        if(ordem==='name') list.sort((x,y)=>qlNorm(x.name).localeCompare(qlNorm(y.name)));
        else if(ordem==='length') list.sort((x,y)=>(y.content||'').length-(x.content||'').length);
        else if(ordem==='codings') list.sort((x,y)=>(nC[y.id]||0)-(nC[x.id]||0));
        return qlPage(list.map(d=>{
          const saude = extractionHealth(d.content||'', (pdfIdx && pdfIdx[d.id]) ? pdfIdx[d.id].index : null);
          const pgs = pagesOf(d.id);
          const row = { id:d.id, name:d.name, length:(d.content||'').length, codings_count:nC[d.id]||0 };
          if(pgs!=null) row.pages = pgs;
          if(!saude.ok) row.extraction_warning = saude.flags.join(' · ');
          if(a.include_values){
            row.values = qlLayer((allValues||[]).filter(v=>v.document_id===d.id), a.layer)
              .map(v=>({ category:(cats||[]).find(c=>c.id===v.category_id)?.name || '(categoria removida)',
                value:v.value, layer:v.layer||'individual', author:authorLabel(v.author_name) }));
          }
          return row;
        }), a);
      }
      case 'get_document_content': {
        const d = docById[a.document_id];
        if(!d) return { error:'document_id desconhecido', hint:'os ids vêm de list_documents; são identificadores, não nomes de documento' };
        const texto = maskedOf(d.id);
        const start = qlInt(a.start, 0, 0, texto.length);
        const end = Math.min(texto.length, start + qlInt(a.length, QL_WINDOW_DEF, 1, QL_WINDOW_MAX));
        const naJanela = (codingsOfDoc[d.id]||[]).filter(c=>!redIds.has(c.code_id) && c.span_start < end && c.span_end > start);
        return { document_id:d.id, document_name:d.name, content: texto.slice(start, end),
          start, end, total_length: texto.length, next_start: end < texto.length ? end : null,
          codings_in_window: qlLayer(naJanela, a.layer).map(c=>({ code:pathOf(c.code_id), span_start:c.span_start,
            span_end:c.span_end, layer:c.layer||'individual', author:authorLabel(c.author_name) })) };
      }
      case 'search_corpus': {
        if(!a.query || !String(a.query).trim()) return { error:'query vazia', hint:'passe o termo a procurar; para descobrir termos do corpus, use suggest_terms' };
        const alvo = a.document_ids?.length ? docs.filter(d=>a.document_ids.includes(d.id)) : docs;
        const ctxN = qlInt(a.context, 120, 0, 400);
        const hits = [];
        for(const d of alvo){
          const texto = maskedOf(d.id);
          const r = findMatches(texto, String(a.query), { re:!!a.regex, cs:!!a.case_sensitive, whole:!!a.whole_word }, 400);
          if(r.error) return { error:`expressão regular inválida: ${r.error}`, hint:'corrija o padrão ou repita a busca com regex falso (busca literal)' };
          for(const [s,e] of r.spans){
            const emCima = (codingsOfDoc[d.id]||[]).filter(c=>!redIds.has(c.code_id) && c.span_start < e && c.span_end > s);
            hits.push({ document_id:d.id, document_name:d.name, span_start:s, span_end:e,
              context: (s>ctxN?'…':'') + texto.slice(Math.max(0,s-ctxN), s) + '[[' + texto.slice(s,e) + ']]' + texto.slice(e, e+ctxN) + (e+ctxN<texto.length?'…':''),
              ...(pageOf(d.id,s)!=null ? { page:pageOf(d.id,s) } : {}),
              ...(emCima.length ? { codes:[...new Set(emCima.map(c=>pathOf(c.code_id)))] } : {}) });
          }
        }
        return qlPage(hits, a, { notes:['a busca roda sobre o texto mascarado: termo censurado não é encontrável'] });
      }
      case 'suggest_terms': {
        if(!a.query || !String(a.query).trim()) return { error:'query vazia', hint:'descreva em poucas palavras o sentido procurado' };
        try{
          const { rec } = await semLoadVocab(project.id, docs);
          if(!rec) return { available:false, reason:'o índice semântico ainda não foi construído neste projeto',
            hint:'diga ao pesquisador que ele pode construí-lo na busca do leitor ("≈ termos"); enquanto isso, use search_corpus com os termos que você já conhece' };
          const t = await semSuggest(project.id, String(a.query), docs, qlInt(a.limit, 30, 1, 200));
          // filtro de censura na fronteira — ver qlVisibleTerms
          const vis = qlVisibleTerms(t, docs.map(d=>maskedOf(d.id)));
          const notes = ['termos extraídos do próprio corpus; proximidade de sentido não é sinonímia'];
          if(vis.omitidos) notes.push(vis.omitidos + ' termo(s) sugerido(s) foram omitidos por só ocorrerem em trechos censurados. Isso é recorte deliberado do pesquisador, não ausência no corpus: não conclua que o assunto não é mencionado.');
          return { available:true, terms: vis.termos.map(x=>({ term:x.w, score:Math.round(x.cos*1000)/1000, occurrences:x.n })), notes };
        }catch(e){ return { available:false, reason:String(e?.message||e), hint:'siga com search_corpus' }; }
      }
      case 'list_codes': {
        const inclDef = a.include_definition !== false;
        const maxD = a.depth == null ? Infinity : qlInt(a.depth, 1, 1, 12);
        if(a.parent_id && !codeById[a.parent_id]) return { error:'parent_id desconhecido', hint:'os ids de código vêm de list_codes' };
        const monta = (c, d) => {
          const def = inclDef ? memoOf['code:'+c.id] : null;
          return { id:c.id, name:c.name, path:pathOf(c.id), depth:c.depth||0,
            count_direct: direct[c.id]||0, count_with_descendants: agg[c.id]||0,
            ...(def ? { definition:def.content } : {}),
            ...(d < maxD ? { children:(kidsOf[c.id]||[]).filter(k=>!redIds.has(k.id)).map(k=>monta(k, d+1)) } : {}) };
        };
        const raiz = a.parent_id ? (kidsOf[a.parent_id]||[]) : codes.filter(c=>!c.parent_id);
        return { items: raiz.filter(c=>!redIds.has(c.id)).map(c=>monta(c,1)), total: codes.filter(c=>!redIds.has(c.id)).length,
          notes: redIds.size ? [`${redIds.size} código(s) de censura fora desta árvore de propósito (ver get_project)`] : [] };
      }
      case 'list_codings': {
        let rows = analyticCodings;
        if(a.code_id){
          if(!codeById[a.code_id]) return { error:'code_id desconhecido', hint:'os ids de código vêm de list_codes' };
          const alvo = a.include_descendants ? subtree(a.code_id) : new Set([a.code_id]);
          rows = rows.filter(c=>alvo.has(c.code_id));
        }
        if(a.document_id){
          if(!docById[a.document_id]) return { error:'document_id desconhecido', hint:'os ids vêm de list_documents' };
          rows = rows.filter(c=>c.document_id===a.document_id);
        }
        rows = qlLayer(rows, a.layer);
        if(a.author){ const q = qlNorm(a.author); rows = rows.filter(c=>qlNorm(c.author_name).includes(q)); }
        rows = rows.slice().sort((x,y)=>x.document_id===y.document_id ? x.span_start-y.span_start : String(x.document_id).localeCompare(String(y.document_id)));
        // consolida DEPOIS dos filtros (author/layer recortam o que entra no grupo) e depois da
        // ordenacao (o agrupamento preserva a ordem de entrada). A consolidacao e DECLARADA: sem a
        // nota, o total daqui contradiria em silencio o counts.codings do get_project.
        const trechos = groupCodingSpans(rows);
        const notes = trechos.length < rows.length
          ? [`${rows.length} codificações do mesmo texto consolidadas em ${trechos.length} trecho(s): quando mais de um codificador (ou o gabarito) marca o MESMO intervalo com o MESMO código, o trecho vem uma vez e o campo codings lista cada aplicação, com autor e camada. O counts.codings de get_project conta aplicações, não trechos.`]
          : [];
        // Declared, never silent (same rule as every other partial result in this envelope):
        // a coding whose anchor is invalid ships with an empty quote, because the stored text
        // cannot be verified against the served document.
        const semAncora = trechos.filter(g=>!(g.rep.span_start>=0 && g.rep.span_end>g.rep.span_start)).length;
        if(semAncora) notes.push(`${semAncora} trecho(s) sem âncora válida no documento: o campo quote veio vazio porque o texto guardado não pôde ser conferido contra o texto servido. Não trate como citação perdida do corpus — é defeito de ancoragem do dado.`);
        return qlPage(trechos.map(codingRow), a, notes.length ? { notes } : null);
      }
      case 'list_memos': {
        const escopos = ['project','document','code','coding'];
        const alvo = (!a.scope || a.scope==='all') ? escopos : [a.scope];
        if(alvo.some(s=>!escopos.includes(s))) return { error:'scope inválido', hint:'use project, document, code, coding ou all' };
        let rows = (memos||[]).filter(m=>alvo.includes(m.scope));
        if(a.target_id) rows = rows.filter(m=>m.target_id===a.target_id);
        // codigos de censura: o nome do codigo ja e informacao sobre o que foi removido, mas a
        // DEFINICAO dele costuma descrever exatamente o dado sensivel — fica de fora, como os trechos
        rows = rows.filter(m=>!(m.scope==='code' && redIds.has(m.target_id)));
        return qlPage(rows.map(m=>({ scope:m.scope, target_id:m.target_id,
          target_name: m.scope==='document' ? (docById[m.target_id]?.name||'(documento removido)')
            : m.scope==='code' ? pathOf(m.target_id)
            : m.scope==='coding' ? (docById[allCodings.find(c=>c.id===m.target_id)?.document_id]?.name || '(trecho removido)')
            : (project?.name||'projeto'),
          content:m.content, author:authorLabel(m.author_name), updated_at:m.updated_at })), a);
      }
      default:
        return { error:`ferramenta desconhecida: ${name}`, hint:`as disponíveis são ${QL_TOOLS.map(t=>t.name).join(', ')}` };
    }
  }
  return { run };
}

export { QL_PREAMBLE, QL_TOOLS, QL_LIMIT_DEF, QL_LIMIT_MAX, QL_WINDOW_DEF, QL_WINDOW_MAX, makeQlToolRunner, unpackPdfIndex, findMatches, maskRedactedContent, brokenRedactionAnchor, REDACTION_DESYNC_LABEL, REDACTED_LABEL, ancestorsOf, aggCounts, groupCodingSpans, extractionHealth, pageOfOffset };
