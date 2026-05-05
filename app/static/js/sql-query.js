/* sql-query.js — DuckDB SQL editor with highlighting and autocomplete */
(function () {
  'use strict';

  let _activeFile = null;
  let _schema = [];
  let _savedQueries = [];
  let _acItems = [];
  let _acIndex = -1;
  let _validateTimer = null;
  const _sectionSnapHeights = [96, 120, 160, 220, 280, 340, 420, 520];
  const _sectionDefaults = {
    'sql-builder-wrap': 220,
    'sql-tables-list': 130,
    'saved-queries-list': 260,
  };

  const KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'DISTINCT',
    'WITH', 'AS', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
    'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'BETWEEN',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'EXPLAIN', 'DESCRIBE', 'SHOW'
  ];

  const DEFAULT_QUERY_TEMPLATES = [
    {
      name: 'Preview 100 rows',
      description: 'Quick look at the dataset',
      sql: view => `SELECT * FROM "${view}" LIMIT 100`,
    },
    {
      name: 'Row count',
      description: 'Total records in the current table',
      sql: view => `SELECT COUNT(*) AS total_rows FROM "${view}"`,
    },
    {
      name: 'Schema info',
      description: 'Column names and types',
      sql: view => `DESCRIBE "${view}"`,
    },
    {
      name: 'Top event types',
      description: 'Most common values in "type" if present',
      sql: view => `SELECT "type", COUNT(*) AS c\nFROM "${view}"\nGROUP BY "type"\nORDER BY c DESC\nLIMIT 25`,
    },
  ];

  function init() {
    const input = document.getElementById('sql-input');
    const highlight = document.getElementById('sql-highlight');

    document.getElementById('sql-execute')?.addEventListener('click', execute);
    document.getElementById('sql-clear')?.addEventListener('click', clearEditor);
    document.getElementById('sql-save-btn')?.addEventListener('click', openSaveDialog);
    document.getElementById('save-query-confirm')?.addEventListener('click', saveQuery);
    document.getElementById('save-query-cancel')?.addEventListener('click', closeSaveDialog);
    document.getElementById('sql-export-btn')?.addEventListener('click', exportResults);
    document.getElementById('qb-build-btn')?.addEventListener('click', _buildQueryFromBuilder);
    document.getElementById('qb-add-filter-btn')?.addEventListener('click', _addFilterFromBuilder);
    document.getElementById('sql-columns-search')?.addEventListener('input', _applyColumnSearchFilter);
    document.getElementById('saved-queries-search')?.addEventListener('input', _applySavedSearchFilter);
    document.getElementById('sql-reset-sections')?.addEventListener('click', _resetSectionHeights);
    _initSectionResizers();
    _restoreSectionHeights();

    if (input && highlight) {
      input.addEventListener('input', () => {
        _syncHighlight();
        _validateSoon();
        _maybeShowAutocomplete(false);
      });
      input.addEventListener('scroll', () => {
        highlight.scrollTop = input.scrollTop;
        highlight.scrollLeft = input.scrollLeft;
      });
      input.addEventListener('keydown', _onEditorKeyDown);
    }

    document.addEventListener('click', e => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest('#sql-autocomplete')) _hideAutocomplete();
    });

    _wireSavedQueryActions();

    loadSavedQueries();
    _syncHighlight();
    _renderHelpers();
  }

  function setActiveFile(filename, schema) {
    _activeFile = filename;
    _schema = schema || [];

    const hint = document.getElementById('sql-view-hint');
    if (hint && filename) {
      hint.textContent = `Table: "${_toViewName(filename)}"`;
    } else if (hint) {
      hint.textContent = '';
    }

    _renderHelpers();
    renderDefaultQueries();
    _validateSoon();
  }

  function _toViewName(filename) {
    const stem = (filename || '').replace(/\.\w+$/, '');
    let name = stem.replace(/[^\w]/g, '_');
    if (name && /^\d/.test(name)) name = `f_${name}`;
    return name || 'json_view';
  }

  function _renderHelpers() {
    const tableList = document.getElementById('sql-tables-list');
    const colList = document.getElementById('sql-columns-list');
    if (!tableList || !colList) return;

    const view = _activeFile ? _toViewName(_activeFile) : null;
    if (!view) {
      tableList.innerHTML = '<div class="detail-empty">No table loaded</div>';
      colList.innerHTML = '<div class="detail-empty">Load a file to list columns</div>';
      _populateBuilderColumns();
      _applyColumnSearchFilter();
      return;
    }

    tableList.innerHTML = '';
    const tableChip = document.createElement('button');
    tableChip.className = 'sql-helper-chip';
    tableChip.textContent = `"${view}"`;
    tableChip.title = 'Insert table name';
    tableChip.addEventListener('click', () => _insertTextAtCaret(`"${view}"`));
    tableList.appendChild(tableChip);

    colList.innerHTML = '';
    if (!_schema.length) {
      colList.innerHTML = '<div class="detail-empty">No columns available</div>';
      return;
    }

    for (const column of _schema) {
      const chip = document.createElement('button');
      chip.className = 'sql-helper-chip';
      chip.textContent = column.name;
      chip.dataset.name = column.name.toLowerCase();
      chip.title = column.type || '';
      chip.addEventListener('click', () => _insertTextAtCaret(`"${column.name}"`));
      colList.appendChild(chip);
    }

    _populateBuilderColumns();
    _applyColumnSearchFilter();
  }

  function _applyColumnSearchFilter() {
    const input = document.getElementById('sql-columns-search');
    const colList = document.getElementById('sql-columns-list');
    if (!input || !colList) return;

    const needle = input.value.trim().toLowerCase();
    const chips = [...colList.querySelectorAll('.sql-helper-chip')];
    if (!chips.length) return;

    let visible = 0;
    chips.forEach(chip => {
      const name = chip.dataset.name || chip.textContent.toLowerCase();
      const show = !needle || name.includes(needle);
      chip.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });

    let empty = colList.querySelector('.sql-filter-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'detail-empty sql-filter-empty hidden';
      empty.textContent = 'No matching columns';
      colList.appendChild(empty);
    }
    empty.classList.toggle('hidden', visible > 0);
  }

  function _populateBuilderColumns() {
    const colSelect = document.getElementById('qb-column');
    const orderSelect = document.getElementById('qb-order-col');
    if (!colSelect || !orderSelect) return;

    if (!_schema.length) {
      colSelect.innerHTML = '<option value="">No columns</option>';
      orderSelect.innerHTML = '<option value="">No columns</option>';
      return;
    }

    colSelect.innerHTML = '';
    orderSelect.innerHTML = '<option value="">(none)</option>';
    for (const col of _schema) {
      const a = document.createElement('option');
      a.value = col.name;
      a.textContent = col.name;
      colSelect.appendChild(a);

      const b = document.createElement('option');
      b.value = col.name;
      b.textContent = col.name;
      orderSelect.appendChild(b);
    }
  }

  function _initSectionResizers() {
    document.querySelectorAll('.sql-section-resize').forEach(handle => {
      handle.addEventListener('dblclick', () => {
        const targetId = handle.dataset.target;
        if (!targetId) return;
        const defaultHeight = _sectionDefaults[targetId];
        if (!defaultHeight) return;

        const target = document.getElementById(targetId);
        if (!target) return;
        target.style.height = `${defaultHeight}px`;
        target.style.flex = '0 0 auto';
        _saveSectionHeight(targetId, defaultHeight);
      });

      handle.addEventListener('mousedown', e => {
        const targetId = handle.dataset.target;
        const target = targetId ? document.getElementById(targetId) : null;
        if (!target) return;

        e.preventDefault();
        handle.classList.add('dragging');
        const startY = e.clientY;
        const startH = target.getBoundingClientRect().height;
        const maxH = Math.max(220, Math.floor(window.innerHeight * 0.72));

        const onMove = ev => {
          const next = Math.max(72, Math.min(maxH, startH + (ev.clientY - startY)));
          target.style.height = `${next}px`;
          target.style.flex = '0 0 auto';
        };

        const onUp = () => {
          const current = target.getBoundingClientRect().height;
          const snapped = _closestSnap(current, maxH);
          target.style.height = `${snapped}px`;
          target.style.flex = '0 0 auto';
          _saveSectionHeight(target.id, snapped);
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function _closestSnap(value, maxH) {
    const candidates = _sectionSnapHeights.filter(v => v <= maxH).concat([Math.min(maxH, Math.round(value))]);
    let closest = candidates[0];
    let bestDist = Math.abs(value - candidates[0]);
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d < bestDist) {
        bestDist = d;
        closest = c;
      }
    }
    return Math.max(72, Math.min(maxH, closest));
  }

  function _saveSectionHeight(id, height) {
    if (!id) return;
    try {
      localStorage.setItem(`sql.section.height.${id}`, String(Math.round(height)));
    } catch (e) {
      // no-op
    }
  }

  function _restoreSectionHeights() {
    ['sql-builder-wrap', 'sql-tables-list', 'saved-queries-list'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      try {
        const raw = localStorage.getItem(`sql.section.height.${id}`);
        const h = Number(raw || 0);
        if (h > 0) {
          el.style.height = `${h}px`;
          el.style.flex = '0 0 auto';
        } else if (_sectionDefaults[id]) {
          el.style.height = `${_sectionDefaults[id]}px`;
          el.style.flex = '0 0 auto';
        }
      } catch (e) {
        // no-op
      }
    });
  }

  function _resetSectionHeights() {
    Object.entries(_sectionDefaults).forEach(([id, h]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.height = `${h}px`;
      el.style.flex = '0 0 auto';
      _saveSectionHeight(id, h);
    });
    window.MagnifiApp?.toast('SQL panel sizes reset', 'success');
  }

  function _buildQueryFromBuilder() {
    if (!_activeFile) return;

    const view = _toViewName(_activeFile);
    const col = document.getElementById('qb-column')?.value || '';
    const op = document.getElementById('qb-op')?.value || '=';
    const rawVal = document.getElementById('qb-value')?.value || '';
    const orderCol = document.getElementById('qb-order-col')?.value || '';
    const orderDir = document.getElementById('qb-order-dir')?.value || 'ASC';
    const limit = Number(document.getElementById('qb-limit')?.value || 100);

    let sql = `SELECT *\nFROM "${view}"`;
    if (col && rawVal.trim()) {
      sql += `\nWHERE "${col}" ${op} ${_readBuilderLiteral(rawVal)}`;
    }
    if (orderCol) {
      sql += `\nORDER BY "${orderCol}" ${orderDir === 'DESC' ? 'DESC' : 'ASC'}`;
    }
    sql += `\nLIMIT ${Math.min(Math.max(limit, 1), 10000)}`;

    _setEditorValue(sql);
  }

  function _addFilterFromBuilder() {
    const col = document.getElementById('qb-column')?.value || '';
    const op = document.getElementById('qb-op')?.value || '=';
    const rawVal = document.getElementById('qb-value')?.value || '';
    if (!col || !rawVal.trim()) return;

    const ta = document.getElementById('sql-input');
    if (!ta) return;
    const clause = `"${col}" ${op} ${_readBuilderLiteral(rawVal)}`;
    const src = ta.value || '';

    if (/\bWHERE\b/i.test(src)) {
      _setEditorValue(`${src}\n  AND ${clause}`);
    } else if (src.trim()) {
      _setEditorValue(`${src}\nWHERE ${clause}`);
    } else if (_activeFile) {
      _setEditorValue(`SELECT *\nFROM "${_toViewName(_activeFile)}"\nWHERE ${clause}\nLIMIT 100`);
    }
  }

  function _readBuilderLiteral(raw) {
    const t = String(raw).trim();
    if (/^[-+]?\d+(\.\d+)?$/.test(t)) return t;
    return `'${t.replace(/'/g, "''")}'`;
  }

  function _setEditorValue(sql) {
    const ta = document.getElementById('sql-input');
    if (!ta) return;
    ta.value = sql;
    _syncHighlight();
    _validateSoon();
  }

  function _syncHighlight() {
    const input = document.getElementById('sql-input');
    const highlight = document.getElementById('sql-highlight');
    if (!input || !highlight) return;

    const raw = input.value || '';
    let html = _esc(raw);

    html = html.replace(/(--.*)$/gm, '<span class="sql-token-comment">$1</span>');
    html = html.replace(/'([^']|'')*'/g, '<span class="sql-token-string">$&</span>');
    html = html.replace(/\b\d+(\.\d+)?\b/g, '<span class="sql-token-number">$&</span>');

    const kwPattern = new RegExp(
      '\\b(' + KEYWORDS
        .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
        .join('|') + ')\\b',
      'gi'
    );
    html = html.replace(kwPattern, '<span class="sql-token-keyword">$1</span>');

    highlight.innerHTML = html || '&nbsp;';
  }

  function _validateSoon() {
    clearTimeout(_validateTimer);
    _validateTimer = setTimeout(validateEditor, 350);
  }

  async function validateEditor() {
    const input = document.getElementById('sql-input');
    if (!input) return;

    const sql = input.value || '';
    if (!sql.trim()) {
      input.classList.remove('invalid', 'valid');
      _setStatus('', '');
      return;
    }

    try {
      const res = await fetch('/api/query/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = await res.json();

      if (data.valid) {
        input.classList.add('valid');
        input.classList.remove('invalid');
        _setStatus(data.message || 'SQL looks valid', 'success');
      } else {
        input.classList.add('invalid');
        input.classList.remove('valid');
        _setStatus(data.message || 'SQL invalid', 'error');
      }
    } catch (e) {
      input.classList.remove('valid');
      _setStatus('Validation unavailable', '');
    }
  }

  function _onEditorKeyDown(e) {
    const ta = e.target;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      execute();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      _maybeShowAutocomplete(true);
      return;
    }

    if (e.key === 'Tab') {
      if (_applyAutocomplete()) {
        e.preventDefault();
      } else {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        _syncHighlight();
        _validateSoon();
      }
      return;
    }

    if (!_acItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _acIndex = Math.min(_acItems.length - 1, _acIndex + 1);
      _renderAutocomplete();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _acIndex = Math.max(0, _acIndex - 1);
      _renderAutocomplete();
    } else if (e.key === 'Enter') {
      if (_applyAutocomplete()) e.preventDefault();
    } else if (e.key === 'Escape') {
      _hideAutocomplete();
    }
  }

  function _tokenBeforeCaret() {
    const ta = document.getElementById('sql-input');
    if (!ta) return '';
    const left = ta.value.slice(0, ta.selectionStart);
    const match = left.match(/[\w.]+$/);
    return match ? match[0] : '';
  }

  function _maybeShowAutocomplete(force) {
    const token = _tokenBeforeCaret();
    if (!force && token.length < 1) {
      _hideAutocomplete();
      return;
    }

    const view = _activeFile ? _toViewName(_activeFile) : '';
    const pool = [
      ...KEYWORDS.map(value => ({ value, kind: 'kw' })),
      ...(_schema || []).map(col => ({ value: col.name, kind: 'col' })),
      ...(view ? [{ value: view, kind: 'table' }] : []),
    ];

    const needle = token.toLowerCase();
    const matches = pool
      .filter(item => force || item.value.toLowerCase().includes(needle))
      .slice(0, 20);

    if (!matches.length) {
      _hideAutocomplete();
      return;
    }

    _acItems = matches;
    _acIndex = 0;
    _renderAutocomplete();
  }

  function _renderAutocomplete() {
    const box = document.getElementById('sql-autocomplete');
    if (!box) return;
    if (!_acItems.length) {
      _hideAutocomplete();
      return;
    }

    box.innerHTML = '';
    _acItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = `sql-ac-item ${idx === _acIndex ? 'active' : ''}`;
      row.innerHTML = `<span>${_esc(item.value)}</span><span class="sql-ac-kind">${item.kind}</span>`;
      row.addEventListener('mousedown', ev => {
        ev.preventDefault();
        _acIndex = idx;
        _applyAutocomplete();
      });
      box.appendChild(row);
    });

    box.classList.remove('hidden');
  }

  function _applyAutocomplete() {
    if (!_acItems.length || _acIndex < 0) return false;

    const ta = document.getElementById('sql-input');
    if (!ta) return false;

    const chosen = _acItems[_acIndex];
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const left = ta.value.slice(0, start);
    const tokenMatch = left.match(/[\w.]+$/);
    const tokenStart = tokenMatch ? start - tokenMatch[0].length : start;

    let insert = chosen.value;
    if (chosen.kind === 'col' || chosen.kind === 'table') insert = `"${insert}"`;

    ta.value = ta.value.slice(0, tokenStart) + insert + ta.value.slice(end);
    const caret = tokenStart + insert.length;
    ta.selectionStart = ta.selectionEnd = caret;

    _hideAutocomplete();
    _syncHighlight();
    _validateSoon();
    return true;
  }

  function _hideAutocomplete() {
    _acItems = [];
    _acIndex = -1;
    document.getElementById('sql-autocomplete')?.classList.add('hidden');
  }

  async function execute() {
    const input = document.getElementById('sql-input');
    const sql = input?.value?.trim();
    if (!sql) return;

    _setStatus('Running…', '');
    _showResults(null);

    try {
      const res = await fetch('/api/query/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, limit: 2000 }),
      });
      const data = await res.json();
      if (!res.ok) {
        _setStatus(`Error: ${data.detail || 'Unknown error'}`, 'error');
        return;
      }

      const msg = `${data.total.toLocaleString()} row${data.total !== 1 ? 's' : ''}` +
        (data.truncated ? ' (truncated)' : '');
      _setStatus(msg, 'success');

      const toolbar = document.getElementById('sql-results-toolbar');
      const countEl = document.getElementById('sql-result-count');
      const truncEl = document.getElementById('sql-truncated');
      if (toolbar) toolbar.classList.remove('hidden');
      if (countEl) countEl.textContent = `${data.total.toLocaleString()} rows`;
      if (truncEl) truncEl.classList.toggle('hidden', !data.truncated);

      _showResults(data);
    } catch (e) {
      _setStatus(`Network error: ${e.message}`, 'error');
    }
  }

  function _showResults(data) {
    const container = document.getElementById('sql-results');
    if (!container) return;
    if (!data || !data.rows?.length) {
      container.innerHTML = data
        ? '<div class="detail-empty">No rows returned</div>'
        : '<div class="detail-empty"></div>';
      return;
    }

    const { columns, rows } = data;
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px;';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    hrow.style.cssText = 'background:var(--bg-2);position:sticky;top:0;';
    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col;
      th.style.cssText = 'padding:6px 10px;text-align:left;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text-secondary);white-space:nowrap;';
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--border);';
      tr.addEventListener('mouseenter', () => tr.style.background = 'var(--bg-hover)');
      tr.addEventListener('mouseleave', () => tr.style.background = '');
      for (const col of columns) {
        const td = document.createElement('td');
        const v = row[col];
        td.textContent = v == null ? 'NULL' : String(v);
        td.style.cssText = 'padding:5px 10px;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;' +
          (v == null ? 'color:var(--text-muted);font-style:italic;' : '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
  }

  async function exportResults() {
    const sql = document.getElementById('sql-input')?.value?.trim();
    if (!sql || !_activeFile) return;

    const format = prompt('Export format? (csv / json / sql)', 'csv');
    if (!['csv', 'json', 'sql'].includes(format?.toLowerCase())) return;

    try {
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: _activeFile, format: format.toLowerCase(), sql }),
      });
      const data = await res.json();
      if (res.ok) {
        if (window.MagnifiApp) window.MagnifiApp.toast(`Exported: ${data.filename}`, 'success');
        window.MagnifiExport?.loadList();
      }
    } catch (e) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Export failed', 'error');
    }
  }

  function openSaveDialog() {
    const dialog = document.getElementById('save-dialog');
    const nameInput = document.getElementById('save-query-name');
    dialog?.classList.remove('hidden');
    nameInput?.focus();
  }

  function closeSaveDialog() {
    document.getElementById('save-dialog')?.classList.add('hidden');
  }

  async function saveQuery() {
    const name = document.getElementById('save-query-name')?.value?.trim();
    const desc = document.getElementById('save-query-desc')?.value?.trim();
    const sql = document.getElementById('sql-input')?.value?.trim();
    if (!name || !sql) return;

    try {
      const res = await fetch('/api/query/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sql, description: desc }),
      });
      if (res.ok) {
        closeSaveDialog();
        document.getElementById('save-query-name').value = '';
        document.getElementById('save-query-desc').value = '';
        loadSavedQueries();
        if (window.MagnifiApp) window.MagnifiApp.toast(`Query "${name}" saved`, 'success');
      }
    } catch (e) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Save failed', 'error');
    }
  }

  function renderDefaultQueries() {
    const list = document.getElementById('saved-queries-list');
    if (!list) return;

    const view = _activeFile ? _toViewName(_activeFile) : 'your_table';
    const defaultsHtml = DEFAULT_QUERY_TEMPLATES.map((q, idx) => `
      <div class="saved-query-item default-query-item">
        <div class="saved-query-name">${_esc(q.name)}</div>
        <div class="saved-query-desc">${_esc(q.description)}</div>
        <div class="saved-query-actions">
          <button class="saved-query-load" data-default-idx="${idx}">Load</button>
        </div>
      </div>
    `).join('');

    const existing = list.querySelector('.saved-query-group.user-queries')?.outerHTML ||
      '<div class="saved-query-group user-queries"><div class="saved-query-group-title">Saved Queries</div><div class="detail-empty">No saved queries</div></div>';

    list.innerHTML = `
      <div class="saved-query-group">
        <div class="saved-query-group-title">Starter Queries</div>
        ${defaultsHtml}
      </div>
      ${existing}
    `;

    // Click handlers are delegated via _wireSavedQueryActions().
    _applySavedSearchFilter();
  }

  async function loadSavedQueries() {
    const list = document.getElementById('saved-queries-list');
    if (!list) return;

    try {
      const res = await fetch('/api/query/saved');
      const data = await res.json();
      const queries = data.queries || [];
      _savedQueries = queries;

      renderDefaultQueries();
      const userGroup = list.querySelector('.saved-query-group.user-queries');
      if (!userGroup) return;

      if (!queries.length) {
        userGroup.innerHTML = '<div class="saved-query-group-title">Saved Queries</div><div class="detail-empty">No saved queries</div>';
        return;
      }

      userGroup.innerHTML = '<div class="saved-query-group-title">Saved Queries</div>';
      for (const q of queries) {
        const item = document.createElement('div');
        item.className = 'saved-query-item';
        item.dataset.search = `${q.name || ''} ${q.description || ''}`.toLowerCase();
        item.innerHTML = `
          <div class="saved-query-name">${_esc(q.name)}</div>
          ${q.description ? `<div class="saved-query-desc">${_esc(q.description)}</div>` : ''}
          <div class="saved-query-actions">
            <button class="saved-query-load" data-action="load-user" data-qid="${_esc(q.id || q.name)}">Load</button>
            <button class="saved-query-del" data-action="delete-user" data-qid="${_esc(q.id || q.name)}">Delete</button>
          </div>
        `;
        userGroup.appendChild(item);
      }

      _applySavedSearchFilter();
    } catch (e) {
      list.innerHTML = '<div class="detail-empty">Failed to load queries</div>';
    }
  }

  function _applySavedSearchFilter() {
    const input = document.getElementById('saved-queries-search');
    const list = document.getElementById('saved-queries-list');
    if (!input || !list) return;

    const needle = input.value.trim().toLowerCase();
    const groups = [...list.querySelectorAll('.saved-query-group')];
    const items = [...list.querySelectorAll('.saved-query-item')];

    let totalVisible = 0;
    items.forEach(item => {
      const hay = item.dataset.search || item.textContent.toLowerCase();
      const show = !needle || hay.includes(needle);
      item.classList.toggle('hidden', !show);
      if (show) totalVisible += 1;
    });

    groups.forEach(group => {
      const visibleInGroup = group.querySelectorAll('.saved-query-item:not(.hidden)').length;
      const hasEmpty = !!group.querySelector('.detail-empty');
      group.classList.toggle('hidden', !visibleInGroup && !hasEmpty && !!needle);
    });

    let empty = list.querySelector('.saved-filter-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'detail-empty saved-filter-empty hidden';
      empty.textContent = 'No matching saved queries';
      list.appendChild(empty);
    }
    empty.classList.toggle('hidden', totalVisible > 0 || !needle);
  }

  async function deleteQuery(id) {
    try {
      const res = await fetch(`/api/query/saved/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadSavedQueries();
        window.MagnifiApp?.toast('Saved query deleted', 'success');
      }
    } catch (e) {
      window.MagnifiApp?.toast('Delete failed', 'error');
    }
  }

  function _wireSavedQueryActions() {
    const list = document.getElementById('saved-queries-list');
    if (!list) return;

    list.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.hasAttribute('data-default-idx')) {
        const idx = Number(btn.getAttribute('data-default-idx'));
        const view = _activeFile ? _toViewName(_activeFile) : 'your_table';
        const tpl = DEFAULT_QUERY_TEMPLATES[idx];
        if (tpl) _setEditorValue(tpl.sql(view));
        return;
      }

      const action = btn.getAttribute('data-action');
      const qid = btn.getAttribute('data-qid') || '';
      if (!action || !qid) return;

      if (action === 'load-user') {
        const q = _savedQueries.find(item => (item.id || item.name) === qid);
        if (q?.sql) _setEditorValue(q.sql);
      } else if (action === 'delete-user') {
        deleteQuery(encodeURIComponent(qid));
      }
    });
  }

  function clearEditor() {
    const ta = document.getElementById('sql-input');
    if (ta) {
      ta.value = '';
      ta.classList.remove('invalid', 'valid');
    }
    _syncHighlight();
    _hideAutocomplete();
    _setStatus('', '');
    _showResults(null);
    document.getElementById('sql-results-toolbar')?.classList.add('hidden');
  }

  function _insertTextAtCaret(text) {
    const ta = document.getElementById('sql-input');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.focus();
    _syncHighlight();
    _validateSoon();
  }

  function _setStatus(msg, cls) {
    const el = document.getElementById('sql-status');
    if (!el) return;
    el.textContent = msg;
    el.className = cls;
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.MagnifiSQL = { init, setActiveFile, loadSavedQueries, validateEditor };
})();
