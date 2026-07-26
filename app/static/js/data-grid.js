/* data-grid.js — Sortable, resizable, multi-select data grid */
(function () {
  'use strict';

  // ── State ──
  let _columns    = [];   // [{name, type}]
  let _rows       = [];   // [{}]
  let _colWidths  = {};   // {colName: widthPx}
  let _sortCol    = null;
  let _sortDir    = 'ASC';
  let _hiddenCols = new Set();
  let _selectedRows = new Set(); // indices into _rows
  let _lastClickIdx = null;
  let _onSort     = null;  // callback(col, dir)
  let _onSelect   = null;  // callback(rows)
  let _onContext  = null;  // callback(event, row)
  let _totalRows  = 0;

  const DEFAULT_COL_W = 140;

  // ── DOM helpers ──
  const $ = id => document.getElementById(id);

  // ── Render ──
  function render(columns, rows, opts = {}) {
    _columns = columns.map(c =>
      typeof c === 'string' ? { name: c, type: '' } : c
    );
    _rows = rows;
    _selectedRows.clear();
    _lastClickIdx = null;
    _totalRows = opts.total ?? rows.length;

    if (opts.sortCol !== undefined) _sortCol = opts.sortCol;
    if (opts.sortDir !== undefined) _sortDir = opts.sortDir;
    if (opts.hiddenCols) _hiddenCols = new Set(opts.hiddenCols);
    if (opts.colWidths) _colWidths = { ..._colWidths, ...opts.colWidths };
    if (opts.onSort)    _onSort = opts.onSort;
    if (opts.onSelect)  _onSelect = opts.onSelect;
    if (opts.onContext) _onContext = opts.onContext;

    _renderHeader();
    _renderBody();
  }

  function _visibleCols() {
    return _columns.filter(c => !_hiddenCols.has(c.name));
  }

  function _colWidth(name) {
    return _colWidths[name] || DEFAULT_COL_W;
  }

  // ── Header rendering ──
  function _renderHeader() {
    const head = $('grid-head');
    if (!head) return;
    head.innerHTML = '';

    for (const col of _visibleCols()) {
      const w = _colWidth(col.name);
      const isSort = _sortCol === col.name;

      const cell = document.createElement('div');
      cell.className = 'grid-head-cell' + (isSort ? ' sorted' : '');
      cell.style.width = w + 'px';
      cell.dataset.col = col.name;

      const sortIcon = isSort
        ? `<i class="bi bi-arrow-${_sortDir === 'ASC' ? 'up' : 'down'} sort-icon"></i>`
        : '';
      const typeBadge = col.type
        ? `<span class="col-type-badge">${col.type.split('(')[0].substring(0, 8)}</span>`
        : '';

      cell.innerHTML = `
        <span class="col-name" title="${_esc(col.name)}">${_esc(col.name)}</span>
        ${typeBadge}
        ${sortIcon}
        <div class="col-resize-handle" data-col="${_esc(col.name)}"></div>
      `;

      cell.addEventListener('click', e => {
        if (e.target.classList.contains('col-resize-handle')) return;
        _handleSortClick(col.name);
      });

      // Column resize
      const resizeHandle = cell.querySelector('.col-resize-handle');
      resizeHandle.addEventListener('mousedown', e => _startColResize(e, col.name, cell));

      head.appendChild(cell);
    }
  }

  // ── Body rendering ──
  function _renderBody() {
    const body = $('grid-body');
    if (!body) return;
    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    const vis = _visibleCols();

    _rows.forEach((row, idx) => {
      const tr = document.createElement('div');
      tr.className = 'grid-row' + (_selectedRows.has(idx) ? ' selected' : '');
      tr.dataset.idx = idx;

      for (const col of vis) {
        const v = row[col.name];
        const td = document.createElement('div');
        td.className = 'grid-cell' + _cellClass(v);
        td.style.width = _colWidth(col.name) + 'px';
        td.title = v == null ? 'NULL' : String(v);
        td.textContent = v == null ? 'NULL' : String(v);
        tr.appendChild(td);
      }

      tr.addEventListener('click', e => _handleRowClick(e, idx));
      tr.addEventListener('contextmenu', e => {
        e.preventDefault();
        _selectRow(idx, false);
        if (_onContext) _onContext(e, _rows[idx]);
      });

      frag.appendChild(tr);
    });

    body.appendChild(frag);
  }

  function _cellClass(v) {
    if (v == null) return ' null-val';
    if (typeof v === 'number') return ' num-val';
    if (typeof v === 'boolean') return ' bool-val';
    if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) return ' obj-val';
    return '';
  }

  // ── Sort ──
  function _handleSortClick(colName) {
    if (_sortCol === colName) {
      _sortDir = _sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      _sortCol = colName;
      _sortDir = 'ASC';
    }
    _renderHeader();
    if (_onSort) _onSort(_sortCol, _sortDir);
  }

  // ── Row selection ──
  function _handleRowClick(e, idx) {
    if (e.ctrlKey || e.metaKey) {
      if (_selectedRows.has(idx)) _selectedRows.delete(idx);
      else _selectedRows.add(idx);
      _lastClickIdx = idx;
    } else if (e.shiftKey && _lastClickIdx !== null) {
      const lo = Math.min(_lastClickIdx, idx);
      const hi = Math.max(_lastClickIdx, idx);
      for (let i = lo; i <= hi; i++) _selectedRows.add(i);
    } else {
      _selectedRows.clear();
      _selectedRows.add(idx);
      _lastClickIdx = idx;
    }
    _updateRowStyles();
    if (_onSelect) _onSelect(getSelectedRows());
  }

  function _selectRow(idx, clear = true) {
    if (clear) _selectedRows.clear();
    _selectedRows.add(idx);
    _lastClickIdx = idx;
    _updateRowStyles();
    if (_onSelect) _onSelect(getSelectedRows());
  }

  function _updateRowStyles() {
    const body = $('grid-body');
    if (!body) return;
    body.querySelectorAll('.grid-row').forEach(tr => {
      const idx = parseInt(tr.dataset.idx, 10);
      tr.classList.toggle('selected', _selectedRows.has(idx));
    });
  }

  function getSelectedRows() {
    return [..._selectedRows].sort((a, b) => a - b).map(i => _rows[i]);
  }

  // ── Column resize ──
  function _startColResize(e, colName, headerCell) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = _colWidth(colName);
    const handle = e.target;
    handle.classList.add('dragging');

    const onMove = ev => {
      const newW = Math.max(60, startW + ev.clientX - startX);
      _colWidths[colName] = newW;
      headerCell.style.width = newW + 'px';
      // Update body cells
      const body = $('grid-body');
      if (body) {
        const colIdx = _visibleCols().findIndex(c => c.name === colName);
        body.querySelectorAll('.grid-row').forEach(tr => {
          const cell = tr.children[colIdx];
          if (cell) cell.style.width = newW + 'px';
        });
      }
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist widths
      if (window.MagnifiApp) window.MagnifiApp.saveColWidths(_colWidths);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Column visibility ──
  function setHiddenCols(set) {
    _hiddenCols = new Set(set);
    _renderHeader();
    _renderBody();
  }

  function toggleColumn(name) {
    if (_hiddenCols.has(name)) _hiddenCols.delete(name);
    else _hiddenCols.add(name);
    _renderHeader();
    _renderBody();
    return _hiddenCols.has(name);
  }

  function renderColVisPanel() {
    const panel = $('col-vis-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const col of _columns) {
      const visible = !_hiddenCols.has(col.name);
      const item = document.createElement('label');
      item.className = 'col-vis-item';
      item.innerHTML = `
        <input type="checkbox" ${visible ? 'checked' : ''} data-col="${_esc(col.name)}" />
        <span>${_esc(col.name)}</span>
      `;
      item.querySelector('input').addEventListener('change', function () {
        toggleColumn(this.dataset.col);
        if (window.MagnifiApp) window.MagnifiApp.saveColWidths(_colWidths);
      });
      panel.appendChild(item);
    }
  }

  // ── Helpers ──
  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clear() {
    _columns = []; _rows = []; _selectedRows.clear();
    const h = $('grid-head'); const b = $('grid-body');
    if (h) h.innerHTML = '';
    if (b) b.innerHTML = '';
  }

  function getColWidths() { return { ..._colWidths }; }
  function getCurrentSort() { return { col: _sortCol, dir: _sortDir }; }
  function getRows() { return _rows; }

  window.MagnifiGrid = {
    render, clear, getSelectedRows, getColWidths,
    getCurrentSort, renderColVisPanel, setHiddenCols,
    toggleColumn, getRows,
  };
})();
