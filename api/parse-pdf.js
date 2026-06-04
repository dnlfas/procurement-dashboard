const Anthropic = require('@anthropic-ai/sdk');
const { put } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

const SO_PROMPT = `You extract sales order (SO) line items from a procurement document (Hebrew or English).
Return ONLY a valid JSON array. Each element is one line item with these fields:
- so: string (SO / sales order number, e.g. "SO26000117")
- mpn: string (part number / MPN / item code)
- customer: string (customer / buyer name, or "")
- custPO: string (customer PO / reference number, or "")
- description: string (item description / part name, or "")
- qtyOrdered: number (total quantity ordered)
- qtyRemaining: number (remaining / open quantity yet to be supplied)
- deliveryDate: string (ISO date YYYY-MM-DD, or "")
Output only the JSON array. No explanation, no markdown, no code fences.`;

const PO_PROMPT = `You extract purchase order (PO) line items from a procurement document (Hebrew or English).
Return ONLY a valid JSON array. Each element is one line item with these fields:
- poNum: string (PO / purchase order number)
- mpn: string (part number / MPN / item code)
- supplier: string (supplier / vendor name)
- description: string (item description, or "")
- qtyOrdered: number (total quantity ordered)
- qtySupplied: number (quantity already delivered / supplied)
- qtyRemaining: number (remaining / open quantity)
- valueILS: number (value in ILS/NIS, or 0)
- currency: string (currency code, default "ILS")
- deliveryDate: string (ISO date YYYY-MM-DD, or "")
Output only the JSON array. No explanation, no markdown, no code fences.`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  if (req.method !== 'POST') return res.status(405).end();

  const { type } = req.query;
  if (type !== 'so' && type !== 'po') {
    return res.status(400).json({ error: 'type must be so or po' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);
    if (pdfBuffer.length < 100) return res.status(400).json({ error: 'empty file' });

    // Store PDF in blob for reference
    const pathname = `procurement/${type}.pdf`;
    const blob = await put(pathname, pdfBuffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/pdf',
    });

    // Extract structured data with Claude
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: type === 'so' ? SO_PROMPT : PO_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          { type: 'text', text: 'Extract all line items from this document.' },
        ],
      }],
    });

    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('expected array');

    res.json({ ok: true, rows, url: blob.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
