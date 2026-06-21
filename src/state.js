export const TODAY = new Date(2026, 4, 19);
export const NK = 'openorders_v5_notes';
export const SETTINGS_KEY = 'oo_gdrive_settings';
export const RFQ_KEY = 'oo_rfq';

export const state = {
  allRows: [], soGroups: [], filteredGroups: [], soReg: {},
  poRows: [], poLoaded: false, poData: [],
  notes: {}, statusOvr: {}, fieldOvr: {}, pullOrders: {},
  rfqData: [], pendingCustPOs: {},
  sspOpen: true, sspAllOpen: false,
  xlsxReady: false, xlsxQ: [],
  odSettings: {}, _syncTimer: null, _rfqTimer: null,
  isTV: window.innerWidth >= 1920,
  _importFile: null, _importExcelRows: [], _importChanges: [], _importTab: 'text', _importSourceType: null,
  _icsGroup: null, _rfqFilter: 'all', _tt: null,
  wizSOFile: null, wizPOFile: null,
};

// Load persisted state from localStorage
try { state.statusOvr = JSON.parse(localStorage.getItem('oo_status') || '{}'); } catch(e) {}
try { state.fieldOvr = JSON.parse(localStorage.getItem('oo_fields') || '{}'); } catch(e) {}
try { state.notes = JSON.parse(localStorage.getItem(NK) || '{}'); } catch(e) {}
try { state.pullOrders = JSON.parse(localStorage.getItem('oo_pull') || '{}'); } catch(e) {}
try { state.odSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch(e) {}
try { state.rfqData = JSON.parse(localStorage.getItem(RFQ_KEY) || '[]'); } catch(e) {}
try { state.pendingCustPOs = JSON.parse(localStorage.getItem('oo_pending_cpo') || '{}'); } catch(e) {}

// Init default pull orders
['4441445613','4441489719','4441512541','4441439631'].forEach(p => {
  if (!state.pullOrders[p]) state.pullOrders[p] = true;
});
try { localStorage.setItem('oo_pull', JSON.stringify(state.pullOrders)); } catch(e) {}
