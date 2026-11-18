import { AgentPdfReportSpec } from '../types';

function sanitizePdfAscii(raw: unknown): string {
  return String(raw ?? '')
    .replace(/₹/g, 'INR ')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/¥/g, 'JPY ')
    .replace(/[—–]/g, '-')
    .replace(/[•·]/g, '*')
    .replace(/[✓✔]/g, '[OK]')
    .replace(/→/g, '->')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfText(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = sanitizePdfAscii(text);
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      if (word.length <= maxChars) {
        current = word;
      } else {
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars));
        }
      }
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      if (word.length <= maxChars) {
        current = word;
      } else {
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars));
        }
        current = '';
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function encodeAsciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

class PdfPageCanvas {
  private pages: string[][] = [[]];
  private pageIndex = 0;
  public cursorY = 742;
  private readonly pageWidth = 612;
  private readonly pageHeight = 792;
  private readonly marginLeft = 42;
  private readonly marginRight = 42;
  private readonly bottomLimit = 58;

  get contentWidth(): number {
    return this.pageWidth - this.marginLeft - this.marginRight;
  }

  get totalPages(): number {
    return this.pages.length;
  }

  ensureSpace(requiredPt: number): void {
    if (this.cursorY - requiredPt < this.bottomLimit) {
      this.newPage();
    }
  }

  newPage(): void {
    this.pages.push([]);
    this.pageIndex = this.pages.length - 1;
    this.cursorY = this.pageHeight - 52;
    this.drawRect(0, this.pageHeight - 28, this.pageWidth, 28, '0.965 0.965 0.957');
    this.drawLine(0, this.pageHeight - 28, this.pageWidth, this.pageHeight - 28, '0.898 0.898 0.898', 0.75);
    this.drawText(this.marginLeft, this.pageHeight - 18, 'LIDDY AI CFO — CONTINUATION', 8, 'F2', '0.35 0.35 0.38');
  }

  private pushOp(op: string): void {
    this.pages[this.pageIndex].push(op);
  }

  drawRect(x: number, y: number, w: number, h: number, fillRgb: string, strokeRgb?: string, lineWidth = 0.75): void {
    const ops = [
      'q',
      `${fillRgb} rg`,
      ...(strokeRgb ? [`${strokeRgb} RG`, `${lineWidth} w`, `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`] : [`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`]),
      'Q',
    ];
    this.pushOp(ops.join('\n'));
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, strokeRgb = '0.88 0.88 0.88', lineWidth = 0.75): void {
    this.pushOp(
      `q\n${strokeRgb} RG\n${lineWidth.toFixed(2)} w\n${x1.toFixed(2)} ${y1.toFixed(2)} m\n${x2.toFixed(2)} ${y2.toFixed(2)} l\nS\nQ`
    );
  }

  drawText(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    fontKey: 'F1' | 'F2' | 'F3' = 'F1',
    rgb = '0.07 0.07 0.09'
  ): void {
    const safe = escapePdfText(sanitizePdfAscii(text));
    if (!safe) return;
    this.pushOp(`BT\n/${fontKey} ${fontSize} Tf\n${rgb} rg\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${safe}) Tj\nET`);
  }

  drawHeaderBanner(title: string, subtitle?: string, generatedAt?: string): void {
    // Crisp dark top accent header banner
    this.drawRect(0, this.pageHeight - 108, this.pageWidth, 108, '0.067 0.071 0.094');
    this.drawText(this.marginLeft, this.pageHeight - 32, 'LIDDY AI CFO  |  FINANCIAL INTELLIGENCE BRIEF', 8.5, 'F3', '0.56 0.64 0.96');

    const titleLines = wrapText(title || 'Financial Intelligence Report', 54).slice(0, 2);
    let y = this.pageHeight - 54;
    for (const line of titleLines) {
      this.drawText(this.marginLeft, y, line, 17, 'F2', '1 1 1');
      y -= 20;
    }

    const subText = subtitle
      ? `${sanitizePdfAscii(subtitle)}${generatedAt ? `   |   ${sanitizePdfAscii(generatedAt)}` : ''}`
      : generatedAt
      ? `Generated ${sanitizePdfAscii(generatedAt)}`
      : 'Autonomous CFO Audit & Document Intelligence';
    const clippedSub = subText.slice(0, 94);
    this.drawText(this.marginLeft, this.pageHeight - 94, clippedSub, 9, 'F1', '0.78 0.80 0.86');

    this.cursorY = this.pageHeight - 128;
  }

  drawKpiRow(kpis: Array<{ label: string; value: string }>): void {
    const items = kpis.slice(0, 4);
    if (items.length === 0) return;
    this.ensureSpace(64);
    const gap = 10;
    const cardW = (this.contentWidth - gap * (items.length - 1)) / items.length;
    const cardH = 50;
    const yTop = this.cursorY;

    items.forEach((kpi, idx) => {
      const x = this.marginLeft + idx * (cardW + gap);
      this.drawRect(x, yTop - cardH, cardW, cardH, '0.972 0.972 0.965', '0.88 0.88 0.88', 0.75);
      const labelSafe = sanitizePdfAscii(kpi.label).slice(0, 22).toUpperCase();
      const valueSafe = sanitizePdfAscii(kpi.value).slice(0, 18);
      this.drawText(x + 10, yTop - 18, labelSafe, 7.5, 'F3', '0.42 0.43 0.47');
      this.drawText(x + 10, yTop - 37, valueSafe, 13, 'F2', '0.07 0.07 0.09');
    });

    this.cursorY = yTop - cardH - 18;
  }

  drawSectionHeading(heading: string): void {
    this.ensureSpace(40);
    this.drawText(this.marginLeft, this.cursorY, sanitizePdfAscii(heading).slice(0, 76), 12, 'F2', '0.07 0.07 0.09');
    this.drawLine(this.marginLeft, this.cursorY - 6, this.pageWidth - this.marginRight, this.cursorY - 6, '0.86 0.86 0.88', 0.9);
    this.cursorY -= 20;
  }

  drawBullets(bullets: string[]): void {
    for (const bullet of bullets) {
      const lines = wrapText(bullet, 82);
      if (lines.length === 0) continue;
      this.ensureSpace(lines.length * 14 + 6);
      lines.forEach((line, i) => {
        const prefix = i === 0 ? '*  ' : '   ';
        this.drawText(this.marginLeft + 4, this.cursorY, `${prefix}${line}`, 9.5, 'F1', '0.20 0.22 0.26');
        this.cursorY -= 13.5;
      });
      this.cursorY -= 3;
    }
    this.cursorY -= 6;
  }

  drawTable(headers: string[], rows: Array<Array<string | number>>): void {
    if (!headers.length) return;
    const colCount = Math.min(headers.length, 6);
    const activeHeaders = headers.slice(0, colCount);
    const colW = this.contentWidth / colCount;
    const maxCellChars = Math.max(8, Math.floor((colW - 10) / 5.2));

    const drawHeaderRow = () => {
      this.ensureSpace(44);
      this.drawRect(this.marginLeft, this.cursorY - 20, this.contentWidth, 20, '0.945 0.949 0.960', '0.86 0.86 0.88', 0.75);
      activeHeaders.forEach((h, idx) => {
        const text = sanitizePdfAscii(h).slice(0, maxCellChars).toUpperCase();
        this.drawText(this.marginLeft + idx * colW + 6, this.cursorY - 13.5, text, 7.5, 'F2', '0.18 0.20 0.25');
      });
      this.cursorY -= 20;
    };

    drawHeaderRow();

    rows.slice(0, 60).forEach((row, rIdx) => {
      if (this.cursorY - 22 < this.bottomLimit) {
        this.newPage();
        drawHeaderRow();
      }
      const rowBg = rIdx % 2 === 1 ? '0.985 0.985 0.982' : '1 1 1';
      this.drawRect(this.marginLeft, this.cursorY - 19, this.contentWidth, 19, rowBg, '0.91 0.91 0.92', 0.5);
      for (let c = 0; c < colCount; c++) {
        const raw = row[c] !== undefined ? row[c] : '';
        const text = sanitizePdfAscii(raw).slice(0, maxCellChars);
        this.drawText(this.marginLeft + c * colW + 6, this.cursorY - 13, text, 8.5, 'F1', '0.14 0.16 0.20');
      }
      this.cursorY -= 19;
    });

    this.cursorY -= 14;
  }

  buildPdfBytes(): Uint8Array {
    const pageCount = this.pages.length;
    // Stamp footers on every page
    this.pages.forEach((ops, idx) => {
      ops.push(`q\n0.88 0.88 0.90 RG\n0.6 w\n${this.marginLeft} 40 m\n${this.pageWidth - this.marginRight} 40 l\nS\nQ`);
      const footerLeft = 'Liddy Financial Workspace  |  Confidential Executive Report';
      const footerRight = `Page ${idx + 1} of ${pageCount}`;
      ops.push(`BT\n/F3 7.5 Tf\n0.48 0.49 0.54 rg\n1 0 0 1 ${this.marginLeft} 26 Tm\n(${escapePdfText(footerLeft)}) Tj\nET`);
      ops.push(`BT\n/F3 7.5 Tf\n0.48 0.49 0.54 rg\n1 0 0 1 ${this.pageWidth - this.marginRight - 56} 26 Tm\n(${escapePdfText(footerRight)}) Tj\nET`);
    });

    // Assemble PDF objects:
    // 1: Catalog
    // 2: Pages
    // 3: Font F1 Helvetica
    // 4: Font F2 Helvetica-Bold
    // 5: Font F3 Courier
    // Then pairs per page: pageObj (6 + i*2), contentObj (7 + i*2)
    const objects: string[] = [];
    const pageObjectIds: number[] = [];

    for (let i = 0; i < pageCount; i++) {
      pageObjectIds.push(6 + i * 2);
    }

    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);
    objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');
    objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');

    for (let i = 0; i < pageCount; i++) {
      const pageObjId = 6 + i * 2;
      const contentObjId = 7 + i * 2;
      const stream = this.pages[i].join('\n');
      objects.push(
        `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
      );
      objects.push(
        `${contentObjId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
      );
    }

    const header = '%PDF-1.4\n';
    const chunks: string[] = [header];
    const offsets: number[] = [0];
    let byteCursor = header.length;

    for (const objStr of objects) {
      offsets.push(byteCursor);
      chunks.push(objStr);
      byteCursor += objStr.length;
    }

    const xrefStart = byteCursor;
    const totalObjs = objects.length + 1;
    let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    return encodeAsciiBytes(chunks.join('') + xref + trailer);
  }
}

export function buildAgentPdfBlob(report: AgentPdfReportSpec): Blob {
  const canvas = new PdfPageCanvas();
  canvas.drawHeaderBanner(report.title, report.subtitle, report.generatedAt);

  if (report.kpis && report.kpis.length > 0) {
    canvas.drawKpiRow(report.kpis);
  }

  for (const section of report.sections || []) {
    canvas.drawSectionHeading(section.heading);
    if (section.bullets && section.bullets.length > 0) {
      canvas.drawBullets(section.bullets);
    }
    if (section.table && section.table.headers?.length > 0) {
      canvas.drawTable(section.table.headers, section.table.rows || []);
    }
  }

  const pdfBytes = canvas.buildPdfBytes();
  const buffer = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(buffer).set(pdfBytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

export function downloadAgentPdfReport(report: AgentPdfReportSpec): void {
  const blob = buildAgentPdfBlob(report);
  const safeName = (report.filename || 'liddy-financial-report.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}
