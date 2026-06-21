import { state } from './state.js';
import { toast } from './utils.js';
import { parseRows, buildGroups } from './parse/so.js';
import { parsePORows, linkPOtoSO } from './parse/po.js';
import { applyOverridesToRows } from './persistence.js';
import { loadWizFile } from './upload.js';

// Callback set by main.js
let _onLaunched = null;
export function setWizardCallback(fn) { _onLaunched = fn; }

export function trigWiz(type) {
  document.getElementById(type === 'so' ? 'fi' : 'fi-po').click();
}

export function handleWizDrop(e, type) {
  e.preventDefault();
  document.getElementById(type === 'so' ? 'wiz-so' : 'wiz-po').classList.remove('dov');
  const f = e.dataTransfer.files[0];
  if (f) loadWizFile(f, type);
}

export function showWizard() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('upl').style.display = 'flex';
  state.wizSOFile = null;
  state.wizPOFile = null;
  resetWizCard('so');
  resetWizCard('po');
  document.getElementById('wiz-launch').style.display = 'none';
}

export function resetWizCard(type) {
  const card = document.getElementById('wiz-' + type);
  card.classList.remove('wiz-loaded');
  document.getElementById('wiz-' + type + '-status').textContent = 'לא נטען';
  document.getElementById('wiz-' + type + '-num').textContent = type === 'so' ? '1' : '2';
}

export function launchDashboard() {
  if (!state.wizSOFile) return;
  document.getElementById('spin').style.display = 'inline';
  state.allRows = parseRows(state.wizSOFile.raw);
  applyOverridesToRows(state.allRows);
  state.soGroups = buildGroups(state.allRows);
  document.getElementById('fbadge').textContent = state.wizSOFile.name + ' · ' + state.allRows.length + ' שורות';
  if (state.wizPOFile) {
    state.poRows = parsePORows(state.wizPOFile.raw);
    state.poLoaded = true;
    linkPOtoSO();
    document.getElementById('fbadge-po').style.display = 'inline';
    document.getElementById('fbadge-po').textContent = state.wizPOFile.name + ' · ' + state.poRows.length + ' שורות PO';
  }
  document.getElementById('spin').style.display = 'none';
  document.getElementById('upl').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('expbtn').style.display = 'inline-flex';
  document.getElementById('wiz-reload-btn').style.display = 'inline-flex';
  if (state.wizPOFile) {
    document.getElementById('supp-nopo').style.display = 'none';
    document.getElementById('supp-content').style.display = 'flex';
    document.getElementById('supp-content').style.flexDirection = 'column';
  }
  if (_onLaunched) _onLaunched();
  toast('✓ דשבורד נטען — ' + state.allRows.length + ' פריטים SO' + (state.wizPOFile ? ' + ' + state.poRows.length + ' PO' : ''));
}
