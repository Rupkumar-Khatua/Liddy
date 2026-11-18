import PptxGenJS from 'pptxgenjs';
import { SlideFontStyle, SlideItem, SlideTheme } from '../types';
import { triggerFileDownload } from '../services/emailReceiptService';

export interface SlideThemePalette {
  label: string;
  bgHex: string;
  textHex: string;
  mutedHex: string;
  accentHex: string;
  cardHex: string;
  borderHex: string;
}

function sanitizeSafeFileName(raw: string): string {
  return (raw || 'financial-presentation').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'presentation';
}

function stripHash(hex: string): string {
  return String(hex || '#FFFFFF').replace('#', '').toUpperCase();
}

function hexToPdfRgb(hex: string): string {
  const clean = stripHash(hex);
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return `${(Number.isFinite(r) ? r : 1).toFixed(3)} ${(Number.isFinite(g) ? g : 1).toFixed(3)} ${(Number.isFinite(b) ? b : 1).toFixed(3)}`;
}

function sanitizePdfAscii(raw: unknown): string {
  return String(raw ?? '')
    .replace(/₹/g, 'INR ')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/¥/g, 'JPY ')
    .replace(/[—–]/g, '-')
    .replace(/[•·]/g, ' - ')
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

/**
 * Generates a 16:9 landscape (960 x 540 pt) PDF presentation respecting theme colors, typography, metrics, and charts.
 */
export function buildSlidesPdfBlob(
  slides: SlideItem[],
  boardTitle: string,
  defaultTheme: SlideTheme,
  defaultFontStyle: SlideFontStyle,
  themeMap: Record<SlideTheme, SlideThemePalette>,
  authorName = 'Workspace Member'
): Blob {
  const pageWidth = 960;
  const pageHeight = 540;
  const safeSlides = slides.length > 0 ? slides : [];
  const pageStreams: string[] = [];

  safeSlides.forEach((slide, idx) => {
    const ops: string[] = [];
    const theme = themeMap[slide.theme || defaultTheme] || themeMap.ivory;
    const fontStyle = slide.fontStyle || defaultFontStyle;
    const bodyFontKey = fontStyle === 'editorial_serif' ? 'F3' : fontStyle === 'mono_quant' ? 'F5' : 'F1';
    const boldFontKey = fontStyle === 'editorial_serif' ? 'F4' : fontStyle === 'mono_quant' ? 'F6' : 'F2';

    const bgRgb = hexToPdfRgb(theme.bgHex);
    const cardRgb = hexToPdfRgb(theme.cardHex);
    const borderRgb = hexToPdfRgb(theme.borderHex);
    const textRgb = hexToPdfRgb(theme.textHex);
    const mutedRgb = hexToPdfRgb(theme.mutedHex);
    const accentRgb = hexToPdfRgb(theme.accentHex);

    const drawRect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string, lw = 0.8) => {
      ops.push('q');
      ops.push(`${fill} rg`);
      if (stroke) {
        ops.push(`${stroke} RG\n${lw.toFixed(2)} w\n${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
      } else {
        ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
      }
      ops.push('Q');
    };

    const drawLine = (x1: number, y1: number, x2: number, y2: number, stroke: string, lw = 0.8) => {
      ops.push(`q\n${stroke} RG\n${lw.toFixed(2)} w\n${x1.toFixed(2)} ${y1.toFixed(2)} m\n${x2.toFixed(2)} ${y2.toFixed(2)} l\nS\nQ`);
    };

    const drawText = (x: number, y: number, txt: string, size: number, fKey: string, rgb: string) => {
      const safe = escapePdfText(sanitizePdfAscii(txt));
      if (!safe) return;
      ops.push(`BT\n/${fKey} ${size} Tf\n${rgb} rg\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${safe}) Tj\nET`);
    };

    // Slide full background
    drawRect(0, 0, pageWidth, pageHeight, bgRgb);
    // Subtle top accent hairline
    drawRect(0, pageHeight - 5, pageWidth, 5, accentRgb);

    // Top Header Row
    const marginX = 48;
    const kicker = sanitizePdfAscii(boardTitle || 'Financial Presentation').slice(0, 56).toUpperCase();
    const counter = `${String(idx + 1).padStart(2, '0')} / ${String(safeSlides.length).padStart(2, '0')}`;
    drawText(marginX, pageHeight - 36, kicker, 9.5, 'F6', accentRgb);
    drawText(pageWidth - marginX - 48, pageHeight - 36, counter, 9.5, 'F5', mutedRgb);

    // Check right side panel needs
    const bars = Array.isArray(slide.chartBars) && slide.chartBars.length > 0 ? slide.chartBars.slice(0, 5) : [];
    const hasSidePanel = Boolean(slide.metricHighlight) || bars.length > 0;
    const leftAreaWidth = hasSidePanel ? 570 : pageWidth - marginX * 2;
    const sideX = marginX + leftAreaWidth + 28;
    const sideW = pageWidth - marginX - sideX;

    // Slide Title
    let cursorY = pageHeight - 78;
    const titleLines = wrapText(slide.title || 'Untitled Slide', hasSidePanel ? 38 : 58).slice(0, 2);
    for (const line of titleLines) {
      drawText(marginX, cursorY, line, 24, boldFontKey, textRgb);
      cursorY -= 30;
    }

    // Slide Subtitle
    if (slide.subtitle) {
      const subLines = wrapText(slide.subtitle, hasSidePanel ? 62 : 90).slice(0, 2);
      for (const sLine of subLines) {
        drawText(marginX, cursorY + 2, sLine, 12, bodyFontKey, mutedRgb);
        cursorY -= 17;
      }
    }

    cursorY -= 16;

    // Bullet Cards inside left/main content area
    const bullets = (slide.bullets || []).filter(Boolean).slice(0, 6);
    const cols = bullets.length >= 4 && !hasSidePanel ? 2 : 1;
    const cardGap = 12;
    const cardW = cols === 2 ? (leftAreaWidth - cardGap) / 2 : leftAreaWidth;
    let cardCursorY = cursorY;

    bullets.forEach((bullet, bIdx) => {
      const maxChars = cols === 2 ? 38 : hasSidePanel ? 62 : 94;
      const bLines = wrapText(bullet, maxChars).slice(0, 3);
      const cardH = Math.max(46, 22 + bLines.length * 14);
      const colIdx = cols === 2 ? bIdx % 2 : 0;
      const x = marginX + colIdx * (cardW + cardGap);

      if (cardCursorY - cardH > 64) {
        drawRect(x, cardCursorY - cardH, cardW, cardH, cardRgb, borderRgb, 0.8);
        drawText(x + 14, cardCursorY - 17, `0${bIdx + 1}`, 8.5, 'F6', accentRgb);
        let textY = cardCursorY - 32;
        for (const bl of bLines) {
          drawText(x + 14, textY, bl, 10.5, bodyFontKey, textRgb);
          textY -= 14;
        }
      }

      if (cols === 1 || colIdx === 1 || bIdx === bullets.length - 1) {
        cardCursorY -= cardH + 10;
      }
    });

    // Right Side Panels (Metric Highlight + Quantitative Bars)
    if (hasSidePanel && sideW > 140) {
      let sideCursorY = pageHeight - 78;

      if (slide.metricHighlight) {
        const kpiH = 88;
        drawRect(sideX, sideCursorY - kpiH, sideW, kpiH, cardRgb, borderRgb, 0.9);
        drawText(sideX + 16, sideCursorY - 22, 'KEY FIGURE', 8.5, 'F6', mutedRgb);
        const metricText = sanitizePdfAscii(slide.metricHighlight).slice(0, 22);
        drawText(sideX + 16, sideCursorY - 56, metricText, 21, boldFontKey, accentRgb);
        sideCursorY -= kpiH + 14;
      }

      if (bars.length > 0) {
        const chartH = 38 + bars.length * 36;
        if (sideCursorY - chartH > 60) {
          drawRect(sideX, sideCursorY - chartH, sideW, chartH, cardRgb, borderRgb, 0.9);
          drawText(sideX + 16, sideCursorY - 22, 'QUANTITATIVE BREAKDOWN', 8.5, 'F6', mutedRgb);
          const maxVal = Math.max(1, ...bars.map((b) => Math.abs(Number(b.value) || 0)));
          let barY = sideCursorY - 46;
          const trackW = sideW - 32;

          for (const bar of bars) {
            const labelSafe = sanitizePdfAscii(bar.label).slice(0, 20);
            const valStr = `${sanitizePdfAscii(bar.value)}${sanitizePdfAscii(bar.unit || '')}`.slice(0, 12);
            drawText(sideX + 16, barY, labelSafe, 9.5, boldFontKey, textRgb);
            drawText(sideX + sideW - 16 - valStr.length * 5.2, barY, valStr, 9.5, 'F6', accentRgb);
            drawRect(sideX + 16, barY - 12, trackW, 6, borderRgb);
            const pct = Math.max(0.08, Math.min(1, Math.abs(Number(bar.value) || 0) / maxVal));
            drawRect(sideX + 16, barY - 12, trackW * pct, 6, accentRgb);
            barY -= 36;
          }
        }
      }
    }

    // Slide Footer
    drawLine(marginX, 46, pageWidth - marginX, 46, borderRgb, 0.7);
    drawText(marginX, 26, sanitizePdfAscii(authorName).slice(0, 40), 9, 'F1', mutedRgb);
    const metaRight = `${sanitizePdfAscii(theme.label)} - Liddy Vision Studio`;
    drawText(pageWidth - marginX - metaRight.length * 4.8, 26, metaRight, 9, 'F5', mutedRgb);

    pageStreams.push(ops.join('\n'));
  });

  const pageCount = pageStreams.length;
  // Objects:
  // 1: Catalog, 2: Pages
  // 3..8: Type1 Fonts F1..F6
  // Pages start at 9
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjIds.push(9 + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\nendobj\n');
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>\nendobj\n');
  objects.push('7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');
  objects.push('8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj\n');

  for (let i = 0; i < pageCount; i++) {
    const pageId = 9 + i * 2;
    const contentId = 10 + i * 2;
    const stream = pageStreams[i];
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R /F6 8 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
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

  const bytes = encodeAsciiBytes(chunks.join('') + xref + trailer);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

export function exportSlidesAsPdf(
  slides: SlideItem[],
  boardTitle: string,
  defaultTheme: SlideTheme,
  defaultFontStyle: SlideFontStyle,
  themeMap: Record<SlideTheme, SlideThemePalette>,
  authorName = 'Workspace Member'
): void {
  const blob = buildSlidesPdfBlob(slides, boardTitle, defaultTheme, defaultFontStyle, themeMap, authorName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeSafeFileName(boardTitle)}-presentation.pdf`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

export async function exportSlidesAsPptx(
  slides: SlideItem[],
  boardTitle: string,
  defaultTheme: SlideTheme,
  defaultFontStyle: SlideFontStyle,
  themeMap: Record<SlideTheme, SlideThemePalette>,
  authorName = 'Workspace Member'
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 10.0 x 5.625 inches
  pptx.title = boardTitle || 'Financial Presentation';
  pptx.author = authorName || 'Liddy Workspace';
  pptx.company = 'Liddy Vision Studio';

  slides.forEach((s, idx) => {
    const theme = themeMap[s.theme || defaultTheme] || themeMap.ivory;
    const fStyle = s.fontStyle || defaultFontStyle;
    const fontFace =
      fStyle === 'editorial_serif'
        ? 'Georgia'
        : fStyle === 'mono_quant'
        ? 'Courier New'
        : 'Arial';

    const bgHex = stripHash(theme.bgHex);
    const cardHex = stripHash(theme.cardHex);
    const borderHex = stripHash(theme.borderHex);
    const textHex = stripHash(theme.textHex);
    const mutedHex = stripHash(theme.mutedHex);
    const accentHex = stripHash(theme.accentHex);

    const pSlide = pptx.addSlide();
    pSlide.background = { color: bgHex };

    // Top thin accent bar
    pSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.06,
      fill: { color: accentHex },
      line: { color: accentHex, width: 0 },
    });

    // Kicker + Counter
    pSlide.addText((boardTitle || 'Presentation').toUpperCase(), {
      x: 0.55,
      y: 0.22,
      w: 6.5,
      h: 0.25,
      fontFace: 'Courier New',
      fontSize: 9,
      bold: true,
      color: accentHex,
    });

    pSlide.addText(`${String(idx + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`, {
      x: 8.3,
      y: 0.22,
      w: 1.15,
      h: 0.25,
      fontFace: 'Courier New',
      fontSize: 9,
      align: 'right',
      color: mutedHex,
    });

    const bars = Array.isArray(s.chartBars) && s.chartBars.length > 0 ? s.chartBars.slice(0, 5) : [];
    const hasSidePanel = Boolean(s.metricHighlight) || bars.length > 0;
    const mainW = hasSidePanel ? 5.95 : 8.9;

    // Slide Title & Subtitle
    pSlide.addText(s.title || 'Untitled Slide', {
      x: 0.55,
      y: 0.55,
      w: mainW,
      h: 0.65,
      fontFace,
      fontSize: 22,
      bold: true,
      color: textHex,
      valign: 'top',
    });

    if (s.subtitle) {
      pSlide.addText(s.subtitle, {
        x: 0.55,
        y: 1.18,
        w: mainW,
        h: 0.35,
        fontFace,
        fontSize: 11.5,
        color: mutedHex,
        valign: 'top',
      });
    }

    // Bullet cards
    const bullets = (s.bullets || []).filter(Boolean).slice(0, 5);
    let cardY = s.subtitle ? 1.68 : 1.38;
    const cardH = bullets.length > 3 ? 0.68 : 0.86;
    const cardGap = 0.12;

    bullets.forEach((bText, bIdx) => {
      if (cardY + cardH > 5.05) return;
      pSlide.addShape(pptx.ShapeType.roundRect, {
        x: 0.55,
        y: cardY,
        w: mainW,
        h: cardH,
        rectRadius: 0.08,
        fill: { color: cardHex },
        line: { color: borderHex, width: 1 },
      });
      pSlide.addText(`0${bIdx + 1}`, {
        x: 0.72,
        y: cardY + 0.08,
        w: 0.5,
        h: 0.22,
        fontFace: 'Courier New',
        fontSize: 9,
        bold: true,
        color: accentHex,
      });
      pSlide.addText(bText, {
        x: 0.72,
        y: cardY + 0.27,
        w: mainW - 0.34,
        h: cardH - 0.32,
        fontFace,
        fontSize: 11,
        color: textHex,
        valign: 'top',
      });
      cardY += cardH + cardGap;
    });

    // Right side Metric Highlight + Chart
    if (hasSidePanel) {
      const sideX = 6.75;
      const sideW = 2.7;
      let sideY = 0.58;

      if (s.metricHighlight) {
        pSlide.addShape(pptx.ShapeType.roundRect, {
          x: sideX,
          y: sideY,
          w: sideW,
          h: 1.05,
          rectRadius: 0.1,
          fill: { color: cardHex },
          line: { color: borderHex, width: 1 },
        });
        pSlide.addText('KEY FIGURE', {
          x: sideX + 0.18,
          y: sideY + 0.14,
          w: sideW - 0.36,
          h: 0.22,
          fontFace: 'Courier New',
          fontSize: 8.5,
          bold: true,
          color: mutedHex,
        });
        pSlide.addText(s.metricHighlight, {
          x: sideX + 0.18,
          y: sideY + 0.42,
          w: sideW - 0.36,
          h: 0.48,
          fontFace,
          fontSize: 20,
          bold: true,
          color: accentHex,
        });
        sideY += 1.22;
      }

      if (bars.length > 0) {
        const chartH = Math.min(3.15, 4.9 - sideY);
        if (chartH >= 1.4) {
          pSlide.addChart(
            pptx.ChartType.bar,
            [
              {
                name: 'Value',
                labels: bars.map((b) => String(b.label || 'Item').slice(0, 18)),
                values: bars.map((b) => Number(b.value) || 0),
              },
            ],
            {
              x: sideX,
              y: sideY,
              w: sideW,
              h: chartH,
              barDir: 'bar',
              chartColors: [accentHex],
              showLegend: false,
              showTitle: true,
              title: 'Breakdown',
              titleFontSize: 10,
              titleColor: mutedHex,
              catAxisLabelColor: textHex,
              catAxisLabelFontSize: 8.5,
              valAxisLabelColor: mutedHex,
              valAxisLabelFontSize: 8,
            }
          );
        }
      }
    }

    // Footer line & metadata
    pSlide.addShape(pptx.ShapeType.line, {
      x: 0.55,
      y: 5.15,
      w: 8.9,
      h: 0,
      line: { color: borderHex, width: 0.75 },
    });
    pSlide.addText(authorName || 'Workspace Member', {
      x: 0.55,
      y: 5.22,
      w: 4.5,
      h: 0.24,
      fontFace,
      fontSize: 8.5,
      color: mutedHex,
    });
    pSlide.addText(`${theme.label} · Liddy Vision Studio`, {
      x: 5.4,
      y: 5.22,
      w: 4.05,
      h: 0.24,
      fontFace: 'Courier New',
      fontSize: 8.5,
      align: 'right',
      color: mutedHex,
    });
  });

  await pptx.writeFile({ fileName: `${sanitizeSafeFileName(boardTitle)}-presentation.pptx` });
}

export function exportSlidesAsMarkdown(slides: SlideItem[], boardTitle: string): void {
  const lines: string[] = [
    `# ${boardTitle || 'Financial Presentation'}`,
    `_Exported ${new Date().toLocaleDateString()} via Liddy Vision Studio_`,
    '',
  ];

  slides.forEach((s, idx) => {
    lines.push(`## Slide ${idx + 1}: ${s.title || 'Untitled Slide'}`);
    if (s.subtitle) lines.push(`> ${s.subtitle}`);
    if (s.metricHighlight) lines.push(`**Key Metric:** \`${s.metricHighlight}\``);
    lines.push('');
    (s.bullets || []).filter(Boolean).forEach((b) => {
      lines.push(`- ${b}`);
    });
    if (Array.isArray(s.chartBars) && s.chartBars.length > 0) {
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('| --- | --- |');
      s.chartBars.forEach((bar) => {
        lines.push(`| ${bar.label} | ${bar.value}${bar.unit || ''} |`);
      });
    }
    lines.push('');
  });

  triggerFileDownload(
    lines.join('\n'),
    `${sanitizeSafeFileName(boardTitle)}-presentation.md`,
    'text/markdown'
  );
}

export function exportSlidesAsJson(
  slides: SlideItem[],
  boardTitle: string,
  defaultTheme: SlideTheme,
  defaultFontStyle: SlideFontStyle
): void {
  const payload = {
    title: boardTitle || 'Financial Presentation',
    exportedAt: new Date().toISOString(),
    theme: defaultTheme,
    fontStyle: defaultFontStyle,
    slideCount: slides.length,
    slides,
  };
  triggerFileDownload(
    JSON.stringify(payload, null, 2),
    `${sanitizeSafeFileName(boardTitle)}-presentation.json`,
    'application/json'
  );
}
