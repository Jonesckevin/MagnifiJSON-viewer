/* theme.js — Bootstrap dark/light theme toggle with state persistence */
(function () {
  'use strict';

  const THEMES = ['dark', 'light'];
  const ICONS = { dark: 'bi-moon-stars-fill', light: 'bi-sun-fill' };
  let _current = 'dark';

  function apply(theme) {
    _current = theme;
    document.documentElement.setAttribute('data-bs-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.innerHTML = `<i class="bi ${ICONS[theme]}"></i>`;
      btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }
    // Update ECharts if it exists
    if (window.MagnifiCharts && typeof window.MagnifiCharts.updateTheme === 'function') {
      window.MagnifiCharts.updateTheme(theme);
    }
  }

  function toggle() {
    const next = _current === 'dark' ? 'light' : 'dark';
    apply(next);
    // Persist to server state
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  function init(savedTheme) {
    const theme = THEMES.includes(savedTheme) ? savedTheme : 'dark';
    apply(theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  window.MagnifiTheme = { init, apply, current: () => _current };
})();
