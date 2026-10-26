// Excel e PDF da tela Passageiros e Receita — mesmo layout "por Unidade"
// do Relatório Comparativo e do Resumo por Linha (src/components/
// comparativo-view.tsx, resumo-view.tsx): título azul, subtítulo com
// período/filtros/"Gerado em", um bloco por Unidade (nome em negrito,
// sub-cabeçalho mesclado no comparativo, cabeçalho azul, 1ª coluna azul
// negrito, TOTAL em azul claro) e os resumos no fim. Cores em
// src/lib/report-style.ts.
//
// Cada tela monta as SEÇÕES (blocos de tabela) já ordenadas; aqui só se
// desenha. No PDF, rótulos usam "Dif"/"%" e nunca "Δ": a fonte padrão do
// jsPDF (Helvetica/WinAnsi) não tem esse glifo.

import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PdfOrientation } from "@/components/pdf-preview-dialog";
import { PDF_BLUE, PDF_BLUE_LIGHT, PDF_LINE_BLUE, XLSX_BLUE, XLSX_BLUE_LIGHT, XLSX_LINE_BLUE } from "@/lib/report-style";

export type Celula = string | number | null;

export type Secao = {
  /** Nome do bloco (ex.: "UNIDADE NORTE", "RESUMO POR UNIDADE"). */
  nome: string;
  /** Linha acima do cabeçalho com rótulos mesclados (métrica sobre A/B/Dif/%). */
  subCabecalho?: { rotulo: string; span: number }[];
  cabecalho: string[];
  /** Excel: valores numéricos crus; `null` = célula vazia. */
  corpo: Celula[][];
  total: Celula[];
  /** PDF: mesmas linhas já formatadas como texto. */
  corpoTxt: string[][];
  totalTxt: string[];
  /** Formato numérico do Excel por coluna (ex.: "#,##0", "0.0%"). */
  formatos: (string | undefined)[];
  /** Seções com a mesma chave usam a mesma largura de coluna no PDF. */
  grupoLargura: string;
};

export type Relatorio = { titulo: string; subtitulo: string; secoes: Secao[] };

const THIN = { style: "thin", color: { rgb: "B4B4B4" } };
const BORDA = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
const FILL_LIGHTBLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE_LIGHT } };

/** Uma aba no layout por Unidade. */
export function planilhaRelatorio(rel: Relatorio): XLSX.WorkSheet {
  type Tipo = "title" | "subtitle" | "blank" | "nome" | "subheader" | "header" | "body" | "total";
  const nCols = Math.max(...rel.secoes.map((s) => s.cabecalho.length));
  const linhas: Celula[][] = [];
  const tipos: Tipo[] = [];
  const formatos: ((string | undefined)[] | null)[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const push = (r: Celula[], t: Tipo, f: (string | undefined)[] | null = null) => { linhas.push(r); tipos.push(t); formatos.push(f); };
  const mesclarLinha = () => merges.push({ s: { r: linhas.length - 1, c: 0 }, e: { r: linhas.length - 1, c: nCols - 1 } });

  push([rel.titulo], "title"); mesclarLinha();
  push([rel.subtitulo], "subtitle"); mesclarLinha();
  push([], "blank");

  for (const s of rel.secoes) {
    push([s.nome], "nome"); mesclarLinha();
    if (s.subCabecalho) {
      const r: Celula[] = [];
      let c = 0;
      for (const sc of s.subCabecalho) {
        r.push(sc.rotulo, ...Array(sc.span - 1).fill(""));
        if (sc.span > 1) merges.push({ s: { r: linhas.length, c }, e: { r: linhas.length, c: c + sc.span - 1 } });
        c += sc.span;
      }
      push(r, "subheader");
    }
    push(s.cabecalho, "header");
    for (const r of s.corpo) push(r.map((v) => v ?? ""), "body", s.formatos);
    push(s.total.map((v) => v ?? ""), "total", s.formatos);
    push([], "blank");
  }

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!merges"] = merges;
  // Largura pelo conteúdo (cabeçalho e valores formatados) — com largura
  // fixa, rótulos de período como "16/02/26 Seg" ou "01 a 31/03/26 Dom"
  // eram cortados/quebrados no meio.
  const larg: number[] = Array.from({ length: nCols }, (_, i) => (i === 0 ? 12 : 8));
  for (const s of rel.secoes) {
    for (const row of [s.cabecalho, ...s.corpoTxt, s.totalTxt]) {
      row.forEach((v, c) => { larg[c] = Math.max(larg[c], String(v ?? "").length + 2); });
    }
  }
  ws["!cols"] = larg.map((w) => ({ wch: Math.min(w, 30) }));

  linhas.forEach((row, r) => {
    const t = tipos[r];
    if (t === "blank") return;
    for (let c = 0; c < row.length; c++) {
      const cell = (ws as any)[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      if (t === "title") cell.s = { font: { bold: true, sz: 13, color: { rgb: XLSX_LINE_BLUE } }, alignment: { horizontal: "center" } };
      else if (t === "subtitle") cell.s = { font: { sz: 9, color: { rgb: "666666" } }, alignment: { horizontal: "center" } };
      else if (t === "nome") cell.s = { font: { bold: true, sz: 11 }, alignment: { horizontal: "left" } };
      else if (t === "subheader") cell.s = { font: { bold: true }, alignment: { horizontal: "center" } };
      else if (t === "header") cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL_BLUE, alignment: { horizontal: "center" }, border: BORDA };
      else if (t === "body") cell.s = { font: c === 0 ? { bold: true, color: { rgb: XLSX_LINE_BLUE } } : { color: { rgb: "000000" } }, alignment: { horizontal: "center" }, border: BORDA };
      else if (t === "total") cell.s = { font: { bold: true, color: { rgb: "000000" } }, fill: FILL_LIGHTBLUE, alignment: { horizontal: "center" }, border: BORDA };
      const z = formatos[r]?.[c];
      if (z && typeof cell.v === "number") cell.z = z;
    }
  });
  return ws;
}

export function salvarExcel(abas: { nome: string; ws: XLSX.WorkSheet }[], arquivo: string) {
  const wb = XLSX.utils.book_new();
  for (const a of abas) XLSX.utils.book_append_sheet(wb, a.ws, a.nome.slice(0, 31));
  XLSX.writeFile(wb, arquivo);
}

/** PDF no layout por Unidade. Largura das colunas medida pelo conteúdo
 *  (igual por `grupoLargura`) e escalada pra caber na largura da página. */
export function pdfRelatorio(rel: Relatorio, orientation: PdfOrientation): jsPDF {
  const probe = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = probe.internal.pageSize.getWidth();
  const pageH = probe.internal.pageSize.getHeight();
  const HEADER_H = 16;
  const usableW = pageW - 16 - 3;

  function drawHeader(d: jsPDF) {
    d.setTextColor(...PDF_LINE_BLUE); d.setFont("helvetica", "bold"); d.setFontSize(11);
    d.text(rel.titulo, pageW / 2, 8, { align: "center" });
    d.setFontSize(6.8); d.setTextColor(90); d.setFont("helvetica", "normal");
    d.text(rel.subtitulo, pageW / 2, 13, { align: "center", maxWidth: pageW - 20 });
    d.setDrawColor(...PDF_LINE_BLUE); d.setLineWidth(0.5);
    d.line(10, 15, pageW - 10, 15);
    d.setTextColor(20);
  }

  // Largura natural (em negrito: cabeçalho, total e 1ª coluna são bold).
  const BASE_FONT = 6.5;
  probe.setFontSize(BASE_FONT);
  probe.setFont("helvetica", "bold");
  const larguras = new Map<string, number[]>();
  for (const s of rel.secoes) {
    const w = larguras.get(s.grupoLargura) ?? new Array(s.cabecalho.length).fill(0);
    for (const row of [s.cabecalho, ...s.corpoTxt, s.totalTxt]) {
      row.forEach((v, c) => { w[c] = Math.max(w[c] ?? 0, probe.getTextWidth(String(v ?? "")) + 3.2); });
    }
    larguras.set(s.grupoLargura, w);
  }
  const maior = Math.max(...Array.from(larguras.values(), (w) => w.reduce((a, b) => a + b, 0)));
  const zoom = Math.max(0.45, Math.min(1.3, usableW / maior));
  const fontSize = BASE_FONT * zoom;

  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  drawHeader(doc);
  let y = HEADER_H + 3;
  const branco: [number, number, number] = [255, 255, 255];
  const preto: [number, number, number] = [20, 20, 20];

  for (const s of rel.secoes) {
    const widths = larguras.get(s.grupoLargura)!.map((w) => w * zoom);
    const totalW = widths.reduce((a, b) => a + b, 0);
    const marginLeft = Math.max(5, (pageW - totalW) / 2);
    // -0.5mm: sem folga, o arredondamento das bordas estourava ~0,1mm.
    const marginRight = Math.max(5, pageW - totalW - marginLeft - 0.5);
    const columnStyles: Record<number, { cellWidth: number; halign: "center" }> = {};
    widths.forEach((w, i) => { columnStyles[i] = { cellWidth: w, halign: "center" }; });
    const nCols = s.cabecalho.length;

    const head: any[][] = [[{ content: s.nome, colSpan: nCols, styles: { halign: "left", fontStyle: "bold", fillColor: branco, textColor: preto } }]];
    if (s.subCabecalho) {
      head.push(s.subCabecalho.map((sc) => ({ content: sc.rotulo, colSpan: sc.span, styles: { halign: "center", fontStyle: "bold", fillColor: branco, textColor: preto } })));
    }
    head.push(s.cabecalho.map((c) => ({ content: c, styles: { fillColor: PDF_BLUE, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" } })));

    autoTable(doc, {
      startY: y,
      head,
      body: s.corpoTxt,
      foot: [s.totalTxt],
      styles: { fontSize, cellPadding: 1.2 * zoom, valign: "middle", halign: "center", lineColor: [180, 180, 180], lineWidth: 0.18 },
      columnStyles,
      footStyles: { fillColor: PDF_BLUE_LIGHT, textColor: [0, 0, 0], fontStyle: "bold" },
      margin: { left: marginLeft, right: marginRight, top: HEADER_H + 3, bottom: 12 },
      theme: "grid",
      tableWidth: "wrap",
      showFoot: "lastPage",
      pageBreak: "avoid",
      rowPageBreak: "avoid",
      didDrawPage: () => drawHeader(doc),
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 0) {
          data.cell.styles.textColor = PDF_LINE_BLUE;
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(120);
    doc.text(`Página ${i} de ${pages}`, pageW - 10, pageH - 5, { align: "right" });
  }
  return doc;
}
