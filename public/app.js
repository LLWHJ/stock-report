let chartInstance = null;

document.getElementById('searchBtn').addEventListener('click', handleSearch);
document.getElementById('tickerInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSearch();
});

async function handleSearch() {
  const ticker = document.getElementById('tickerInput').value.trim();
  if (!ticker) return;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.textContent = '加载中…';

  const resultArea = document.getElementById('resultArea');
  resultArea.classList.remove('hidden');
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('report').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  try {
    const res = await fetch('/api/report?ticker=' + encodeURIComponent(ticker));
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    renderReport(data);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('report').classList.remove('hidden');

  } catch (err) {
    showError('请求失败，请检查网络连接或稍后重试');
  } finally {
    btn.disabled = false;
    btn.textContent = '生成报告';
  }
}

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('report').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
}

function formatCurrency(val, currency) {
  if (val == null) return '—';
  const sym = currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : '$';
  if (Math.abs(val) >= 1e12) { return sym + (val / 1e12).toFixed(2) + '万亿'; }
  if (Math.abs(val) >= 1e8)  { return sym + (val / 1e8).toFixed(2) + '亿'; }
  if (Math.abs(val) >= 1e4)  { return sym + (val / 1e4).toFixed(2) + '万'; }
  return sym + val.toFixed(2);
}

function formatVolume(v) {
  if (v == null) return '—';
  if (v >= 1e9)  { return (v / 1e9).toFixed(2) + 'B'; }
  if (v >= 1e6)  { return (v / 1e6).toFixed(2) + 'M'; }
  if (v >= 1e3)  { return (v / 1e3).toFixed(2) + 'K'; }
  return String(v);
}

function renderReport(data) {
  const { price, history, indicators, changes, news, recommendation } = data;
  const currency = price.currency || 'USD';

  /* ---- overview ---- */
  document.getElementById('stockName').textContent = price.name || '—';
  document.getElementById('stockTicker').textContent = document.getElementById('tickerInput').value.trim();
  document.getElementById('currentPrice').textContent = formatCurrency(price.current, currency);

  const chgEl = document.getElementById('priceChange');
  const chgVal = price.change;
  const chgPct = price.changePercent;
  if (chgVal != null) {
    const sign = chgVal >= 0 ? '+' : '';
    chgEl.textContent = sign + chgVal.toFixed(2) + ' (' + sign + chgPct.toFixed(2) + '%)';
    chgEl.className = 'change ' + (chgVal >= 0 ? 'up' : 'down');
  } else {
    chgEl.textContent = '—';
  }

  document.getElementById('openPrice').textContent  = formatCurrency(price.open, currency);
  document.getElementById('highPrice').textContent  = formatCurrency(price.high, currency);
  document.getElementById('lowPrice').textContent   = formatCurrency(price.low, currency);
  document.getElementById('prevClose').textContent  = formatCurrency(price.prevClose, currency);
  document.getElementById('volume').textContent     = formatVolume(price.volume);

  /* ---- changes ---- */
  const changeIds = { d1: 'chgD1', d5: 'chgD5', m1: 'chgM1', m3: 'chgM3' };
  Object.entries(changeIds).forEach(([key, id]) => {
    const el = document.getElementById(id);
    const val = changes[key];
    if (val != null) {
      const sign = val >= 0 ? '+' : '';
      el.textContent = sign + val.toFixed(2) + '%';
      el.className = 'stat-val ' + (val >= 0 ? 'up' : 'down');
    } else {
      el.textContent = '—';
      el.className = 'stat-val';
    }
  });

  /* ---- indicators ---- */
  const indData = [
    { id: 'indMA5', val: indicators.ma5 },
    { id: 'indMA10', val: indicators.ma10 },
    { id: 'indMA20', val: indicators.ma20 },
    { id: 'indRSI', val: indicators.rsi }
  ];
  indData.forEach(({ id, val }) => {
    document.getElementById(id).textContent = val != null && !isNaN(val) ? val.toFixed(2) : '—';
  });

  /* ---- chart ---- */
  const chartSection = document.querySelector('.chart-section');
  if (history && history.length) {
    renderChart(history, indicators);
    chartSection.classList.remove('hidden');
  } else {
    chartSection.classList.add('hidden');
  }

  /* ---- news ---- */
  const newsList = document.getElementById('newsList');
  newsList.innerHTML = '';
  if (news && news.length) {
    news.forEach(item => {
      const li = document.createElement('li');
      const sentClass = item.sentiment || 'neutral';
      const sentLabel = { positive: '利好', negative: '利空', neutral: '中性' }[sentClass] || '中性';
      li.innerHTML = `
        <span class="news-sentiment ${sentClass}">${sentLabel}</span>
        <div>
          <a href="${item.link || '#'}" class="news-title" target="_blank" rel="noopener">${item.title}</a>
          <div class="news-meta">${item.publisher || ''}${item.published ? ' · ' + new Date(item.published * 1000).toLocaleDateString('zh-CN') : ''}</div>
        </div>
      `;
      newsList.appendChild(li);
    });
  } else {
    newsList.innerHTML = '<li style="color:#6e6e73;font-size:13px;padding:8px 0">暂无相关新闻</li>';
  }

  /* ---- recommendation ---- */
  const rec = recommendation;
  const recBadge = document.getElementById('recBadge');
  const recLabels = { buy: '建议买入', sell: '建议卖出', hold: '建议观望' };
  const recClasses = { buy: 'buy', sell: 'sell', hold: 'hold' };
  recBadge.textContent = recLabels[rec.action] || '建议观望';
  recBadge.className = 'rec-badge ' + (recClasses[rec.action] || 'hold');

  document.getElementById('recConfidence').textContent = rec.confidence + '%';

  const reasonsEl = document.getElementById('recReasons');
  reasonsEl.innerHTML = '';
  if (rec.reasons && rec.reasons.length) {
    rec.reasons.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    });
  }
}

/* ---- chart ---- */
function renderChart(history, indicators) {
  const canvas = document.getElementById('priceChart');
  const ctx = canvas.getContext('2d');

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const labels = history.map(d => {
    const parts = d.date.split('-');
    return parts[1] + '/' + parts[2];
  });
  const closes = history.map(d => d.close);

  // Calcaulate MA lines from closing prices
  const ma5 = calcSMA(closes, 5);
  const ma10 = calcSMA(closes, 10);
  const ma20 = calcSMA(closes, 20);

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '收盘价',
          data: closes,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,.08)',
          fill: true,
          tension: .3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2
        },
        {
          label: 'MA5',
          data: ma5,
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: .3,
          borderDash: [4, 3]
        },
        {
          label: 'MA10',
          data: ma10,
          borderColor: '#10b981',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: .3,
          borderDash: [4, 3]
        },
        {
          label: 'MA20',
          data: ma20,
          borderColor: '#ef4444',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: .3,
          borderDash: [4, 3]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 14, padding: 12, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => ctx.parsed.y !== null ? ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) : ''
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 12, font: { size: 11 }, color: '#9ca3af' }
        },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: {
            font: { size: 11 }, color: '#9ca3af',
            callback: v => v.toFixed(0)
          }
        }
      }
    }
  });
}

function calcSMA(data, period) {
  const r = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { r.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += data[j];
    r.push(+(s / period).toFixed(2));
  }
  return r;
}
