export interface EmailReceiptRequest {
  recipientEmail: string;
  buyerName: string;
  referenceCode: string;
  invoiceNumber: string;
  date: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  currency: string;
  paymentRail: string;
  connector?: string;
  senderName?: string;
  senderTaxId?: string;
  clientTaxId?: string;
  notes?: string;
}

export interface GeneratedEmailReceipt {
  subject: string;
  htmlBody: string;
  emlContent: string;
  gmailRawBase64Url: string;
}

function utf8ToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateEmailReceiptPayload(payload: EmailReceiptRequest): Promise<GeneratedEmailReceipt> {
  const res = await fetch('/api/payments/receipt-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Could not generate invoice email payload.');
  }
  return {
    subject: data.subject,
    htmlBody: data.htmlBody,
    emlContent: data.emlContent,
    gmailRawBase64Url: data.gmailRawBase64Url,
  };
}

export async function dispatchInvoiceViaGmailApi(params: {
  accessToken: string;
  senderEmail?: string | null;
  recipientEmail: string;
  subject: string;
  htmlBody: string;
}): Promise<{ id: string }> {
  const encodedSubject = `=?UTF-8?B?${utf8ToBase64Url(params.subject).replace(/-/g, '+').replace(/_/g, '/')}?=`;
  const mime = [
    `From: ${params.senderEmail || 'me'}`,
    `To: ${params.recipientEmail}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    params.htmlBody,
  ].join('\r\n');

  const raw = utf8ToBase64Url(mime);

  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gmail API error (${resp.status}): ${errText}`);
  }
  return await resp.json();
}

export function triggerFileDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
