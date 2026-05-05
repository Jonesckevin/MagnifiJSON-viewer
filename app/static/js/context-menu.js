/* context-menu.js — Right-click context menu for grid rows */
(function () {
  'use strict';

  const menu = document.getElementById('context-menu');
  let _row = null;
  let _onFilterValue = null;
  let _onShowTree = null;

  function init(opts = {}) {
    _onFilterValue = opts.onFilterValue;
    _onShowTree    = opts.onShowTree;

    document.addEventListener('click', hide);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

    document.getElementById('ctx-copy-row')?.addEventListener('click', () => {
      if (_row) {
        navigator.clipboard.writeText(JSON.stringify(_row, null, 2));
        if (window.MagnifiApp) window.MagnifiApp.toast('Copied!', 'success');
      }
      hide();
    });

    document.getElementById('ctx-copy-csv')?.addEventListener('click', () => {
      if (_row) window.MagnifiDetail?.copyAsCSV();
      hide();
    });

    document.getElementById('ctx-filter-value')?.addEventListener('click', () => {
      if (_row && _onFilterValue) _onFilterValue(_row);
      hide();
    });

    document.getElementById('ctx-open-tree')?.addEventListener('click', () => {
      if (_onShowTree) _onShowTree();
      hide();
    });
  }

  function show(event, row) {
    _row = row;
    if (!menu) return;
    menu.classList.remove('hidden');

    // Position near cursor, keep in viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = menu.offsetWidth  || 190;
    const mh = menu.offsetHeight || 150;
    let x = event.clientX + 4;
    let y = event.clientY + 4;
    if (x + mw > vw) x = event.clientX - mw - 4;
    if (y + mh > vh) y = event.clientY - mh - 4;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  }

  function hide() {
    menu?.classList.add('hidden');
    _row = null;
  }

  window.MagnifiContext = { init, show, hide };
})();
