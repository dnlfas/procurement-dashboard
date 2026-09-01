import { p2 } from './utils.js';

function fmt(d) {
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export async function refreshDataStatus() {
  const el = document.getElementById('last-update-badge');
  if (!el) return;
  try {
    const r = await fetch('/api/data-status');
    if (!r.ok) return;
    const { soUpdatedAt, poUpdatedAt } = await r.json();
    const so = soUpdatedAt ? new Date(soUpdatedAt) : null;
    const po = poUpdatedAt ? new Date(poUpdatedAt) : null;
    const latest = [so, po].filter(Boolean).sort((a, b) => b - a)[0];
    if (!latest) { el.textContent = ''; el.title = ''; return; }
    el.textContent = `🕒 עודכן: ${fmt(latest)}`;
    el.title = `SO: ${so ? fmt(so) : '—'}  ·  PO: ${po ? fmt(po) : '—'}`;
  } catch (e) {}
}
