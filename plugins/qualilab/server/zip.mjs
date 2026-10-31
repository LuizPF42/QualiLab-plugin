// Leitor MINIMO de zip para o .qualilab — só o que o formato nosso usa (STORE e DEFLATE),
// para o servidor não carregar dependência nenhuma: o único runtime é o Node que o Claude
// Desktop já embute. O .qualilab zipado é gerado pelo JSZip com opções padrão (ver
// writeQualilabBlob no index.html): project.json em DEFLATE, pdfs/*.pdf em STORE,
// pdfindex/*.json em DEFLATE. Sem zip64 (só apareceria acima de 4 GB).
//
// A .qualilab IS A FILE SOMEONE SENT. The server asks only for the entries it uses (the PDFs are
// never touched), every offset is checked against the buffer, and inflating has a budget per entry
// and for the archive. What is refused says why: that sentence is what the model and the researcher
// get to read, and a RangeError from Buffer tells them nothing.
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;      // End of Central Directory
const CEN = 0x02014b50;       // entrada do diretório central
const LOC = 0x04034b50;       // cabeçalho local

// Next to V8's limit for a string: above it JSON.parse would fail anyway, after the memory was spent
const MAX_ENTRADA = 512 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;

/** Buffer do zip -> Map(nome -> Buffer descomprimido), só das entradas que `quer(nome)` aceita. */
export function lerZip(buf, quer = () => true, { maxEntrada = MAX_ENTRADA, maxTotal = MAX_TOTAL } = {}) {
  const corrompido = (onde) => new Error(`zip corrompido (${onde}): isto é um .qualilab inteiro?`);
  const dentro = (ini, fim, onde) => { if (ini < 0 || fim > buf.length || fim < ini) throw corrompido(onde); };
  const u16 = (o, onde) => { dentro(o, o + 2, onde); return buf.readUInt16LE(o); };
  const u32 = (o, onde) => { dentro(o, o + 4, onde); return buf.readUInt32LE(o); };

  // o EOCD fica no fim; o comentário do zip (raro) empurra a assinatura para trás, então varre
  let i = buf.length - 22;
  const piso = Math.max(0, buf.length - 22 - 65535);
  while (i >= piso && buf.readUInt32LE(i) !== EOCD) i--;
  if (i < piso) throw new Error("zip sem End of Central Directory: isto é um .qualilab?");

  const total = u16(i + 10, "fim do diretório");
  let off = u32(i + 16, "fim do diretório");
  const out = new Map();
  let gasto = 0;

  for (let n = 0; n < total; n++) {
    if (u32(off, "diretório central") !== CEN) throw new Error("diretório central corrompido no item " + n);
    const metodo = u16(off + 10, "diretório central");
    const compSize = u32(off + 20, "diretório central");
    const nomeLen = u16(off + 28, "diretório central");
    const extraLen = u16(off + 30, "diretório central");
    const comentLen = u16(off + 32, "diretório central");
    const lho = u32(off + 42, "diretório central");
    dentro(off + 46, off + 46 + nomeLen, "nome de entrada");
    const nome = buf.toString("utf8", off + 46, off + 46 + nomeLen);
    off += 46 + nomeLen + extraLen + comentLen;
    if (!quer(nome)) continue;

    // os tamanhos de nome/extra do cabeçalho LOCAL podem diferir dos do central (o extra costuma)
    if (u32(lho, nome) !== LOC) throw new Error("cabeçalho local corrompido em " + nome);
    const lNomeLen = u16(lho + 26, nome);
    const lExtraLen = u16(lho + 28, nome);
    const ini = lho + 30 + lNomeLen + lExtraLen;
    dentro(ini, ini + compSize, nome);
    const dados = buf.subarray(ini, ini + compSize);

    let cheio;
    if (metodo === 0) cheio = dados;
    else if (metodo === 8) {
      const teto = Math.min(maxEntrada, maxTotal - gasto);
      if (teto < 1) throw new Error(`${nome} expande além do limite de leitura: arquivo recusado`);   // zlib refuses a limit of 0
      try { cheio = inflateRawSync(dados, { maxOutputLength: teto }); }
      catch (e) {
        if (e.code === "ERR_BUFFER_TOO_LARGE") throw new Error(`${nome} expande além do limite de leitura: arquivo recusado`);
        throw corrompido(nome);
      }
    }
    else throw new Error(`método de compressão ${metodo} em ${nome} (só STORE e DEFLATE)`);
    gasto += cheio.length;
    if (gasto > maxTotal || cheio.length > maxEntrada) throw new Error(`${nome} expande além do limite de leitura: arquivo recusado`);
    out.set(nome, cheio);
  }
  return out;
}
