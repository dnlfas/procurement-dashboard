import { p2 } from './utils.js';

function fmt(d) {
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// version.json is written by .githooks/pre-commit on every commit
export async function showVersion() {
  const el = document.getElementById('version-badge');
  if (!el) return;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const { version, date } = await r.json();
    const d = new Date(date);
    el.textContent = `v${version} · ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
    el.title = `גרסה ${version} · ${fmt(d)}`;
  } catch (e) {}
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
