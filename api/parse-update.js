const Anthropic = require('@anthropic-ai/sdk');
const { isAuthed } = require('./_auth');

const SYSTEM = `You extract procurement updates from any document (shipping notice, customer PO, invoice, email, Excel table).
Return ONLY a valid JSON object: { "sourceType": "shipping_notice|customer_po|invoice|other", "updates": [...] }
Each update object has these fields (all strings, leave "" if unknown):
  mpn        – part number / MPN / catalog code (exact as written)
  so         – BTS sales order number if mentioned (e.g. "SO26000122")
  custPO     – customer purchase order number sent to BTS (e.g. "P026S0008369")
  poNum      – BTS purchase order number sent to supplier (e.g. "PO26000203")
  supplier   – supplier company name
  tracking   – shipment tracking number
  status     – one of: ordered|in_transit|customs_sub|customs_rel|delivery_bts|qc|supplied|partial|waiting_cust|cancelled  (or "")
  notes      – free-text note (ETA, partial delivery info, etc.)
  deliveryDate – ISO date "YYYY-MM-DD" if found, else ""

Rules:
- Set status to "delivery_bts" when a tracking number is present and no clearer status is given.
- One update object per unique line item / MPN. If the document has no line items but has header-level data (e.g. one tracking number for a whole PO), create one update object.
- For Excel input the content is a JSON array of row objects; map column names to the above fields by meaning.
- Output only the JSON object. No explanation, no markdown, no code fences.`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { type, content, mimeType } = JSON.parse(body);
    if (!content || !content.trim()) return res.status(400).json({ error: 'empty' });

    const client = new Anthropic();

    let userContent;
    if (type === 'image') {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: content } },
        { type: 'text', text: 'Extract procurement updates from this image.' },
      ];
    } else if (type === 'pdf') {
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } },
        { type: 'text', text: 'Extract procurement updates from this document.' },
      ];
    } else {
      // text or excel — content is a plain string
      userContent = content;
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(raw);
    res.json({ ok: true, sourceType: parsed.sourceType || 'other', updates: parsed.updates || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
