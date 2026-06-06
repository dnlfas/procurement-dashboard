const Anthropic = require('@anthropic-ai/sdk');
const { isAuthed } = require('./_auth');

const SYSTEM = `You extract procurement updates from any document (shipping notice, customer PO, invoice, email, Excel table).
Return ONLY a valid JSON object: { "sourceType": "shipping_notice|customer_po|invoice|other", "updates": [...] }
Each update object has these fields (strings unless noted, leave "" if unknown):
  mpn        – the CUSTOMER's part number / MPN as it appears in the buyer's system (often labelled "customer PN", "buyer PN", "your PN", "מק"ט לקוח", or similar). This is the MPN used in BTS sales orders. If the document shows both a supplier part number AND a customer part number, always use the customer part number here. If only a supplier PN exists, use that.
  so         – BTS sales order number if mentioned (e.g. "SO26000122")
  custPO     – the END CUSTOMER's purchase order number sent TO BTS (e.g. "P026S0008369"). Only set this when the document is a purchase order FROM a customer to BTS (sourceType "customer_po"). On a supplier invoice, supplier shipping notice, or anything coming FROM a supplier, there is no customer PO — leave "". NEVER put a supplier's order number, invoice number, or web-order ID here.
  poNum      – BTS purchase order number to the supplier. Only set this if the document explicitly shows a field labelled "PO", "Purchase Order", "הזמנת רכש" or similar AND the value looks like a PO reference (e.g. "PO26000203"). NEVER use the supplier's own invoice number, order number, web-order ID, or any number from the supplier's side — leave "" in those cases.
  supplier   – supplier company name
  tracking   – shipment tracking number
  supplierRef – the supplier's own reference for this order OR their internal catalog/part number when it differs from the customer PN (e.g. supplier part "C870CF34800AA0J", Digi-Key order "6113238"). Informational only — goes into the note. Leave "" if none.
  qty        – number of units shipped/invoiced for THIS line item (digits only, e.g. "101"), or ""
  status     – one of: ordered|in_transit|customs_sub|customs_rel|delivery_bts|qc|supplied|partial|waiting_cust|cancelled  (or "")
  notes      – ONE short phrase (max ~80 chars). Only exceptional info: invoice number, back-order, ETA, or a discrepancy. Do NOT restate mpn/qty/supplier/tracking — those have their own fields.
  deliveryDate – ISO date "YYYY-MM-DD" if found, else ""

Rules:
- A BTS shipping notice is identified by a document number starting with "SH" (e.g. SH26000098). For BTS shipping notices set status to "waiting_cust" — goods have left BTS and are waiting for the customer to receive them.
- For supplier shipping notices (document number does NOT start with "SH"): set status to "delivery_bts" when a tracking number is present; otherwise set status to "in_transit".
- Set status to "delivery_bts" when a tracking number is present and no clearer status is given (and it is not a BTS shipping notice).
- "waiting_cust" is ONLY for BTS-issued shipping notices (SH…). Never use it for supplier invoices, supplier shipping notices, or customer POs.
- One update object per unique line item / MPN. If the document has no line items but has header-level data (e.g. one tracking number for a whole PO), create one update object.
- For Excel input the content is a JSON array of row objects; map column names to the above fields by meaning.
- Keep notes terse. A full invoice line description is NOT a note — extract only the exceptional part.
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
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    let raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // Extract outermost {...} in case the model added surrounding text
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) raw = objMatch[0];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      // Repair unquoted property names (e.g. {key: val} → {"key": val})
      const repaired = raw.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
      parsed = JSON.parse(repaired);
    }
    res.json({ ok: true, sourceType: parsed.sourceType || 'other', updates: parsed.updates || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
