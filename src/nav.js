import { expandNotes } from './utils.js';

let _renderRFQ = null;
let _stopRFQTimer = null;
export function setNavCallbacks(renderRFQ, stopRFQTimer) {
  _renderRFQ = renderRFQ;
  _stopRFQTimer = stopRFQTimer;
}

export function setMainView(v) {
  document.getElementById('boss-view').style.display = v === 'boss' ? 'flex' : 'none';
  document.getElementById('boss-view').style.flexDirection = v === 'boss' ? 'column' : '';
  document.getElementById('emp-view').style.display = v === 'emp' ? 'block' : 'none';
  document.getElementById('supp-view').style.display = v === 'supp' ? 'block' : 'none';
  document.getElementById('rfq-view').style.display = v === 'rfq' ? 'block' : 'none';
  document.getElementById('tab-boss').classList.toggle('on', v === 'boss');
  document.getElementById('tab-emp').classList.toggle('on', v === 'emp');
  document.getElementById('tab-supp').classList.toggle('on', v === 'supp');
  document.getElementById('tab-rfq').classList.toggle('on', v === 'rfq');
  if (v === 'rfq') { if (_renderRFQ) _renderRFQ(); }
  else { if (_stopRFQTimer) _stopRFQTimer(); }
}

export function setEmpTab(t) {
  document.getElementById('tab-today').style.display = t === 'today' ? 'block' : 'none';
  document.getElementById('tab-so').style.display = t === 'so' ? 'block' : 'none';
  document.getElementById('et1').classList.toggle('on', t === 'today');
  document.getElementById('et2').classList.toggle('on', t === 'so');
  if (t === 'today' && window.renderToday) window.renderToday();
}

export function openSOInEmp(so) {
  setMainView('emp');
  setEmpTab('so');
  requestAnimationFrame(() => {
    const id = 'so_' + so.replace(/\W/g, '_');
    const card = document.getElementById('card_' + id);
    if (!card) return;
    const det = document.getElementById('det_' + id);
    if (det && !det.classList.contains('open')) {
      det.classList.add('open');
      document.getElementById('chev_' + id)?.classList.add('open');
      expandNotes(det);
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    document.getElementById('fsbtn').textContent = '✕';
  } else {
    document.exitFullscreen();
    document.getElementById('fsbtn').textContent = '⛶';
  }
}
