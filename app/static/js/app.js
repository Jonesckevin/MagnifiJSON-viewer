/* app.js — MagnifiJSON main controller: orchestrates all modules */
(function () {
  'use strict';

  // ── App state ──────────────────────────────────────────────────
  let _activeFile = null;
  let _schema     = [];
  let _offset     = 0;
  let _limit      = 50;
  let _total      = 0;
  let _sortCol    = null;
  let _sortDir    = 'ASC';
  let _activeTab  = 'table';
  let _sidebarCollapsed = false;

  // ── Init ───────────────────────────────────────────────────────
  async function init() {
    // Load server state first
    let state = {};
    try {
      const res = await fetch('/api/state');
      state = await res.json();
    } catch (e) {}

    // Apply theme
    MagnifiTheme.init(state.theme || 'dark');

    // Page size
    _limit = state.page_size || 50;
    const pageSizeEl = document.getElementById('page-size');
    if (pageSizeEl) pageSizeEl.value = _limit;

    // Init all modules
    MagnifiDetail.init();
    MagnifiSQL.init();
    MagnifiExport.init();
    MagnifiCharts.init();

    MagnifiFiles.init({
      onSelect: file => loadFile(file),
      onDelete: filename => {
        if (_activeFile === filename) {
          _activeFile = null;
          _schema = [];
          _showWelcome();
        }
      },
    });

    MagnifiSearch.init(params => {
      _offset = 0;
      loadRows(params);
    });

    MagnifiContext.init({
      onFilterValue: row => {
        // Set search to first non-null value
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined) {
            const input = document.getElementById('search-input');
            const colSel = document.getElementById('search-col');
            if (input) input.value = String(v);
            if (colSel) colSel.value = k;
            MagnifiSearch.getValue && loadRows(MagnifiSearch.getValue());
            break;
          }
        }
      },
      onShowTree: () => switchTab('tree'),
    });

    // Set up event listeners
    _setupSidebar(state);
    _setupTabs();
    _setupUpload();
    _setupPagination();
    _setupDetailResize(state);
    _setupColVisPanel();
    _setupDragDrop();

    // File selector in header
    document.getElementById('file-selector')?.addEventListener('change', function () {
      if (this.value) loadFile(this.value);
    });

    // Load file list
    await MagnifiFiles.loadList();

    // Restore last active file
    if (state.active_file && document.querySelector(`#file-selector option[value="${CSS.escape(state.active_file)}"]`)) {
      await loadFile(state.active_file);
    } else {
      _showWelcome();
    }

    // Restore tab
    if (state.active_view) switchTab(state.active_view);
  }

  // ── File loading ────────────────────────────────────────────────
  async function loadFile(filename) {
    showLoading(true);
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}/load`, { method: 'POST' });
      if (!res.ok) { showLoading(false); toast('Failed to load file', 'error'); return; }
      const meta = await res.json();

      _activeFile = filename;
      _schema = meta.schema || [];
      _offset = 0;
      _sortCol = null;
      _sortDir = 'ASC';

      MagnifiFiles.setActive(filename);
      MagnifiFiles.setMeta(filename, meta);
      MagnifiSearch.updateSchema(_schema);
      MagnifiSearch.reset();
      MagnifiSQL.setActiveFile(filename, _schema);
      MagnifiExport.setActiveFile(filename);
      MagnifiCharts.setFile(filename, _schema);

      // Update stats strip
      _updateStats(meta);

      // Update file selector
      const sel = document.getElementById('file-selector');
      if (sel) sel.value = filename;

      // Show main panel
      _showMainPanel();

      // Load current tab data
      if (_activeTab === 'table') {
        await loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {});
      } else if (_activeTab === 'tree') {
        await loadTree();
      }

      // Persist state
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_file: filename }),
      }).catch(() => {});

    } catch (e) {
      toast('Failed to load file: ' + e.message, 'error');
    }
    showLoading(false);
  }

  // ── Table rows ──────────────────────────────────────────────────
  async function loadRows(searchParams = {}) {
    if (!_activeFile) return;
    showGridLoading(true);

    const params = new URLSearchParams({
      file: _activeFile,
      offset: _offset,
      limit: _limit,
      sort_dir: _sortDir,
    });
    if (_sortCol) params.set('sort_col', _sortCol);
    if (searchParams.text) {
      params.set('search', searchParams.text);
      params.set('regex', searchParams.regex ? 'true' : 'false');
      if (searchParams.column) params.set('search_col', searchParams.column);
    }

    try {
      const res = await fetch(`/api/data/rows?${params}`);
      const data = await res.json();
      if (!res.ok) { toast(data.detail || 'Load error', 'error'); showGridLoading(false); return; }

      _total = data.total;
      _updatePagination();
      _updateResultCount(data.total, searchParams.text);

      MagnifiGrid.render(data.columns.map((n, i) => ({ name: n, type: data.schema?.[i]?.type || '' })), data.rows, {
        total: data.total,
        sortCol: _sortCol,
        sortDir: _sortDir,
        onSort: (col, dir) => { _sortCol = col; _sortDir = dir; _offset = 0; loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {}); },
        onSelect: rows => { MagnifiDetail.render(rows[0] || null); },
        onContext: (e, row) => { MagnifiDetail.render(row); MagnifiContext.show(e, row); },
      });

      MagnifiGrid.renderColVisPanel();
    } catch (e) {
      toast('Failed to load rows: ' + e.message, 'error');
    }
    showGridLoading(false);
  }

  // ── Tree view ───────────────────────────────────────────────────
  async function loadTree() {
    if (!_activeFile) return;
    const container = document.getElementById('tree-container');
    if (!container) return;
    container.innerHTML = '<div class="detail-empty">Loading tree…</div>';

    try {
      const res = await fetch(`/api/data/tree?file=${encodeURIComponent(_activeFile)}`);
      const data = await res.json();
      MagnifiTree.render(container, data.tree);
    } catch (e) {
      container.innerHTML = '<div class="detail-empty">Failed to load tree</div>';
    }
  }

  // ── Tabs ────────────────────────────────────────────────────────
  function _setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Tree tab controls
    document.getElementById('expand-all')?.addEventListener('click', MagnifiTree.expandAll);
    document.getElementById('collapse-all')?.addEventListener('click', MagnifiTree.collapseAll);
    document.getElementById('tree-search')?.addEventListener('input', function () {
      MagnifiTree.search(this.value);
    });
  }

  function switchTab(tabName) {
    _activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${tabName}`));

    // Load data for tab if needed
    if (tabName === 'tree' && _activeFile) loadTree();
    if (tabName === 'exports') MagnifiExport.loadList();

    // Persist
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active_view: tabName }),
    }).catch(() => {});
  }

  // ── Upload ──────────────────────────────────────────────────────
  function _setupUpload() {
    const fileInput = document.getElementById('file-input');
    const uploadBtns = [
      document.getElementById('upload-btn'),
      document.getElementById('sidebar-upload-btn'),
      document.getElementById('welcome-upload-btn'),
    ];

    uploadBtns.forEach(btn => btn?.addEventListener('click', () => fileInput?.click()));

    fileInput?.addEventListener('change', async function () {
      for (const file of this.files) {
        await _uploadFile(file);
      }
      this.value = '';
    });
  }

  async function _uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    toast(`Uploading ${file.name}…`, 'info');
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        toast(data.detail || `Failed to upload ${file.name}`, 'error');
        return;
      }
      MagnifiFiles.addFile(data);
      toast(`${file.name} uploaded`, 'success');
      await loadFile(data.filename);
    } catch (e) {
      toast(`Upload failed: ${e.message}`, 'error');
    }
  }

  // ── Drag & drop ─────────────────────────────────────────────────
  function _setupDragDrop() {
    const overlay = document.getElementById('drop-overlay');
    let dragCount = 0;

    document.addEventListener('dragenter', e => {
      e.preventDefault();
      dragCount++;
      overlay?.classList.remove('hidden');
    });
    document.addEventListener('dragleave', () => {
      dragCount--;
      if (dragCount <= 0) { dragCount = 0; overlay?.classList.add('hidden'); }
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async e => {
      e.preventDefault();
      dragCount = 0;
      overlay?.classList.add('hidden');
      const files = [...(e.dataTransfer?.files || [])].filter(f =>
        f.name.endsWith('.json') ||
        f.name.endsWith('.jsonl') ||
        f.name.endsWith('.ndjson') ||
        f.name.endsWith('.xml') ||
        f.name.endsWith('.csv') ||
        f.name.endsWith('.tsv') ||
        f.name.endsWith('.psv') ||
        f.name.endsWith('.xlsx') ||
        f.name.endsWith('.xls') ||
        f.name.endsWith('.sqlite') ||
        f.name.endsWith('.sqlite3') ||
        f.name.endsWith('.db')
      );
      for (const file of files) await _uploadFile(file);
    });
  }

  // ── Sidebar ──────────────────────────────────────────────────────
  function _setupSidebar(state) {
    const sidebar = document.getElementById('sidebar');
    if (state.sidebar_width && sidebar) {
      sidebar.style.width = state.sidebar_width + 'px';
    }

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      _sidebarCollapsed = !_sidebarCollapsed;
      sidebar?.classList.toggle('collapsed', _sidebarCollapsed);
    });

    // Sidebar resize handle
    const handle = document.getElementById('sidebar-resize');
    handle?.addEventListener('mousedown', e => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebar?.offsetWidth || 260;
      handle.classList.add('dragging');

      const onMove = ev => {
        const w = Math.max(160, Math.min(480, startW + ev.clientX - startX));
        if (sidebar) sidebar.style.width = w + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = sidebar?.offsetWidth || 260;
        fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidebar_width: w }) }).catch(() => {});
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Detail panel resize ───────────────────────────────────────────
  function _setupDetailResize(state) {
    const handle  = document.getElementById('detail-resize');
    const panel   = document.getElementById('row-detail-panel');
    const gridWrap = document.getElementById('grid-wrap');

    if (state.detail_height && panel) {
      panel.style.height = state.detail_height + 'px';
    }

    handle?.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('dragging');
      const startY  = e.clientY;
      const startH  = panel?.offsetHeight || 240;

      const onMove = ev => {
        const newH = Math.max(60, Math.min(600, startH - (ev.clientY - startY)));
        if (panel) panel.style.height = newH + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const h = panel?.offsetHeight || 240;
        fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ detail_height: h }) }).catch(() => {});
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Pagination ────────────────────────────────────────────────────
  function _setupPagination() {
    document.getElementById('first-btn')?.addEventListener('click', () => { _offset = 0; loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {}); });
    document.getElementById('prev-btn')?.addEventListener('click',  () => { _offset = Math.max(0, _offset - _limit); loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {}); });
    document.getElementById('next-btn')?.addEventListener('click',  () => { if (_offset + _limit < _total) { _offset += _limit; loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {}); } });
    document.getElementById('last-btn')?.addEventListener('click',  () => { _offset = Math.max(0, Math.floor((_total - 1) / _limit) * _limit); loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {}); });
    document.getElementById('page-size')?.addEventListener('change', function () {
      _limit = parseInt(this.value, 10);
      _offset = 0;
      fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_size: _limit }) }).catch(() => {});
      loadRows(MagnifiSearch.getValue ? MagnifiSearch.getValue() : {});
    });
  }

  function _updatePagination() {
    const info = document.getElementById('page-info');
    if (!info) return;
    const from = _total === 0 ? 0 : _offset + 1;
    const to   = Math.min(_offset + _limit, _total);
    info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${_total.toLocaleString()}`;

    document.getElementById('prev-btn').disabled  = _offset === 0;
    document.getElementById('first-btn').disabled = _offset === 0;
    document.getElementById('next-btn').disabled  = _offset + _limit >= _total;
    document.getElementById('last-btn').disabled  = _offset + _limit >= _total;
  }

  function _updateResultCount(total, searchText) {
    const el = document.getElementById('result-count');
    if (!el) return;
    el.textContent = searchText
      ? `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`
      : '';
  }

  // ── Column visibility panel ────────────────────────────────────────
  function _setupColVisPanel() {
    const btn   = document.getElementById('col-vis-btn');
    const panel = document.getElementById('col-vis-panel');
    btn?.addEventListener('click', e => {
      e.stopPropagation();
      const hidden = panel?.classList.toggle('hidden');
      if (!hidden) MagnifiGrid.renderColVisPanel();
    });
    document.addEventListener('click', () => panel?.classList.add('hidden'));
    panel?.addEventListener('click', e => e.stopPropagation());
  }

  // ── Stats strip ────────────────────────────────────────────────────
  function _updateStats(meta) {
    const strip = document.getElementById('stats-strip');
    if (strip) strip.classList.remove('hidden');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.querySelector('span').textContent = val; };
    set('stat-rows',  (meta.row_count ?? '?').toLocaleString() + ' rows');
    set('stat-cols',  (meta.schema?.length ?? '?') + ' cols');
    set('stat-shape', meta.shape?.replace(/_/g, ' ') || '?');
    set('stat-size',  _fmtSize(meta.size || 0));
  }

  // ── Welcome / main panel ───────────────────────────────────────────
  function _showWelcome() {
    document.getElementById('welcome-screen')?.classList.remove('hidden');
    document.getElementById('main-panel')?.classList.add('hidden');
    document.getElementById('stats-strip')?.classList.add('hidden');
  }

  function _showMainPanel() {
    document.getElementById('welcome-screen')?.classList.add('hidden');
    document.getElementById('main-panel')?.classList.remove('hidden');
  }

  // ── Loading states ──────────────────────────────────────────────────
  function showLoading(on) {
    // Could add a global spinner later
  }

  function showGridLoading(on) {
    document.getElementById('grid-loading')?.classList.toggle('hidden', !on);
  }

  // ── Toast ────────────────────────────────────────────────────────────
  function toast(message, type = 'info') {
    const icons = { success: 'bi-check-circle-fill', error: 'bi-exclamation-circle-fill', info: 'bi-info-circle-fill' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i> ${message}`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => {
      t.classList.remove('visible');
      setTimeout(() => t.remove(), 250);
    }, 3000);
  }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function saveColWidths(widths) {
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_widths: widths }),
    }).catch(() => {});
  }

  // ── Public API ─────────────────────────────────────────────────────
  window.MagnifiApp = { toast, saveColWidths, loadFile, switchTab };

  // ── Boot ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
