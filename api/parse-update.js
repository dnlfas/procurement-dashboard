const Anthropic = require('@anthropic-ai/sdk');
const { isAuthed } = require('./_auth');

const SYSTEM = `You extract procurement updates from any document (shipping notice, customer PO, invoice, email, Excel table, or BTS Sales Order).
Return ONLY a valid JSON object: { "sourceType": "shipping_notice|customer_po|invoice|coc|so_file|other", "updates": [...] }
Each update object has these fields (strings unless noted, leave "" if unknown):
  mpn        – the CUSTOMER's part number / MPN as it appears in the buyer's system (often labelled "customer PN", "buyer PN", "your PN", "מק"ט לקוח", or similar). This is the MPN used in BTS sales orders. If the document shows both a supplier part number AND a customer part number, always use the customer part number here. If only a supplier PN exists, use that.
  so         – BTS sales order number if mentioned (e.g. "SO26000122")
  custPO     – the END CUSTOMER's purchase order number sent TO BTS (e.g. "P026S0008369"). Only set this when the document is a purchase order FROM a customer to BTS (sourceType "customer_po"). On a supplier invoice, supplier shipping notice, or anything coming FROM a supplier, there is no customer PO — leave "". NEVER put a supplier's order number, invoice number, or web-order ID here.
  customer   – the END CUSTOMER's company name (the buyer who sent the PO to BTS). Only set on customer_po documents. Leave "" otherwise.
  poNum      – BTS purchase order number to the supplier. Only set this if the document explicitly shows a field labelled "PO", "Purchase Order", "הזמנת רכש" or similar AND the value looks like a PO reference (e.g. "PO26000203"). NEVER use the supplier's own invoice number, order number, web-order ID, or any number from the supplier's side — leave "" in those cases.
  supplier   – supplier company name
  tracking   – shipment tracking number for the FINAL leg to Israel (DHL, FedEx, UPS, etc.). Do NOT put SF Express tracking numbers here — SF Express is a Chinese domestic/consolidation courier and its tracking number belongs in notes.
  supplierRef – the supplier's own reference for this order OR their internal catalog/part number when it differs from the customer PN (e.g. supplier part "C870CF34800AA0J", Digi-Key order "6113238"). Informational only — goes into the note. Leave "" if none.
  qty        – number of units shipped/invoiced for THIS line item (digits only, e.g. "101"), or ""
  status     – one of: ordered|in_transit|waiting_wh|customs_sub|customs_rel|delivery_bts|qc|supplied|partial|waiting_cust|cancelled  (or "")
  notes      – ONE short phrase (max ~80 chars). Only exceptional info: invoice number, back-order, ETA, SF Express tracking number, or a discrepancy. Do NOT restate mpn/qty/supplier — those have their own fields.
  deliveryDate – ISO date "YYYY-MM-DD" if found, else ""

Rules:
- PRIORITY 1 — BTS order confirmation (so_file): If the document (image, PDF, or text) contains a title or heading "אישור הזמנה מספר SO..." or "אישור הזמנה מס' SO..." — this is a BTS-issued Sales Order confirmation sent TO a customer. Set sourceType to "so_file". DO NOT classify as "customer_po" — BTS is the SENDER here, not the customer. Extract: so from the SO number in the title (e.g. "SO26000131"). For custPO: look in the document header for a field like "הזמנת רכש (לקוח)", "הז. רכש", "מספר הזמנה", or "P.O." followed by a reference number — this is the customer's purchase order number that triggered this SO; set custPO to that value. For customer: the company listed after "לכבוד:" is the customer — set customer to that company name. mpn from the "מק"ט לקוח" column (customer's part number). If "מק"ט לקוח" is empty for a row, use "מק"ט" instead. Put the "מק"ט" value (BTS catalog code) in supplierRef when it differs from mpn. deliveryDate from "תאריך אספקה" (ISO YYYY-MM-DD), qty from "כמות" or "יתרה לאספקה". Skip service/test line items where both "מק"ט לקוח" and "מק"ט" are empty or contain Hebrew service descriptions like "בדיקה", "מעבדה", "שירות". Leave tracking and notes empty.
- PRIORITY 2 — BTS Sales Order Excel file (so_file): If the input is a JSON array whose rows include a column named "הזמנה" (containing SO numbers like "26000122" or "SO26000122") AND a column named "סטטוס פריט" — this is ALWAYS a BTS internal Sales Order export. Set sourceType to "so_file" regardless of any other content (even if the rows also contain customer PO numbers or customer names — those are informational columns, not proof of a customer PO document). For each non-empty row: so = row["הזמנה"], mpn = row["מספר פריט"] or row["מק"ט"] or row["מקט"], deliveryDate from row["ת. אספקה"] or row["תאריך אספקה"] (as ISO YYYY-MM-DD), qty from row["יתרה לאספקה"], supplier from row["שם ספק"], poNum from row["מספר הזמנת רכש"]. Map "סטטוס פריט" to status codes: "הוזמן מהספק"→"ordered", "טרם הוזמן"→"pending", "בקרת איכות"→"qc", "מחסן המוצא"→"waiting_wh", "נחת בארץ"→"in_transit", "הגשות למכס"→"customs_sub", "שוחרר ממכס"→"customs_rel", "שליחות"/"BTS"→"delivery_bts", "סופק ללקוח"→"supplied", "סופק חלקי"→"partial", "ממתין לאספקה"→"waiting_cust", "בוטל"→"cancelled". Leave custPO, customer, tracking, notes empty.
- When an email states that parts have been shipped to Winshare, to "our partner", or to a consolidation/forwarding warehouse, OR when an SF Express tracking number is provided (SF Express tracking numbers typically start with SF followed by digits, e.g. SF1234567890123), set status to "waiting_wh" and put the SF tracking number in notes (e.g. "SF Express: SF1234567890123"), NOT in the tracking field.
- A BTS shipping notice is identified by a document number starting with "SH" (e.g. SH26000098). For BTS shipping notices set status to "waiting_cust" — goods have left BTS and are waiting for the customer to receive them.
- For supplier shipping notices (document number does NOT start with "SH"): set status to "delivery_bts" when a tracking number is present; otherwise set status to "in_transit".
- Set status to "delivery_bts" when a tracking number is present and no clearer status is given (and it is not a BTS shipping notice).
- "waiting_cust" is ONLY for BTS-issued shipping notices (SH…). Never use it for supplier invoices, supplier shipping notices, or customer POs.
- A "Certificate of Compliance" (COC) is a quality document — set sourceType to "coc" and status to "qc" for all its line items. Even though a COC contains a "CUSTOMER P.O." reference, it is NOT a customer PO document — never set sourceType to "customer_po" for a COC.
- In a COC, "BTS Reg.No." or "BTS Reg. No." followed by a number is the BTS sales order number — set so to "SO" + that number (e.g. "BTS Reg.No. 26000102" → so = "SO26000102"). Apply this SO to every line item in the COC.
- For Digi-Key invoices: the "PART" line contains the Digi-Key catalog number (e.g. "2013-1000-ND") — do NOT use this as mpn. The real manufacturer PN is on the "MFG" line, after the slash (e.g. "MFG : Peak Electronic Design Limited / DCA75" → mpn = "DCA75"). The text before the slash is the component manufacturer name — put it in notes as "Manufacturer: <name>" (e.g. notes = "Manufacturer: Peak Electronic Design Limited"). The supplier field should be "Digi-Key" (the company BTS ordered from).
- Hebrew business letter format: when a document has the sender's company at the top followed by "לכבוד:" (or "לכבוד :" / "לכבוד") and BTS (בי.טי.אס / BTS / ב.ט.ס) is listed as the addressee, this is a customer PO sent TO BTS. Set sourceType to "customer_po". The company named at the top of the letter is the customer — set the customer field to that company name.
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
    const { type, content, mimeType, context } = JSON.parse(body);
    // SO → PO helpers live here to stay under Vercel's function limit
    if (type === 'fx') return res.json(await boiRates());
    if (!content || !content.trim()) return res.status(400).json({ error: 'empty' });
    if (type === 'pricecheck') return res.json(await priceCheck(JSON.parse(content)));
    if (type === 'quote') return res.json(await parseQuote(content));

    // --- Server-side pre-detection for BTS Sales Order Excel files ---
    // The AI cannot reliably distinguish SO Excel from customer PO, so we detect
    // it in code by looking for the definitive Hebrew column names.
    if (type !== 'image' && type !== 'pdf') {
      try {
        const arr = JSON.parse(content);
        if (Array.isArray(arr) && arr.length > 0) {
          const keys = Object.keys(arr[0]);
          const findKey = (candidates) => keys.find(k => candidates.some(c => k.includes(c))) || null;
          const soKey    = findKey(['הזמנה']);
          const statusKey = findKey(['סטטוס פריט']);
          if (soKey && statusKey) {
            // Confirmed BTS SO Excel — parse directly, no AI call needed
            const mpnKey  = findKey(['מספר פריט', 'מק"ט', "מק'ט", 'מקט']);
            const dateKey = findKey(['ת. אספקה', 'תאריך אספקה']);
            const qtyKey  = findKey(['יתרה לאספקה', 'כמות בהזמנה']);
            const suppKey = findKey(['שם ספק']);
            const poKey   = findKey(['מספר הזמנת רכש']);
            const STATUS_MAP = {
              'הוזמן מהספק':'ordered','טרם הוזמן':'pending','בקרת איכות ספק':'qc_supp',
              'בקרת איכות':'qc','מחסן המוצא':'waiting_wh','נחת בארץ':'in_transit',
              'הגשות למכס':'customs_sub','שוחרר ממכס':'customs_rel',
              'שליחות':'delivery_bts','BTS':'delivery_bts',
              'סופק ללקוח':'supplied','סופק חלקי':'partial',
              'ממתין לאספקה':'waiting_cust','בוטל':'cancelled','איתור ספק':'sourcing'
            };
            function parseExcelDate(val) {
              if (!val) return '';
              if (typeof val === 'number' && val > 1) {
                const d = new Date(Math.round((val - 25569) * 86400000));
                return d.toISOString().slice(0, 10);
              }
              if (typeof val === 'string') {
                const d = new Date(val);
                if (!isNaN(d)) return d.toISOString().slice(0, 10);
              }
              return '';
            }
            let lastSO = '';
            const seen = new Set();
            const updates = [];
            for (const r of arr) {
              const so  = soKey  ? String(r[soKey]  || '').trim() : '';
              const mpn = mpnKey ? String(r[mpnKey] || '').trim() : '';
              if (so) lastSO = so;
              const effectiveSO = so || lastSO;
              if (!effectiveSO && !mpn) continue;
              const nk = effectiveSO + '__' + mpn;
              if (seen.has(nk)) continue;
              seen.add(nk);
              const statusRaw = statusKey ? String(r[statusKey] || '').trim() : '';
              let status = '';
              for (const [he, en] of Object.entries(STATUS_MAP)) {
                if (statusRaw.includes(he)) { status = en; break; }
              }
              updates.push({
                so: effectiveSO, mpn,
                deliveryDate: dateKey ? parseExcelDate(r[dateKey]) : '',
                status,
                supplier: suppKey ? String(r[suppKey] || '').trim() : '',
                poNum:    poKey   ? String(r[poKey]   || '').trim() : '',
                qty:      qtyKey  ? String(r[qtyKey]  || '').trim() : '',
                tracking: '', custPO: '', customer: '', notes: '', supplierRef: ''
              });
            }
            return res.json({ ok: true, sourceType: 'so_file', updates });
          }
        }
      } catch (_) { /* not JSON — fall through to AI */ }
    }
    // --- End SO pre-detection ---

    const client = new Anthropic();

    const contextNote = context ? `\n\nAdditional context provided by the user:\n${context}` : '';
    let userContent;
    if (type === 'image') {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: content } },
        { type: 'text', text: 'Extract procurement updates from this image.' + contextNote },
      ];
    } else if (type === 'pdf') {
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } },
        { type: 'text', text: 'Extract procurement updates from this document.' + contextNote },
      ];
    } else {
      // text or excel — content is a plain string
      userContent = context ? content + contextNote : content;
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    // Reply cut off at max_tokens (long invoices): keep only the complete line items
    const truncated = message.stop_reason === 'max_tokens';
    const parsed = parseLooseJSON(message.content[0].text, truncated ? 'updates' : null);
    res.json({ ok: true, sourceType: parsed.sourceType || 'other', updates: parsed.updates || [], truncated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Model reply → object, tolerating code fences, surrounding text, unquoted keys and unescaped quotes.
// truncatedKey: name of the array to cut back to its last complete item when the reply hit max_tokens.
function parseLooseJSON(text, truncatedKey) {
  let raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Strip ALL raw control characters illegal inside JSON strings (0x00-0x1F, 0x7F)
  // Structural whitespace between tokens becomes spaces — JSON.parse handles that fine.
  raw = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
  if (truncatedKey) raw = closeTruncated(raw, truncatedKey);
  // Extract outermost {...} in case the model added surrounding text
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) raw = objMatch[0];
  try {
    return JSON.parse(raw);
  } catch (_) {
    // Repair unquoted property names (e.g. {key: val} → {"key": val})
    let repaired = raw.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    try {
      return JSON.parse(repaired);
    } catch (__) {
      // Repair unescaped double-quotes inside string values (e.g. בע"מ in Hebrew company names).
      // Walk char-by-char: when inside a string, a '"' not followed by :,}] is unescaped.
      let fixed = '', inStr = false, esc = false;
      for (let i = 0; i < repaired.length; i++) {
        const c = repaired[i];
        if (esc) { fixed += c; esc = false; continue; }
        if (c === '\\') { fixed += c; esc = true; continue; }
        if (c === '"') {
          if (!inStr) { inStr = true; fixed += c; continue; }
          let j = i + 1;
          while (j < repaired.length && (repaired[j] === ' ' || repaired[j] === '\t')) j++;
          const nx = repaired[j] || '';
          if (nx === ':' || nx === ',' || nx === '}' || nx === ']' || nx === '') {
            inStr = false; fixed += c;
          } else {
            fixed += '\\"';
          }
          continue;
        }
        fixed += c;
      }
      return JSON.parse(fixed);
    }
  }
}

// ── SO → PO: Bank of Israel exchange rates (ILS per unit) ───────────
async function boiRates() {
  const r = await fetch('https://boi.org.il/PublicApi/GetExchangeRates');
  if (!r.ok) throw new Error('BOI ' + r.status);
  const d = await r.json();
  const rates = { ILS: 1 };
  (d.exchangeRates || []).forEach(x => {
    if (['USD', 'EUR', 'GBP'].includes(x.key) && x.currentExchangeRate) rates[x.key] = x.currentExchangeRate / (x.unit || 1);
  });
  return { ok: true, rates, date: (d.exchangeRates || [])[0]?.lastUpdate || '' };
}

// ── SO → PO: quote Excel the client could not map → offers ──────────
async function parseQuote(content) {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: `You read supplier quotation spreadsheets for electronic components (one supplier per file, or a comparison of several suppliers per part).
The input is a JSON object of sheet name → array of rows (each row an array of cell values).
Return ONLY a JSON object: { "offers": [ { "mpn", "mfg", "supplier", "unitPrice", "currency", "qty", "moq", "mult", "leadDays" } ] }
- One offer per part per supplier price. unitPrice is the unit price as a number (not an extended/total price, not a target or customer price).
- currency: 3-letter code (USD, EUR, GBP, ILS) or "". A number written as "5 USD" is in that currency (taken from the cell's format). A converted or total column (e.g. "NIS 1$ = 3.21") is not a supplier price and does not set a supplier's currency.
- qty: the quantity the supplier quoted (number, 0 if unknown). moq: minimum order qty (0 if none). mult: order multiple / SPQ (0 if none).
- leadDays: lead time in days as a number (weeks × 7, "stock" = 0), or null if not given.
- supplier: the supplier name from the sheet name, a column, or a header cell above its columns.
Output only the JSON object. No explanation, no markdown, no code fences.`,
    messages: [{ role: 'user', content }],
  });
  const truncated = message.stop_reason === 'max_tokens';
  const parsed = parseLooseJSON(message.content[0].text, truncated ? 'offers' : null);
  return { ok: true, offers: parsed.offers || [], truncated };
}

// ── SO → PO: online market price via Claude web search / fetch ──────
const PRICE_MODEL = 'claude-sonnet-5-5';
const PRICE_DOMAINS = ['octopart.com', 'findchips.com', 'digikey.com', 'mouser.com'];
const PRICE_SYSTEM = `You check current market prices for electronic components on distributor and aggregator websites.
For each part you are given (MPN, optional manufacturer, quantity):
1. Search Octopart or FindChips first to see which authorised distributors stock the part and at what price.
2. Then open (web_fetch) the Digi-Key and/or Mouser product page for the exact MPN and read the price-break table at the given quantity. If those pages cannot be fetched, fetch the Octopart or FindChips page for the part instead.
Only report a price you read on a page you fetched yourself in this conversation, and report that page's exact URL. Never estimate or recall a price.
Use the price break that applies to the requested quantity (the largest break quantity that is ≤ the requested quantity).
Return ONLY a JSON object: { "parts": [ { "mpn", "offers": [ { "source", "distributor", "url", "unitPrice", "currency", "priceBreakQty", "stock" } ] } ] }
- source: the site the page is on (octopart, findchips, digikey, mouser). distributor: who sells at that price (e.g. Digi-Key, Mouser, Arrow).
- unitPrice: number. currency: 3-letter code. priceBreakQty, stock: numbers (0 if unknown).
- A part with no price found gets "offers": [].
Output only the JSON object. No explanation, no markdown, no code fences.`;

async function priceCheck(parts) {
  const client = new Anthropic();
  const list = parts.map(p => `- MPN ${p.mpn}${p.mfg ? ' (' + p.mfg + ')' : ''}, qty ${p.qty}`).join('\n');
  const messages = [{ role: 'user', content: 'Check current prices for:\n' + list }];
  const fetched = new Map(); // url → page text, only for pages fetched in this run
  let message;
  // Server tools can pause a long turn; resume a few times
  for (let i = 0; i < 4; i++) {
    message = await client.beta.messages.create({
      model: PRICE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: PRICE_SYSTEM,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 3 * parts.length, allowed_domains: PRICE_DOMAINS },
        // Basic fetch variant on purpose: the raw page comes back in web_fetch_tool_result, which the verification below reads
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 4 * parts.length, allowed_domains: PRICE_DOMAINS, max_content_tokens: 30000 },
      ],
      messages,
    });
    for (const b of message.content) {
      if (b.type !== 'web_fetch_tool_result' || !b.content || b.content.type !== 'web_fetch_result') continue;
      const src = b.content.content && b.content.content.source;
      fetched.set(normUrl(b.content.url), String((src && src.data) || ''));
    }
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  if (message.stop_reason === 'refusal') throw new Error('price check declined');
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = parseLooseJSON(text);
  // An offer is verified only if its page was fetched in this run and shows the MPN and the price
  const out = (parsed.parts || []).map(p => ({
    mpn: p.mpn,
    offers: (p.offers || []).map(o => {
      const page = fetched.get(normUrl(o.url));
      return { ...o, verified: !!page && pageHasMpn(page, p.mpn) && pageHasPrice(page, o.unitPrice) };
    }),
  }));
  return { ok: true, parts: out, checkedAt: new Date().toISOString() };
}

const normUrl = u => String(u || '').trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
const squash = s => String(s || '').toUpperCase().replace(/[\s\-_/.]/g, '');
const pageHasMpn = (page, mpn) => !!mpn && squash(page).includes(squash(mpn));
function pageHasPrice(page, price) {
  const p = Number(price);
  if (!(p > 0)) return false;
  const nums = (page.replace(/,/g, '').match(/\d+\.\d+|\d+/g) || []).map(Number);
  return nums.some(n => Math.abs(n - p) <= p * 0.005);
}

// Cut a truncated reply after the last complete object in the given array and close it.
function closeTruncated(raw, key) {
  const start = raw.indexOf('[', raw.indexOf('"' + key + '"'));
  if (start < 0) return raw;
  let depth = 0, inStr = false, esc = false, lastEnd = -1;
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) lastEnd = i;
  }
  return lastEnd < 0 ? raw.slice(0, start + 1) + ']}' : raw.slice(0, lastEnd + 1) + ']}';
}
