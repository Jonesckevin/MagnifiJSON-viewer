/* file-manager.js — Sidebar file list management */
(function () {
  'use strict';

  let _files = [];          // [{filename, size}]
  let _activeFile = null;
  let _fileMeta  = {};      // {filename: {shape, row_count, schema, ...}}
  let _onSelect  = null;
  let _onDelete  = null;

  function init(opts = {}) {
    _onSelect = opts.onSelect;
    _onDelete = opts.onDelete;
  }

  async function loadList() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      _files = data.files || [];
      _renderList();
      _updateSelector();
    } catch (e) {
      console.error('Failed to load file list', e);
    }
  }

  function setActive(filename) {
    _activeFile = filename;
    _renderList();
    _updateSelector();
  }

  function setMeta(filename, meta) {
    _fileMeta[filename] = meta;
    _renderList();
  }

  function _renderList() {
    const list = document.getElementById('file-list');
    if (!list) return;

    if (_files.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-file-earmark-x"></i>
          <p>No files uploaded</p>
          <button class="btn-primary sm" id="sidebar-upload-empty">Upload a file</button>
        </div>`;
      document.getElementById('sidebar-upload-empty')?.addEventListener('click', () => {
        document.getElementById('file-input')?.click();
      });
      return;
    }

    const frag = document.createDocumentFragment();
    for (const f of _files) {
      const isActive = f.filename === _activeFile;
      const meta = _fileMeta[f.filename] || {};
      const shape = meta.shape || '';
      const rows  = meta.row_count != null ? `${meta.row_count.toLocaleString()} rows` : _fmtSize(f.size);
      const shapeBadge = _shapeClass(shape);

      const item = document.createElement('div');
      item.className = 'file-item' + (isActive ? ' active' : '');
      item.dataset.filename = f.filename;
      item.title = f.filename;
      item.innerHTML = `
        <i class="bi bi-file-earmark-code file-item-icon"></i>
        <div class="file-item-body">
          <div class="file-item-name">${_esc(f.filename)}</div>
          <div class="file-item-meta">
            ${shapeBadge}
            <span>${rows}</span>
          </div>
        </div>
        <button class="icon-btn sm file-item-delete" data-filename="${_esc(f.filename)}" title="Delete file">
          <i class="bi bi-trash"></i>
        </button>
      `;

      item.addEventListener('click', e => {
        if (e.target.closest('.file-item-delete')) return;
        if (_onSelect) _onSelect(f.filename);
      });

      item.querySelector('.file-item-delete').addEventListener('click', e => {
        e.stopPropagation();
        _showDeleteModal(f.filename);
      });

      frag.appendChild(item);
    }

    list.innerHTML = '';
    list.appendChild(frag);
  }

  function _shapeClass(shape) {
    const map = {
      'array_of_objects': ['tabular', '⊞ Tabular'],
      'flat_object':      ['tabular', '⊞ Object'],
      'nested_object':    ['nested',  '⟨⟩ Nested'],
      'array_of_arrays':  ['nested',  '[] Arrays'],
      'primitive_array':  ['other',   '[ ] List'],
      'empty_array':      ['other',   '[ ] Empty'],
      'primitive':        ['other',   '∷ Value'],
    };
    const [cls, label] = map[shape] || ['other', shape || '?'];
    return `<span class="shape-badge ${cls}">${label}</span>`;
  }

  function _updateSelector() {
    const sel = document.getElementById('file-selector');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— No file loaded —</option>';
    for (const f of _files) {
      const opt = document.createElement('option');
      opt.value = f.filename;
      opt.textContent = f.filename;
      if (f.filename === (prev || _activeFile)) opt.selected = true;
      sel.appendChild(opt);
    }
    if (_activeFile && !_files.find(f => f.filename === _activeFile)) {
      sel.value = '';
    }
  }

  function _showDeleteModal(filename) {
    const overlay = document.getElementById('delete-modal-overlay');
    const nameEl  = document.getElementById('delete-modal-name');
    const confirmBtn = document.getElementById('delete-confirm-btn');
    const cancelBtn  = document.getElementById('delete-cancel-btn');
    if (!overlay) return;

    if (nameEl) nameEl.textContent = filename;
    overlay.classList.remove('hidden');

    const doDelete = async () => {
      overlay.classList.add('hidden');
      try {
        const r = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (r.ok) {
          _files = _files.filter(f => f.filename !== filename);
          delete _fileMeta[filename];
          if (_activeFile === filename) _activeFile = null;
          _renderList();
          _updateSelector();
          if (_onDelete) _onDelete(filename);
          if (window.MagnifiApp) window.MagnifiApp.toast(`Deleted ${filename}`, 'info');
        }
      } catch (e) {
        if (window.MagnifiApp) window.MagnifiApp.toast('Delete failed', 'error');
      }
      cleanup();
    };

    const cleanup = () => {
      confirmBtn?.removeEventListener('click', doDelete);
      cancelBtn?.removeEventListener('click', cancel);
    };
    const cancel = () => { overlay.classList.add('hidden'); cleanup(); };

    confirmBtn?.addEventListener('click', doDelete);
    cancelBtn?.addEventListener('click', cancel);
  }

  function addFile(meta) {
    // Add or update in _files array
    if (!_files.find(f => f.filename === meta.filename)) {
      _files.push({ filename: meta.filename, size: meta.size });
    }
    _fileMeta[meta.filename] = meta;
    _renderList();
    _updateSelector();
  }

  function getFiles() { return _files; }
  function getActiveFile() { return _activeFile; }
  function getMeta(filename) { return _fileMeta[filename] || {}; }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  window.MagnifiFiles = { init, loadList, setActive, setMeta, addFile, getFiles, getActiveFile, getMeta };
})();
