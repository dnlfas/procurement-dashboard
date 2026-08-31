// ── State & Utils ──────────────────────────────────────────────
import { state } from './state.js';
import { toast, showQR, closeQR, expandNotes } from './utils.js';

// ── Auth ───────────────────────────────────────────────────────
import { setInitCallback, checkAuth, doLogin, doLogout } from './auth.js';

// ── Persistence ────────────────────────────────────────────────
import {
  setRefreshCallback, syncOverrides, loadOverridesFromBlob,
  saveField, saveStatus, saveNote, cleanupNotes, exportNotes
} from './persistence.js';

// ── Parse ──────────────────────────────────────────────────────
import { buildGroups } from './parse/so.js';
import { linkPOtoSO } from './parse/po.js';

// ── Upload ────────────────────────────────────────────────────
import {
  setUploadCallbacks, trigUp, trigUpPO,
  handleDrop, handleFile, handleFilePO, handleTopbarUpload
} from './upload.js';

// ── Wizard ────────────────────────────────────────────────────
import {
  setWizardCallback, trigWiz, handleWizDrop, showWizard, resetWizCard, launchDashboard
} from './wizard.js';

// ── Nav ───────────────────────────────────────────────────────
import { setNavCallbacks, setMainView, setEmpTab, openSOInEmp, toggleFullscreen } from './nav.js';

// ── Views: Boss ───────────────────────────────────────────────
import {
  renderBoss, renderChart, renderDueThisWeek, renderCustRisk, renderSuppList, renderCoverage
} from './views/boss.js';

// ── Views: Employee ───────────────────────────────────────────
import {
  renderToday, fillSelects, fillSel, applyFilters,
  renderSOList, renderSOCard, setSOStatus, hdrClk, togSO, expandAll, buildLT, buildLR
} from './views/employee.js';

// ── Views: Supplier ───────────────────────────────────────────
import { renderSupplierKPIs, renderSuppliers, buildPOTable } from './views/supplier.js';

// ── Views: SSP ────────────────────────────────────────────────
import { renderSSP, toggleSSP, togCG, togSODetail, sspShowAll } from './views/ssp.js';

// ── Views: MOD ────────────────────────────────────────────────
import { renderMOD, togMODSO } from './views/mod.js';

// ── Views: RFQ ────────────────────────────────────────────────
import {
  renderRFQ, renderRFQList, setRFQFilter,
  addRFQRow, removeRFQRow, openRFQModal, closeRFQModal, submitRFQModal
} from './views/rfq.js';

// ── RFQ Engine ────────────────────────────────────────────────
import {
  startRFQTimer, stopRFQTimer, setRFQStatus, saveRFQNote, deleteRFQ
} from './rfq/engine.js';

// ── Import ────────────────────────────────────────────────────
import {
  openImportModal, closeImportModal, importSelectTab, handleImportFile,
  submitImportParse, openImportPreview, closeImportPreview,
  importChkChange, importToggleAll, applyImportChanges, applyPendingCustPOs,
  injectTempOrders, injectSOImports, updateImportBadge
} from './import/engine.js';

// ── Import: Email ─────────────────────────────────────────────
import {
  openEmailPasteModal, closeEmailPasteModal, submitEmailParse
} from './import/email.js';

// ── Export: ICS ───────────────────────────────────────────────
import {
  dlSOICS, closeICSModal, icsUpdateCustomFields,
  _icsPresetOnDay, _icsPreset7Before, _icsTaskToday, submitICSDownload
} from './export/ics.js';

// ── Notifications ─────────────────────────────────────────────
import {
  initNotifications, openNotifyModal, closeNotifyModal, notifyPreset, notifyCustom, cancelReminder
} from './notify.js';

// ── API / GDrive ──────────────────────────────────────────────
import {
  setApiCallbacks, openSettings, closeSettings,
  markInputChanged, saveAndFetch, clearSettings, fetchNow
} from './api.js';

// ─────────────────────────────────────────────────────────────
// Render-all: called after data is loaded or refreshed
// ─────────────────────────────────────────────────────────────
function renderAll() {
  fillSelects();
  applyFilters();
  renderToday();
  renderBoss();
  renderSSP();
  renderRFQ();
  renderMOD();
  renderSupplierKPIs();
  renderSuppliers();
  updateImportBadge();
}

// ─────────────────────────────────────────────────────────────
// Callback registrations
// ─────────────────────────────────────────────────────────────
setRefreshCallback(renderAll);

setInitCallback(initApp);

setUploadCallbacks(
  // onSO: after SO file parsed
  function onSOLoaded() {
    fillSelects();
    applyFilters();
    renderToday();
    renderBoss();
    renderSSP();
    renderRFQ();
    renderMOD();
    updateImportBadge();
  },
  // onPO: after PO file parsed
  function onPOLoaded() {
    renderSupplierKPIs();
    renderSuppliers();
  }
);

setWizardCallback(function onWizardDone() {
  renderAll();
});

setNavCallbacks(renderRFQ, stopRFQTimer);

setApiCallbacks(function onDataLoaded(type) {
  if (type === 'so') {
    fillSelects();
    applyFilters();
    renderToday();
    renderBoss();
    renderSSP();
    renderRFQ();
    renderMOD();
    updateImportBadge();
  } else if (type === 'po') {
    renderSupplierKPIs();
    renderSuppliers();
  }
});

// ─────────────────────────────────────────────────────────────
// initApp — called after auth succeeds
// ─────────────────────────────────────────────────────────────
async function initApp() {
  await loadOverridesFromBlob();
  updateImportBadge();
  // If data already loaded (via wizard), render
  if (state.allRows && state.allRows.length) {
    renderAll();
  }
  // If GDrive settings exist, auto-fetch
  if (state.odSettings && state.odSettings.soUrl) {
    fetchNow();
  }
}

// ─────────────────────────────────────────────────────────────
// Expose ALL onclick-referenced functions on window
// ─────────────────────────────────────────────────────────────
Object.assign(window, {
  // state (needed for onclick attribute access)
  state,

  // utils
  toast, showQR, closeQR, expandNotes,

  // auth
  doLogin, doLogout,

  // persistence
  syncOverrides, saveField, saveStatus, saveNote, cleanupNotes, exportNotes,

  // upload
  trigUp, trigUpPO, handleDrop, handleFile, handleFilePO, handleTopbarUpload,

  // wizard
  trigWiz, handleWizDrop, showWizard, resetWizCard, launchDashboard,

  // nav
  setMainView, setEmpTab, openSOInEmp, toggleFullscreen,

  // views — boss
  renderBoss, renderChart, renderDueThisWeek, renderCustRisk, renderSuppList, renderCoverage,

  // views — employee
  renderToday, fillSelects, applyFilters, renderSOList, renderSOCard,
  setSOStatus, hdrClk, togSO, expandAll, buildLT, buildLR,

  // views — mod
  renderMOD, togMODSO,

  // views — supplier
  renderSupplierKPIs, renderSuppliers, buildPOTable,

  // views — SSP
  renderSSP, toggleSSP, togCG, togSODetail, sspShowAll,

  // views — RFQ
  renderRFQ, renderRFQList, setRFQFilter,
  addRFQRow, removeRFQRow, openRFQModal, closeRFQModal, submitRFQModal,

  // rfq engine
  startRFQTimer, stopRFQTimer, setRFQStatus, saveRFQNote, deleteRFQ,

  // import
  openImportModal, closeImportModal, importSelectTab, handleImportFile,
  submitImportParse, openImportPreview, closeImportPreview,
  importChkChange, importToggleAll, applyImportChanges, applyPendingCustPOs,
  injectTempOrders, injectSOImports, updateImportBadge,

  // import email
  openEmailPasteModal, closeEmailPasteModal, submitEmailParse,

  // export ICS
  dlSOICS, closeICSModal, icsUpdateCustomFields,
  _icsPresetOnDay, _icsPreset7Before, _icsTaskToday, submitICSDownload,

  // notifications
  openNotifyModal, closeNotifyModal, notifyPreset, notifyCustom, cancelReminder,

  // api / settings
  openSettings, closeSettings, markInputChanged, saveAndFetch, clearSettings, fetchNow,
});

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth(); // calls initApp() via _initCallback after auth passes
  initNotifications();
});
