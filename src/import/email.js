import { toast } from '../utils.js';
import { openRFQModal } from '../views/rfq.js';

export function openEmailPasteModal() {
  document.getElementById('rfq-email-ta').value = '';
  document.getElementById('rfq-email-err').style.display = 'none';
  document.getElementById('rfq-email-modal').style.display = 'flex';
  _setEmailParsing(false);
  setTimeout(() => document.getElementById('rfq-email-ta').focus(), 50);
}

export function closeEmailPasteModal() { document.getElementById('rfq-email-modal').style.display = 'none'; }

export function _setEmailParsing(on) {
  document.getElementById('rfq-email-submit').disabled = on;
  document.getElementById('rfq-email-submit').textContent = on ? 'מנתח...' : '✨ נתח עם AI';
}

export async function submitEmailParse() {
  const emailText = document.getElementById('rfq-email-ta').value.trim();
  if (!emailText) return;
  document.getElementById('rfq-email-err').style.display = 'none';
  _setEmailParsing(true);
  try {
    const resp = await fetch('/api/parse-rfq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailText }) });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || 'שגיאה לא ידועה');
    closeEmailPasteModal();
    openRFQModal(json.data);
    toast('✓ AI זיהה את הפרטים — בדוק ואשר');
  } catch(e) {
    const el = document.getElementById('rfq-email-err');
    el.textContent = 'שגיאה: ' + e.message;
    el.style.display = 'block';
    _setEmailParsing(false);
  }
}
