/* row-detail.js — Row detail panel rendering and copy actions */
(function () {
  'use strict';

  let _currentRow = null;
  let _copyFeedbackTimer = null;

  function render(row) {
    _currentRow = row;
    const body = document.getElementById('detail-body');
    if (!body) return;

    if (!row) {
      body.innerHTML = '<div class="detail-empty">Select a row to view details</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const [key, val] of Object.entries(row)) {
      const field = document.createElement('div');
      field.className = 'detail-field';

      const isNull = val === null || val === undefined;
      const display = isNull ? '' : String(val);
      const cls = isNull ? ' null' : '';

      field.innerHTML = `
        <div class="detail-field-name">${_esc(key)}</div>
        <div class="detail-field-val${cls}">${isNull ? '<em>NULL</em>' : _esc(display)}</div>
      `;
      frag.appendChild(field);
    }

    body.innerHTML = '';
    body.appendChild(frag);
  }

  function clear() {
    _currentRow = null;
    const body = document.getElementById('detail-body');
    if (body) body.innerHTML = '<div class="detail-empty">Select a row to view details</div>';
  }

  function copyAsJSON() {
    if (!_currentRow) {
      window.MagnifiApp?.toast('Select a row first', 'info');
      return;
    }
    _copy(JSON.stringify(_currentRow, null, 2));
    _showCopyFeedback('JSON copied');
  }

  function copyAsCSV() {
    if (!_currentRow) {
      window.MagnifiApp?.toast('Select a row first', 'info');
      return;
    }
    const keys = Object.keys(_currentRow);
    const vals = keys.map(k => {
      const v = _currentRow[k];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    });
    _copy(keys.join(',') + '\n' + vals.join(','));
    _showCopyFeedback('CSV copied');
  }

  function copyAsText() {
    if (!_currentRow) {
      window.MagnifiApp?.toast('Select a row first', 'info');
      return;
    }
    const lines = Object.entries(_currentRow)
      .map(([k, v]) => `${k}: ${v === null ? 'NULL' : v}`)
      .join('\n');
    _copy(lines);
    _showCopyFeedback('Text copied');
  }

  function _copy(text) {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  function _showCopyFeedback(message) {
    const el = document.getElementById('detail-copy-feedback');
    if (!el) return;

    if (_copyFeedbackTimer) {
      clearTimeout(_copyFeedbackTimer);
      _copyFeedbackTimer = null;
    }

    el.textContent = message;
    el.classList.add('show');

    _copyFeedbackTimer = setTimeout(() => {
      el.classList.remove('show');
      _copyFeedbackTimer = null;
    }, 1000);
  }

  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    document.getElementById('copy-json')?.addEventListener('click', copyAsJSON);
    document.getElementById('copy-csv')?.addEventListener('click', copyAsCSV);
    document.getElementById('copy-text')?.addEventListener('click', copyAsText);
  }

  window.MagnifiDetail = { init, render, clear, copyAsJSON, copyAsCSV, copyAsText };
})();
