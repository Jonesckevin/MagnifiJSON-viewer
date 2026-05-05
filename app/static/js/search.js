/* search.js — Debounced string / regex search with column scoping */
(function () {
  'use strict';

  let _debounceTimer = null;
  let _onSearch = null; // callback({text, regex, column})
  let _regexMode = false;
  let _schema = [];

  function init(onSearch) {
    _onSearch = onSearch;

    const input  = document.getElementById('search-input');
    const toggle = document.getElementById('regex-toggle');
    const colSel = document.getElementById('search-col');
    const clearBtn = document.getElementById('clear-search');

    if (!input) return;

    input.addEventListener('input', _debounce);
    colSel?.addEventListener('change', () => _fire());

    toggle?.addEventListener('click', () => {
      _regexMode = !_regexMode;
      toggle.classList.toggle('active', _regexMode);
      toggle.title = _regexMode ? 'Regex mode (click to switch to literal)' : 'Literal mode (click to switch to regex)';
      _fire();
    });

    clearBtn?.addEventListener('click', () => {
      input.value = '';
      _fire();
    });
  }

  function updateSchema(schema) {
    _schema = schema;
    const colSel = document.getElementById('search-col');
    if (!colSel) return;
    const prev = colSel.value;
    colSel.innerHTML = '<option value="">All columns</option>';
    for (const col of schema) {
      const opt = document.createElement('option');
      opt.value = col.name;
      opt.textContent = col.name;
      if (col.name === prev) opt.selected = true;
      colSel.appendChild(opt);
    }
  }

  function reset() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    const colSel = document.getElementById('search-col');
    if (colSel) colSel.value = '';
  }

  function getValue() {
    return {
      text:   document.getElementById('search-input')?.value ?? '',
      regex:  _regexMode,
      column: document.getElementById('search-col')?.value ?? '',
    };
  }

  function _debounce() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(_fire, 280);
  }

  function _fire() {
    if (_onSearch) _onSearch(getValue());
  }

  window.MagnifiSearch = { init, updateSchema, reset, getValue };
})();
