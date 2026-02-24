/* Dashboard page — fetches /api/summary and /api/projects */

const fmt = (v) => `$${Number(v).toFixed(4)}`;
const fmtNum = (v) => Number(v).toLocaleString();

let currentSource = '';
let currentPeriod = 'day';
let dailyChart = null;

async function loadSummaryCards(source, period) {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const src = source !== undefined ? source : currentSource;
  const per = period !== undefined ? period : currentPeriod;
  const qs = src ? `&source=${encodeURIComponent(src)}` : '';

  const [dayData, monthData, projectData] = await Promise.all([
    fetch(`/api/summary?period=${per}${qs}`).then(r => r.json()),
    fetch(`/api/summary?period=month${qs}`).then(r => r.json()),
    fetch(`/api/projects${src ? '?source=' + encodeURIComponent(src) : ''}`).then(r => r.json()),
  ]);

  const todayCost = dayData
    .filter(d => d.period.startsWith(today))
    .reduce((s, d) => s + d.totalCost, 0);

  const monthCost = monthData
    .filter(d => d.period === thisMonth)
    .reduce((s, d) => s + d.totalCost, 0);

  const allTimeCost = projectData.reduce((s, d) => s + d.totalCost, 0);
  const allTimeCount = projectData.reduce((s, d) => s + d.count, 0);

  document.getElementById('cost-today').textContent = fmt(todayCost);
  document.getElementById('cost-month').textContent = fmt(monthCost);
  document.getElementById('cost-alltime').textContent = fmt(allTimeCost);
  document.getElementById('count-alltime').textContent = fmtNum(allTimeCount);

  updateChartTitle(per);
  renderDailyChart(dayData);
  renderProjectsTable(projectData);
}

function updateChartTitle(period) {
  const titles = {
    hour: 'Cost Per Hour (Recent)',
    day: 'Daily Cost (Last 30 Days)',
    week: 'Weekly Cost (Recent)',
    month: 'Monthly Cost (Full History)'
  };
  document.getElementById('chart-title').textContent = titles[period] || 'Cost Breakdown';
}

function renderDailyChart(dayData) {
  // Aggregate across all projects per period
  const map = {};
  for (const d of dayData) {
    map[d.period] = (map[d.period] || 0) + d.totalCost;
  }

  const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  // Limit based on period
  let limit = 30;
  if (currentPeriod === 'hour') limit = 24;
  if (currentPeriod === 'month') limit = 12;
  const results = sorted.slice(-limit);

  const labels = results.map(e => e[0]);
  const values = results.map(e => e[1]);

  const ctx = document.getElementById('chart-daily').getContext('2d');
  if (dailyChart) {
    dailyChart.destroy();
  }
  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Cost (USD)',
        data: values,
        backgroundColor: 'rgba(99,102,241,0.7)',
        borderColor: '#6366f1',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` $${ctx.parsed.y.toFixed(4)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8892a4', font: { size: 11 } },
          grid: { color: '#2e3347' },
        },
        y: {
          ticks: { color: '#8892a4', font: { size: 11 }, callback: v => `$${v.toFixed(3)}` },
          grid: { color: '#2e3347' },
        },
      },
    },
  });
}

function formatSources(sources) {
  if (!sources || !sources.length) return '—';
  const labels = sources.map(s => {
    if (s === 'cli') return 'RLM CLI';
    if (s === 'mcp') return 'RLM MCP';
    if (s === 'kilocode') return 'Kilo Code';
    return s;
  });
  return labels.join(', ');
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-tbody');
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No data yet.</td></tr>';
    return;
  }
  tbody.innerHTML = projects.map(p => `
    <tr>
      <td><a href="/project/${encodeURIComponent(p.project)}">${p.project}</a></td>
      <td>${fmt(p.totalCost)}</td>
      <td>${fmtNum(p.totalTokens)}</td>
      <td>${fmtNum(p.count)}</td>
      <td>${new Date(p.lastUsed).toLocaleDateString()}</td>
      <td>${formatSources(p.sources)}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${encodeURIComponent(p.project)}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function deleteProject(encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Delete all logs for project "${name}"?`)) return;
  const res = await fetch(`/api/logs?project=${encodedName}`, { method: 'DELETE' });
  const data = await res.json();
  alert(`Deleted ${data.deleted} log(s).`);
  location.reload();
}

function filterBySource(value) {
  currentSource = value;
  loadSummaryCards(currentSource, currentPeriod).catch(console.error);
}

function updatePeriod(value) {
  currentPeriod = value;
  loadSummaryCards(currentSource, currentPeriod).catch(console.error);
}

document.getElementById('btn-clean').addEventListener('click', async () => {
  if (!confirm('Delete ALL logs? This cannot be undone.')) return;
  const res = await fetch('/api/logs', { method: 'DELETE' });
  const data = await res.json();
  alert(`Deleted ${data.deleted} log(s).`);
  location.reload();
});

loadSummaryCards().catch(console.error);
