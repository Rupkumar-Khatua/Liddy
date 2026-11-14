import { Invoice, InvoicePaperFormat, InvoiceTemplateStyle } from '../types';

export const TEMPLATE_LABELS: Record<InvoiceTemplateStyle, { label: string; desc: string }> = {
  classic: {
    label: 'Classic Editorial',
    desc: 'Crisp serif-accent ledger layout with structured header & itemized grid',
  },
  minimal: {
    label: 'Modern Minimal',
    desc: 'Clean Swiss typography with generous spacing and subtle borders',
  },
  corporate: {
    label: 'Corporate Tax / GST',
    desc: 'Formal tax invoice header with Sender & Client GSTIN/Tax ID + tax summary',
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
  overridePaper?: InvoicePaperFormat
): string {
  const tpl: InvoiceTemplateStyle = overrideTemplate || invoice.templateStyle || 'classic';
  const paper: InvoicePaperFormat = overridePaper || invoice.paperFormat || 'a4';
  const spec = PAPER_FORMAT_SPECS[paper] || PAPER_FORMAT_SPECS.a4;
  const cur = invoice.currency || '₹';
  const fmt = (n: number) => `${(Number(n) || 0).toFixed(2)} ${cur}`;
  const isThermal = paper === 'thermal80';

  const headerBg =
    tpl === 'corporate' ? '#0f172a' : tpl === 'classic' ? '#18181b' : '#ffffff';
  const headerColor =
    tpl === 'minimal' ? '#09090b' : '#ffffff';
  const accentColor =
    tpl === 'corporate' ? '#0284c7' : tpl === 'classic' ? '#0f766e' : '#18181b';

  const rows = (invoice.items || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:${isThermal ? '6px 4px' : '10px 8px'};border-bottom:1px ${isThermal ? 'dashed' : 'solid'} #e4e4e7;vertical-align:top;">
          <div style="font-weight:600;color:#111111;">${esc(it.description || 'Service Item')}</div>
          ${isThermal ? `<div style="font-size:10px;color:#52525b;">${it.quantity} × ${fmt(it.unitPrice)}${it.taxPercent ? ` · Tax ${it.taxPercent}%` : ''}</div>` : ''}
        </td>
        ${!isThermal ? `<td style="padding:10px 8px;border-bottom:1px solid #e4e4e7;text-align:right;font-family:monospace;">${it.quantity}</td>` : ''}
        ${!isThermal ? `<td style="padding:10px 8px;border-bottom:1px solid #e4e4e7;text-align:right;font-family:monospace;">${fmt(it.unitPrice)}</td>` : ''}
        ${!isThermal ? `<td style="padding:10px 8px;border-bottom:1px solid #e4e4e7;text-align:right;font-family:monospace;">${it.taxPercent || 0}%</td>` : ''}
        <td style="padding:${isThermal ? '6px 4px' : '10px 8px'};border-bottom:1px ${isThermal ? 'dashed' : 'solid'} #e4e4e7;text-align:right;font-family:monospace;font-weight:700;">${fmt(it.total)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${esc(invoice.invoiceNumber)}</title>
  <style>
    @page { size: ${spec.sizeCss}; margin: ${isThermal ? '6mm' : '14mm'}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: ${isThermal ? '8px' : '24px'};
      font-family: ${tpl === 'classic' ? "Georgia, 'Times New Roman', serif" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};
      color: #111111;
      background: #ffffff;
    }
    .sheet {
      max-width: ${spec.widthPx}px;
      margin: 0 auto;
      border: ${isThermal ? '1px dashed #d4d4d8' : '1px solid #e4e4e7'};
      border-radius: ${isThermal ? '4px' : '12px'};
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div style="background:${headerBg};color:${headerColor};padding:${isThermal ? '12px' : '24px 28px'};border-bottom:${tpl === 'minimal' ? '2px solid #18181b' : 'none'};">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.75;font-family:monospace;">
        ${tpl === 'corporate' ? 'TAX INVOICE / OFFICIAL BILL' : 'INVOICE STATEMENT'} · ${esc(spec.badge)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-top:8px;flex-wrap:wrap;">
        <div>
          <div style="font-size:${isThermal ? '18px' : '24px'};font-weight:800;">${esc(invoice.senderName || 'Billing Issuer')}</div>
          ${invoice.senderTaxId ? `<div style="font-size:11px;font-family:monospace;margin-top:2px;">Tax ID / GSTIN: ${esc(invoice.senderTaxId)}</div>` : ''}
        </div>
        <div style="text-align:${isThermal ? 'left' : 'right'};font-family:monospace;">
          <div style="font-size:${isThermal ? '13px' : '16px'};font-weight:700;">#${esc(invoice.invoiceNumber)}</div>
          <div style="font-size:11px;opacity:0.8;">Date: ${esc(invoice.date)}</div>
          ${invoice.dueDate ? `<div style="font-size:11px;opacity:0.8;">Due: ${esc(invoice.dueDate)}</div>` : ''}
        </div>
      </div>
    </div>

    <div style="padding:${isThermal ? '12px' : '24px 28px'};">
      <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap;font-size:${isThermal ? '11px' : '13px'};">
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:#71717a;font-family:monospace;font-weight:700;">Billed To</div>
          <div style="font-weight:700;font-size:${isThermal ? '13px' : '15px'};margin-top:2px;">${esc(invoice.clientName)}</div>
          ${invoice.clientEmail ? `<div style="color:#52525b;">${esc(invoice.clientEmail)}</div>` : ''}
          ${invoice.clientTaxId ? `<div style="color:#52525b;font-family:monospace;">Tax ID: ${esc(invoice.clientTaxId)}</div>` : ''}
          ${invoice.clientDetails ? `<div style="color:#52525b;white-space:pre-line;margin-top:2px;">${esc(invoice.clientDetails)}</div>` : ''}
        </div>
        <div style="text-align:${isThermal ? 'left' : 'right'};">
          <div style="font-size:10px;text-transform:uppercase;color:#71717a;font-family:monospace;font-weight:700;">Status</div>
          <div style="font-weight:800;font-family:monospace;color:${invoice.paymentStatus === 'paid' ? '#059669' : '#d97706'};margin-top:2px;text-transform:uppercase;">
            ${esc(invoice.paymentStatus)}
          </div>
          ${invoice.senderDetails ? `<div style="color:#52525b;font-size:11px;white-space:pre-line;margin-top:4px;">${esc(invoice.senderDetails)}</div>` : ''}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:${isThermal ? '11px' : '13px'};margin-bottom:16px;">
        <thead>
          <tr style="border-top:2px solid ${accentColor};border-bottom:2px solid ${accentColor};font-family:monospace;font-size:10px;text-transform:uppercase;color:#52525b;">
            <th style="padding:8px 4px;text-align:left;">Item</th>
            ${!isThermal ? '<th style="padding:8px;text-align:right;">Qty</th>' : ''}
            ${!isThermal ? '<th style="padding:8px;text-align:right;">Unit</th>' : ''}
            ${!isThermal ? '<th style="padding:8px;text-align:right;">Tax</th>' : ''}
            <th style="padding:8px 4px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-top:12px;border-top:1px solid #e4e4e7;">
        <div>
          ${
            qrDataUrl
              ? `<div style="display:flex;align-items:center;gap:10px;">
                  <img src="${qrDataUrl}" alt="UPI QR" style="width:${isThermal ? '64px' : '82px'};height:${isThermal ? '64px' : '82px'};border:1px solid #e4e4e7;border-radius:6px;padding:3px;" />
                  <div style="font-size:10px;font-family:monospace;color:#52525b;">
                    <div><strong>UPI Pay</strong></div>
                    <div>${esc(invoice.upiId || 'merchant@upi')}</div>
                  </div>
                </div>`
              : ''
          }
        </div>
        <div style="min-width:${isThermal ? '100%' : '230px'};font-size:${isThermal ? '11px' : '13px'};font-family:monospace;">
          <div style="display:flex;justify-content:space-between;padding:3px 0;color:#52525b;">
            <span>Subtotal</span><span>${fmt(invoice.subtotal)}</span>
          </div>
          ${Number(invoice.discountTotal) > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;color:#059669;"><span>Discount</span><span>-${fmt(invoice.discountTotal)}</span></div>` : ''}
          ${Number(invoice.taxTotal) > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;color:#52525b;"><span>Tax (GST/VAT)</span><span>+${fmt(invoice.taxTotal)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0 2px;margin-top:4px;border-top:2px solid #111111;font-size:${isThermal ? '14px' : '16px'};font-weight:800;">
            <span>Grand Total</span><span>${fmt(invoice.grandTotal)}</span>
          </div>
        </div>
      </div>

      ${
        invoice.notes
          ? `<div style="margin-top:16px;padding:10px 12px;background:#f4f4f5;border-radius:6px;font-size:11px;color:#3f3f46;"><strong>Notes:</strong> ${esc(invoice.notes)}</div>`
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
