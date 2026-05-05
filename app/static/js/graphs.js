/* graphs.js — Apache ECharts chart rendering with interactive configuration */
(function () {
  'use strict';

  let _chart     = null;
  let _chartType = 'bar';
  let _schema    = [];
  let _numericCols = [];
  let _activeFile = null;
  let _lastData   = null;

  // ECharts theme palettes
  const PALETTE_DARK  = ['#7c3aed','#60a5fa','#34d399','#f59e0b','#f87171','#a78bfa','#38bdf8','#4ade80'];
  const PALETTE_LIGHT = ['#5b21b6','#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0284c7','#16a34a'];

  function init() {
    // Chart type buttons
    document.getElementById('chart-type-grid')?.addEventListener('click', e => {
      const btn = e.target.closest('.chart-type-btn');
      if (!btn) return;
      document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _chartType = btn.dataset.type;
      _populateColumns();
      _toggleYCol();
    });

    document.getElementById('render-chart')?.addEventListener('click', renderChart);
    document.getElementById('export-chart-png')?.addEventListener('click', exportPNG);

    // Y col visibility: hide for count-only charts
    document.getElementById('aggregation')?.addEventListener('change', _toggleYCol);
  }

  function setFile(filename, schema) {
    _activeFile = filename;
    _schema = schema || [];
    _numericCols = _schema
      .filter(c => /INTEGER|BIGINT|FLOAT|DOUBLE|DECIMAL|HUGEINT|UBIGINT|SMALLINT|TINYINT|REAL|NUMERIC|INT|NUMBER/i.test(c.type || ''))
      .map(c => c.name);
    _populateColumns();
    loadSuggestions();
  }

  function _toggleYCol() {
    const agg = document.getElementById('aggregation')?.value;
    const yGroup = document.getElementById('y-col-group');
    const aggGroup = document.getElementById('agg-group');
    const scatterNoAgg = _chartType === 'scatter';
    if (yGroup) yGroup.style.display = _chartType === 'histogram' ? 'none' : '';
    if (aggGroup) aggGroup.style.display = scatterNoAgg ? 'none' : '';
  }

  function _populateColumns() {
    const xSel = document.getElementById('x-col');
    const ySel = document.getElementById('y-col');
    if (!xSel || !ySel) return;

    const source = (_chartType === 'scatter' || _chartType === 'histogram')
      ? _schema.filter(c => _numericCols.includes(c.name))
      : _schema;

    xSel.innerHTML = '';
    ySel.innerHTML = '<option value="">— Use COUNT —</option>';

    for (const col of source) {
      const ox = document.createElement('option');
      ox.value = col.name; ox.textContent = col.name;
      xSel.appendChild(ox);

      const oy = document.createElement('option');
      oy.value = col.name; oy.textContent = col.name;
      ySel.appendChild(oy);
    }

    if (_chartType === 'scatter' && source.length >= 2 && !ySel.value) {
      ySel.value = source[1].name;
    }
  }

  async function loadSuggestions() {
    if (!_activeFile) return;
    const container = document.getElementById('chart-suggestions');
    if (!container) return;

    try {
      const res = await fetch(`/api/graphs/suggest?file=${encodeURIComponent(_activeFile)}`);
      const data = await res.json();
      const suggestions = data.suggestions || [];

      container.innerHTML = '';
      if (!suggestions.length) {
        container.innerHTML = '<div class="detail-empty">No suggestions available</div>';
        return;
      }
      for (const s of suggestions) {
        const btn = document.createElement('button');
        btn.className = 'suggestion-btn';
        btn.textContent = s.label;
        btn.addEventListener('click', () => _applysuggestion(s));
        container.appendChild(btn);
      }
    } catch (e) {}
  }

  function _applysuggestion(s) {
    // Set chart type
    _chartType = s.chart_type;
    document.querySelectorAll('.chart-type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === s.chart_type);
    });
    // Set x col
    const xSel = document.getElementById('x-col');
    if (xSel && s.x_col) xSel.value = s.x_col;
    // Set y col
    const ySel = document.getElementById('y-col');
    if (ySel) ySel.value = s.y_col || '';
    // Set aggregation
    const agg = document.getElementById('aggregation');
    if (agg && s.aggregation && s.aggregation !== 'NONE') agg.value = s.aggregation;
    _toggleYCol();
    renderChart();
  }

  async function renderChart() {
    if (!_activeFile) {
      if (window.MagnifiApp) window.MagnifiApp.toast('No file loaded', 'error');
      return;
    }

    const xCol  = document.getElementById('x-col')?.value;
    const yCol  = document.getElementById('y-col')?.value;
    const agg   = document.getElementById('aggregation')?.value || 'COUNT';
    const limit = parseInt(document.getElementById('chart-limit')?.value || '50', 10);

    if (!xCol) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Select an X axis column', 'error');
      return;
    }

    if ((_chartType === 'scatter' || _chartType === 'histogram') && !_numericCols.includes(xCol)) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Scatter and histogram require numeric columns', 'error');
      return;
    }
    if (_chartType === 'scatter' && yCol && !_numericCols.includes(yCol)) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Scatter Y axis must be numeric', 'error');
      return;
    }

    try {
      const res = await fetch('/api/graphs/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: _activeFile,
          chart_type: _chartType,
          x_col: xCol,
          y_col: yCol || null,
          aggregation: agg,
          limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (window.MagnifiApp) window.MagnifiApp.toast(data.detail || 'Chart error', 'error');
        return;
      }
      _lastData = data;
      _renderECharts(data);
    } catch (e) {
      if (window.MagnifiApp) window.MagnifiApp.toast('Chart request failed', 'error');
    }
  }

  function _renderECharts(data) {
    const container = document.getElementById('chart-container');
    if (!container) return;
    container.innerHTML = ''; // clear placeholder

    if (typeof echarts === 'undefined') {
      container.innerHTML = '<div class="detail-empty">ECharts not loaded</div>';
      return;
    }

    const isDark  = document.documentElement.getAttribute('data-bs-theme') !== 'light';
    const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
    const bg      = isDark ? '#13131a' : '#ffffff';
    const textCol = isDark ? '#9898b0' : '#4b4b6a';

    if (_chart) { _chart.dispose(); _chart = null; }
    _chart = echarts.init(container, null, { renderer: 'canvas' });

    const title = { text: data.title || '', left: 'center', textStyle: { color: textCol, fontSize: 13, fontWeight: 600 } };
    const tooltip = { trigger: data.chart_type === 'pie' ? 'item' : 'axis', backgroundColor: isDark ? '#1c1c27' : '#fff', borderColor: isDark ? '#252534' : '#e5e7eb', textStyle: { color: isDark ? '#e4e4ef' : '#1a1a2e' } };

    let option = {};

    if (data.chart_type === 'scatter') {
      option = {
        backgroundColor: bg, color: palette, title, tooltip: { trigger: 'item' },
        xAxis: { type: 'value', name: data.x_name, nameTextStyle: { color: textCol }, axisLabel: { color: textCol }, splitLine: { lineStyle: { color: isDark ? '#252534' : '#f0eef8' } } },
        yAxis: { type: 'value', name: data.y_name, nameTextStyle: { color: textCol }, axisLabel: { color: textCol }, splitLine: { lineStyle: { color: isDark ? '#252534' : '#f0eef8' } } },
        series: [{ type: 'scatter', data: data.data, symbolSize: 7, itemStyle: { color: palette[0], opacity: .7 } }],
      };
    } else if (data.chart_type === 'pie') {
      option = {
        backgroundColor: bg, color: palette, title, tooltip,
        legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: textCol } },
        series: [{
          type: 'pie', radius: ['35%', '65%'], center: ['40%', '55%'],
          data: (data.x_axis || []).map((label, i) => ({ name: label, value: data.series?.[0]?.data?.[i] ?? 0 })),
          label: { color: textCol }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,.3)' } },
        }],
      };
    } else {
      // bar, line, radar, histogram
      const xAxis = { type: 'category', data: data.x_axis || [], axisLabel: { color: textCol, rotate: data.x_axis?.length > 10 ? 30 : 0 }, axisLine: { lineStyle: { color: isDark ? '#252534' : '#e5e7eb' } } };
      const yAxis = { type: 'value', axisLabel: { color: textCol }, splitLine: { lineStyle: { color: isDark ? '#252534' : '#f0eef8' } } };
      const series = (data.series || []).map((s, i) => ({
        name: s.name, type: data.chart_type === 'histogram' ? 'bar' : data.chart_type,
        data: s.data,
        itemStyle: { color: palette[i % palette.length], borderRadius: data.chart_type === 'bar' ? [3, 3, 0, 0] : 0 },
        smooth: data.chart_type === 'line',
        areaStyle: data.chart_type === 'line' ? { opacity: .15 } : undefined,
      }));
      option = { backgroundColor: bg, color: palette, title, tooltip, xAxis, yAxis, series, grid: { left: 60, right: 20, top: 50, bottom: data.x_axis?.length > 10 ? 70 : 40 } };
    }

    _chart.setOption(option);

    // Responsive resize
    const ro = new ResizeObserver(() => _chart?.resize());
    ro.observe(container);
  }

  function updateTheme(theme) {
    if (_lastData) _renderECharts(_lastData);
  }

  function exportPNG() {
    if (!_chart) {
      if (window.MagnifiApp) window.MagnifiApp.toast('No chart to export', 'error');
      return;
    }
    const url = _chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: document.documentElement.getAttribute('data-bs-theme') !== 'light' ? '#13131a' : '#fff' });
    const a = document.createElement('a');
    a.href = url; a.download = 'chart.png'; a.click();
  }

  window.MagnifiCharts = { init, setFile, renderChart, loadSuggestions, updateTheme };
})();
