/* json-tree.js — Collapsible interactive JSON tree renderer */
(function () {
  'use strict';

  let _searchTerm = '';

  // ── Public render ─────────────────────────────────────────────
  function render(container, data) {
    container.innerHTML = '';
    const node = _buildNode(data, null, 0, true);
    container.appendChild(node);
  }

  // ── Node factory ──────────────────────────────────────────────
  function _buildNode(value, key, depth, expanded) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';

    if (Array.isArray(value)) {
      _buildCollapsible(wrapper, key, value, `[${value.length}]`, expanded, depth);
    } else if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value);
      _buildCollapsible(wrapper, key, value, `{${keys.length}}`, expanded, depth);
    } else {
      _buildLeaf(wrapper, key, value);
    }

    return wrapper;
  }

  function _buildCollapsible(wrapper, key, value, hint, expanded, depth) {
    const isArray = Array.isArray(value);
    const openBracket  = isArray ? '[' : '{';
    const closeBracket = isArray ? ']' : '}';
    const isEmpty = isArray ? value.length === 0 : Object.keys(value).length === 0;

    // Header row
    const header = document.createElement('div');
    header.className = 'tree-key';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = expanded ? '▾' : '▸';

    const keyEl = key !== null
      ? `<span class="tree-key-name">${_esc(String(key))}</span><span class="tree-bracket">: </span>`
      : '';
    const copyBtn = `<button class="tree-copy-btn" title="Copy value">⎘</button>`;

    header.innerHTML = `
      ${toggle.outerHTML}
      ${keyEl}
      <span class="tree-bracket">${openBracket}</span>
      <span class="tree-meta">${hint}</span>
      ${isEmpty ? `<span class="tree-bracket">${closeBracket}</span>` : ''}
      ${copyBtn}
    `;

    // Re-get toggle after innerHTML
    const toggleEl = header.querySelector('.tree-toggle');

    // Children container
    const children = document.createElement('div');
    children.className = 'tree-children' + (expanded ? '' : ' hidden');

    if (!isEmpty) {
      const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
      for (const [k, v] of entries) {
        // Auto-collapse deep levels
        const childExpanded = depth < 2;
        children.appendChild(_buildNode(v, k, depth + 1, childExpanded));
      }

      // Closing bracket after children
      const closer = document.createElement('div');
      closer.className = 'tree-node';
      closer.innerHTML = `<span class="tree-bracket" style="margin-left:0">${closeBracket}</span>`;
      children.appendChild(closer);
    }

    // Toggle expand/collapse
    const doToggle = () => {
      const isHidden = children.classList.toggle('hidden');
      toggleEl.textContent = isHidden ? '▸' : '▾';
    };
    header.addEventListener('click', e => {
      if (e.target.classList.contains('tree-copy-btn')) return;
      doToggle();
    });

    // Copy button
    header.querySelector('.tree-copy-btn').addEventListener('click', e => {
      e.stopPropagation();
      _copyToClipboard(JSON.stringify(value, null, 2));
    });

    wrapper.appendChild(header);
    wrapper.appendChild(children);
  }

  function _buildLeaf(wrapper, key, value) {
    const row = document.createElement('div');
    row.className = 'tree-key';

    const keyPart = key !== null
      ? `<span class="tree-key-name">${_highlight(_esc(String(key)))}</span><span class="tree-bracket">: </span>`
      : '';

    const { cls, display } = _formatValue(value);
    const valStr = _highlight(_esc(display));
    const copyBtn = `<button class="tree-copy-btn" title="Copy value">⎘</button>`;

    row.innerHTML = `
      <span class="tree-toggle"></span>
      ${keyPart}
      <span class="${cls}">${valStr}</span>
      ${copyBtn}
    `;

    row.querySelector('.tree-copy-btn').addEventListener('click', e => {
      e.stopPropagation();
      _copyToClipboard(display);
    });

    wrapper.appendChild(row);
  }

  function _formatValue(v) {
    if (v === null)      return { cls: 'tree-val-null',    display: 'null' };
    if (v === true)      return { cls: 'tree-val-boolean', display: 'true' };
    if (v === false)     return { cls: 'tree-val-boolean', display: 'false' };
    if (typeof v === 'number') return { cls: 'tree-val-number', display: String(v) };
    if (typeof v === 'string') return { cls: 'tree-val-string', display: `"${v}"` };
    return { cls: '', display: String(v) };
  }

  // ── Search ────────────────────────────────────────────────────
  function search(term) {
    _searchTerm = term.trim().toLowerCase();
    const container = document.getElementById('tree-container');
    if (!container) return;

    if (!_searchTerm) {
      container.querySelectorAll('.tree-search-match').forEach(el => {
        el.classList.remove('tree-search-match');
        el.innerHTML = el.textContent; // remove highlight spans
      });
      return;
    }

    // Re-render highlighting (simple approach: walk text nodes)
    container.querySelectorAll('.tree-key-name, .tree-val-string, .tree-val-number, .tree-val-boolean, .tree-val-null').forEach(el => {
      const text = el.textContent;
      const lower = text.toLowerCase();
      if (lower.includes(_searchTerm)) {
        el.classList.add('tree-search-match');
        // Ensure parent containers are visible
        let p = el.parentElement;
        while (p) {
          if (p.classList.contains('tree-children')) p.classList.remove('hidden');
          p = p.parentElement;
        }
      } else {
        el.classList.remove('tree-search-match');
      }
    });
  }

  // ── Expand / Collapse all ────────────────────────────────────
  function expandAll() {
    const container = document.getElementById('tree-container');
    if (!container) return;
    container.querySelectorAll('.tree-children').forEach(el => el.classList.remove('hidden'));
    container.querySelectorAll('.tree-toggle').forEach(el => {
      if (el.textContent) el.textContent = '▾';
    });
  }

  function collapseAll() {
    const container = document.getElementById('tree-container');
    if (!container) return;
    container.querySelectorAll('.tree-children').forEach(el => el.classList.add('hidden'));
    container.querySelectorAll('.tree-toggle').forEach(el => {
      if (el.textContent) el.textContent = '▸';
    });
  }

  // ── Highlight search matches in displayed text ─────────────────
  function _highlight(html) {
    if (!_searchTerm) return html;
    const lower = html.toLowerCase();
    const idx = lower.indexOf(_searchTerm);
    if (idx === -1) return html;
    return (
      html.slice(0, idx) +
      `<mark class="tree-search-match">${html.slice(idx, idx + _searchTerm.length)}</mark>` +
      html.slice(idx + _searchTerm.length)
    );
  }

  // ── Helpers ───────────────────────────────────────────────────
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    if (window.MagnifiApp) window.MagnifiApp.toast('Copied!', 'success');
  }

  window.MagnifiTree = { render, search, expandAll, collapseAll };
})();
