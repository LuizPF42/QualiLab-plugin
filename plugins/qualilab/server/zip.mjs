// Leitor MINIMO de zip para o .qualilab — só o que o formato nosso usa (STORE e DEFLATE),
// para o servidor não carregar dependência nenhuma: o único runtime é o Node que o Claude
// Desktop já embute. O .qualilab zipado é gerado pelo JSZip com opções padrão (ver
// writeQualilabBlob no index.html): project.json em DEFLATE, pdfs/*.pdf em STORE,
// pdfindex/*.json em DEFLATE. Sem zip64 (só apareceria acima de 4 GB).
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;      // End of Central Directory
const CEN = 0x02014b50;       // entrada do diretório central
const LOC = 0x04034b50;       // cabeçalho local

/** Buffer do zip -> Map(nome -> Buffer descomprimido). */
export function lerZip(buf) {
  // o EOCD fica no fim; o comentário do zip (raro) empurra a assinatura para trás, então varre
  let i = buf.length - 22;
  const piso = Math.max(0, buf.length - 22 - 65535);
  while (i >= piso && buf.readUInt32LE(i) !== EOCD) i--;
  if (i < piso) throw new Error("zip sem End of Central Directory: isto é um .qualilab?");

  const total = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const out = new Map();

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== CEN) throw new Error("diretório central corrompido no item " + n);
    const metodo = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nomeLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const comentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const nome = buf.toString("utf8", off + 46, off + 46 + nomeLen);

    // os tamanhos de nome/extra do cabeçalho LOCAL podem diferir dos do central (o extra costuma)
    if (buf.readUInt32LE(lho) !== LOC) throw new Error("cabeçalho local corrompido em " + nome);
    const lNomeLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dados = buf.subarray(lho + 30 + lNomeLen + lExtraLen,
                               lho + 30 + lNomeLen + lExtraLen + compSize);

    if (metodo === 0) out.set(nome, dados);
    else if (metodo === 8) out.set(nome, inflateRawSync(dados));
    else throw new Error(`método de compressão ${metodo} em ${nome} (só STORE e DEFLATE)`);

    off += 46 + nomeLen + extraLen + comentLen;
  }
  return out;
}
