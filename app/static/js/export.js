/* export.js — Exports tab: create, list, download, delete exports */
(function () {
  'use strict';

  let _activeFile = null;

  function init() {
    document.getElementById('create-export-btn')?.addEventListener('click', createExport);
  }

  function setActiveFile(filename) {
    _activeFile = filename;
  }

  async function createExport() {
    if (!_activeFile) {
      if (window.MagnifiApp) window.MagnifiApp.toast('No file loaded', 'error');
      return;
    }
    const format = document.getElementById('export-format')?.value || 'csv';
    try {
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: _activeFile, format }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (window.MagnifiApp) window.MagnifiApp.toast(data.detail || 'Export failed', 'error');
        return;
      }
      if (window.MagnifiApp) window.MagnifiApp.toast(`Exported: ${data.filename}`, 'success');
      loadList();
    } catch (e) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Export request failed', 'error');
    }
  }

  async function loadList() {
    const list = document.getElementById('exports-list');
    if (!list) return;
    try {
      const res = await fetch('/api/exports');
      const data = await res.json();
      const exports = data.exports || [];

      if (!exports.length) {
        list.innerHTML = '<div class="detail-empty" style="padding:20px 16px">No exports yet — click "Create Export" to export the current file</div>';
        return;
      }

      list.innerHTML = '';
      for (const exp of exports) {
        const item = document.createElement('div');
        item.className = 'export-item';
        const date = new Date(exp.modified).toLocaleString();
        const size = _fmtSize(exp.size);
        item.innerHTML = `
          <div class="export-name" title="${_esc(exp.name)}">${_esc(exp.name)}</div>
          <div class="export-size">${size}</div>
          <div class="export-date">${date}</div>
          <div class="export-actions">
            <button class="icon-btn sm" data-name="${_esc(exp.name)}" title="Download" onclick="window.MagnifiExport.download('${_esc(exp.name)}')">
              <i class="bi bi-download"></i>
            </button>
            <button class="icon-btn sm" data-name="${_esc(exp.name)}" title="Delete" onclick="window.MagnifiExport.remove('${_esc(exp.name)}')">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        `;
        list.appendChild(item);
      }
    } catch (e) {
      list.innerHTML = '<div class="detail-empty">Failed to load exports</div>';
    }
  }

  function download(filename) {
    const a = document.createElement('a');
    a.href = `/api/exports/download/${encodeURIComponent(filename)}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function remove(filename) {
    if (!confirm(`Delete export "${filename}"?`)) return;
    try {
      const res = await fetch(`/api/exports/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (res.ok) {
        if (window.MagnifiApp) window.MagnifiApp.toast(`Deleted ${filename}`, 'info');
        loadList();
      }
    } catch (e) {}
  }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  window.MagnifiExport = { init, setActiveFile, loadList, download, remove };
})();
