const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (req.method !== 'POST') return res.status(405).end();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { emailText } = JSON.parse(body);
    if (!emailText || !emailText.trim()) return res.status(400).json({ error: 'empty' });

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You extract RFQ (request for quotation) details from email text written in any language.
Return ONLY a valid JSON object with exactly these fields:
- customer: string (company or person name sending the request, or "" if unknown)
- reqNum: string (reference/RFQ/inquiry number if explicitly mentioned, or "")
- items: string (complete list of parts/items requested — preserve MPN codes, quantities, and descriptions; use newlines to separate items)
- receivedDate: string (ISO datetime "YYYY-MM-DDTHH:MM" if the email date is found, otherwise "")
Output only the JSON object. No explanation, no markdown, no code fences.`,
      messages: [{ role: 'user', content: emailText }],
    });

    const raw = message.content[0].text.trim();
    const parsed = JSON.parse(raw);
    res.json({ ok: true, data: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
