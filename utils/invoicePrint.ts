import { Invoice, InvoicePaperFormat, InvoiceTemplateStyle, PaymentRegion } from '../types';

export const TEMPLATE_LABELS: Record<
  InvoiceTemplateStyle,
  { label: string; desc: string; swatchBg: string; swatchAccent: string }
> = {
  swiss: {
    label: 'Swiss Paper',
    desc: 'Crisp hairline grid with architectural spacing and restrained contrast',
    swatchBg: '#FFFFFF',
    swatchAccent: '#111111',
  },
  classic: {
    label: 'Classic Editorial',
    desc: 'Refined serif header with formal ledger framing',
    swatchBg: '#18181B',
    swatchAccent: '#0F766E',
  },
  minimal: {
    label: 'Modern Minimal',
    desc: 'High-contrast monochrome sheet with subtle dividers',
    swatchBg: '#FAFAFA',
    swatchAccent: '#18181B',
  },
  corporate: {
    label: 'Corporate Tax / GST',
    desc: 'Official tax statement layout with prominent GSTIN & Tax ID blocks',
    swatchBg: '#0F172A',
    swatchAccent: '#0284C7',
  },
  executive: {
    label: 'Executive Studio',
    desc: 'Slate banner contrast paired with structured Swiss line tables',
    swatchBg: '#1E293B',
    swatchAccent: '#2563EB',
  },
};

export const PAPER_FORMAT_SPECS: Record<
  InvoicePaperFormat,
  { label: string; sizeCss: string; widthPx: number; badge: string }
> = {
  a4: {
    label: 'A4 Standard (210 × 297 mm)',
    sizeCss: 'A4 portrait',
    widthPx: 760,
    badge: 'A4',
  },
  letter: {
    label: 'US Letter (8.5 × 11 in)',
    sizeCss: 'letter portrait',
    widthPx: 780,
    badge: 'Letter',
  },
  thermal80: {
    label: '80mm Thermal POS Receipt',
    sizeCss: '80mm auto',
    widthPx: 330,
    badge: '80mm POS',
  },
};

function esc(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPrintableInvoiceHtml(
  invoice: Invoice,
  qrDataUrl?: string,
  overrideTemplate?: InvoiceTemplateStyle,
  overridePaper?: InvoicePaperFormat,
  overrideRegion?: PaymentRegion
): string {
  const tpl: InvoiceTemplateStyle = overrideTemplate || invoice.templateStyle || 'swiss';
  const paper: InvoicePaperFormat = overridePaper || invoice.paperFormat || 'a4';
  const region: PaymentRegion = overrideRegion || invoice.paymentRegion || 'INTL';
  const spec = PAPER_FORMAT_SPECS[paper] || PAPER_FORMAT_SPECS.a4;
  const cur = invoice.currency || (region === 'IN' ? '₹' : '$');
  const fmt = (n: number) => `${cur}${(Number(n) || 0).toFixed(2)}`;
  const isThermal = paper === 'thermal80';

  const isLightHeader = tpl === 'swiss' || tpl === 'minimal';
  const headerBg =
    tpl === 'corporate'
      ? '#0F172A'
      : tpl === 'executive'
      ? '#1E293B'
      : tpl === 'classic'
      ? '#18181B'
      : tpl === 'minimal'
      ? '#FAFAFA'
      : '#FFFFFF';
  const headerColor = isLightHeader ? '#111111' : '#FFFFFF';
  const accentColor =
    tpl === 'corporate'
      ? '#0284C7'
      : tpl === 'executive'
      ? '#2563EB'
      : tpl === 'classic'
      ? '#0F766E'
      : '#111111';

  const rows = (invoice.items || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:${isThermal ? '6px 4px' : '11px 8px'};border-bottom:1px ${isThermal ? 'dashed' : 'solid'} #E5E5E5;vertical-align:top;">
          <div style="font-weight:600;color:#111111;">${esc(it.description || 'Service Item')}</div>
          ${isThermal ? `<div style="font-size:10px;color:#52525B;">${it.quantity} × ${fmt(it.unitPrice)}${it.taxPercent ? ` · Tax ${it.taxPercent}%` : ''}</div>` : ''}
        </td>
        ${!isThermal ? `<td style="padding:11px 8px;border-bottom:1px solid #E5E5E5;text-align:right;font-family:ui-monospace,Menlo,monospace;color:#3F3F46;">${it.quantity}</td>` : ''}
        ${!isThermal ? `<td style="padding:11px 8px;border-bottom:1px solid #E5E5E5;text-align:right;font-family:ui-monospace,Menlo,monospace;color:#3F3F46;">${fmt(it.unitPrice)}</td>` : ''}
        ${!isThermal ? `<td style="padding:11px 8px;border-bottom:1px solid #E5E5E5;text-align:right;font-family:ui-monospace,Menlo,monospace;color:#52525B;">${it.taxPercent || 0}%</td>` : ''}
        <td style="padding:${isThermal ? '6px 4px' : '11px 8px'};border-bottom:1px ${isThermal ? 'dashed' : 'solid'} #E5E5E5;text-align:right;font-family:ui-monospace,Menlo,monospace;font-weight:700;color:#111111;">${fmt(it.total)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Document ${esc(invoice.invoiceNumber)}</title>
  <style>
    @page { size: ${spec.sizeCss}; margin: ${isThermal ? '6mm' : '14mm'}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: ${isThermal ? '8px' : '24px'};
      font-family: ${tpl === 'classic' ? "Georgia, 'Times New Roman', serif" : "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif"};
      color: #111111;
      background: #F4F4F5;
    }
    .sheet {
      max-width: ${spec.widthPx}px;
      margin: 0 auto;
      background: #FFFFFF;
      border: ${isThermal ? '1px dashed #D4D4D8' : '1px solid #E5E5E5'};
      border-radius: ${isThermal ? '4px' : '12px'};
      overflow: hidden;
    }
    @media print {
      body { background: #FFFFFF; padding: 0; }
      .sheet { border-color: #E5E5E5; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div style="background:${headerBg};color:${headerColor};padding:${isThermal ? '12px' : '26px 30px'};border-bottom:${isLightHeader ? '1px solid #E5E5E5' : 'none'};border-top:${tpl === 'swiss' ? '4px solid #111111' : tpl === 'executive' ? '4px solid #2563EB' : 'none'};">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;opacity:${isLightHeader ? '0.65' : '0.75'};font-family:ui-monospace,Menlo,monospace;">
        ${tpl === 'corporate' ? 'TAX INVOICE / OFFICIAL STATEMENT' : tpl === 'executive' ? 'DIGITAL STATEMENT' : 'SWISS PAPER INVOICE'} · ${esc(spec.badge)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-top:10px;flex-wrap:wrap;">
        <div>
          <div style="font-size:${isThermal ? '18px' : '24px'};font-weight:800;letter-spacing:-0.02em;">${esc(invoice.senderName || 'Billing Issuer')}</div>
          ${invoice.senderTaxId ? `<div style="font-size:11px;font-family:ui-monospace,Menlo,monospace;margin-top:3px;opacity:0.85;">Tax ID / GSTIN: ${esc(invoice.senderTaxId)}</div>` : ''}
        </div>
        <div style="text-align:${isThermal ? 'left' : 'right'};font-family:ui-monospace,Menlo,monospace;">
          <div style="font-size:${isThermal ? '13px' : '16px'};font-weight:700;">#${esc(invoice.invoiceNumber)}</div>
          <div style="font-size:11px;opacity:0.75;">Issued: ${esc(invoice.date)}</div>
          ${invoice.dueDate ? `<div style="font-size:11px;opacity:0.75;">Due: ${esc(invoice.dueDate)}</div>` : ''}
        </div>
      </div>
    </div>

    <div style="padding:${isThermal ? '12px' : '26px 30px'};">
      <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap;font-size:${isThermal ? '11px' : '13px'};">
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:#71717A;font-family:ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:0.08em;">Billed To</div>
          <div style="font-weight:700;font-size:${isThermal ? '13px' : '15px'};margin-top:3px;">${esc(invoice.clientName)}</div>
          ${invoice.clientEmail ? `<div style="color:#52525B;">${esc(invoice.clientEmail)}</div>` : ''}
          ${invoice.clientTaxId ? `<div style="color:#52525B;font-family:ui-monospace,Menlo,monospace;">Tax ID: ${esc(invoice.clientTaxId)}</div>` : ''}
          ${invoice.clientDetails ? `<div style="color:#52525B;white-space:pre-line;margin-top:3px;">${esc(invoice.clientDetails)}</div>` : ''}
        </div>
        <div style="text-align:${isThermal ? 'left' : 'right'};">
          <div style="font-size:10px;text-transform:uppercase;color:#71717A;font-family:ui-monospace,Menlo,monospace;font-weight:700;letter-spacing:0.08em;">Settlement</div>
          <div style="font-weight:800;font-family:ui-monospace,Menlo,monospace;color:${invoice.paymentStatus === 'paid' ? '#059669' : '#D97706'};margin-top:3px;text-transform:uppercase;">
            ${esc(invoice.paymentStatus)}
          </div>
          ${invoice.senderDetails ? `<div style="color:#52525B;font-size:11px;white-space:pre-line;margin-top:4px;">${esc(invoice.senderDetails)}</div>` : ''}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:${isThermal ? '11px' : '13px'};margin-bottom:18px;">
        <thead>
          <tr style="border-top:2px solid ${accentColor};border-bottom:1px solid #E5E5E5;font-family:ui-monospace,Menlo,monospace;font-size:10px;text-transform:uppercase;color:#52525B;">
            <th style="padding:9px 4px;text-align:left;">Description</th>
            ${!isThermal ? '<th style="padding:9px 8px;text-align:right;">Qty</th>' : ''}
            ${!isThermal ? '<th style="padding:9px 8px;text-align:right;">Unit</th>' : ''}
            ${!isThermal ? '<th style="padding:9px 8px;text-align:right;">Tax</th>' : ''}
            <th style="padding:9px 4px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-top:14px;border-top:1px solid #E5E5E5;">
        <div>
          ${
            region === 'INTL'
              ? `<div style="padding:10px 12px;border:1px solid #E5E5E5;border-radius:8px;background:#FAFAFA;font-size:11px;font-family:ui-monospace,Menlo,monospace;color:#27272A;">
                  <div style="font-weight:700;color:#003087;margin-bottom:2px;">PayPal Settlement</div>
                  <div>PayPal ID: ${esc(invoice.paypalId || 'Configured on Request')}</div>
                  ${invoice.payeeName || invoice.senderName ? `<div style="color:#52525B;margin-top:2px;">Payee: ${esc(invoice.payeeName || invoice.senderName)}</div>` : ''}
                </div>`
              : qrDataUrl
              ? `<div style="display:flex;align-items:center;gap:10px;">
                  <img src="${qrDataUrl}" alt="UPI QR" style="width:${isThermal ? '64px' : '82px'};height:${isThermal ? '64px' : '82px'};border:1px solid #E5E5E5;border-radius:6px;padding:3px;" />
                  <div style="font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#52525B;">
                    <div><strong>UPI Pay</strong></div>
                    <div>${esc(invoice.upiId || '')}</div>
                  </div>
                </div>`
              : ''
          }
        </div>
        <div style="min-width:${isThermal ? '100%' : '240px'};font-size:${isThermal ? '11px' : '13px'};font-family:ui-monospace,Menlo,monospace;">
          <div style="display:flex;justify-content:space-between;padding:4px 0;color:#52525B;">
            <span>Subtotal</span><span>${fmt(invoice.subtotal)}</span>
          </div>
          ${Number(invoice.discountTotal) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#059669;"><span>Discount</span><span>-${fmt(invoice.discountTotal)}</span></div>` : ''}
          ${Number(invoice.taxTotal) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#52525B;"><span>Tax</span><span>+${fmt(invoice.taxTotal)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:9px 0 2px;margin-top:6px;border-top:2px solid #111111;font-size:${isThermal ? '14px' : '17px'};font-weight:800;">
            <span>Total</span><span>${fmt(invoice.grandTotal)}</span>
          </div>
        </div>
      </div>

      ${
        invoice.notes
          ? `<div style="margin-top:18px;padding:10px 12px;background:#FAFAFA;border:1px solid #E5E5E5;border-radius:8px;font-size:11px;color:#3F3F46;"><strong>Notes:</strong> ${esc(invoice.notes)}</div>`
          : ''
      }
    </div>
  </div>
</body>
</html>`;
}

export function printFormattedInvoiceViaIframe(htmlContent: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(htmlContent);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {}
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 1500);
  };

  setTimeout(triggerPrint, 300);
}
