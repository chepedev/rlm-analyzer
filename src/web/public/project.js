/* Project detail page — fetches /api/projects/:name */

const project = window.__PROJECT__;
const fmt = (v) => `$${Number(v).toFixed(4)}`;
const fmtNum = (v) => Number(v).toLocaleString();

let currentSource = '';
let dailyChart = null;

function filterBySource(value) {
  currentSource = value;
  loadProject().catch(console.error);
}

async function loadProject() {
  const encoded = encodeURIComponent(project);
  const qs = currentSource ? `&source=${encodeURIComponent(currentSource)}` : '';

  const [dayData, monthData] = await Promise.all([
    fetch(`/api/projects/${encoded}?period=day${qs}`).then(r => r.json()),
    fetch(`/api/projects/${encoded}?period=month${qs}`).then(r => r.json()),
  ]);

  const totalCost   = dayData.reduce((s, d) => s + d.totalCost, 0);
  const totalTokens = dayData.reduce((s, d) => s + d.totalTokens, 0);
  const totalCount  = dayData.reduce((s, d) => s + d.count, 0);

  document.getElementById('stat-cost').textContent   = fmt(totalCost);
  document.getElementById('stat-tokens').textContent = fmtNum(totalTokens);
  document.getElementById('stat-count').textContent  = fmtNum(totalCount);

  renderDailyChart(dayData);
  renderMonthlyTable(monthData);
}

function renderDailyChart(dayData) {
  const sorted = [...dayData].sort((a, b) => a.period.localeCompare(b.period)).slice(-30);
  const labels = sorted.map(d => d.period);
  const values = sorted.map(d => d.totalCost);

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

function renderMonthlyTable(monthData) {
  const tbody = document.getElementById('monthly-tbody');
  if (!monthData.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">No data yet.</td></tr>';
    return;
  }
  const sorted = [...monthData].sort((a, b) => b.period.localeCompare(a.period));
  tbody.innerHTML = sorted.map(row => `
    <tr>
      <td>${row.period}</td>
      <td>${fmt(row.totalCost)}</td>
      <td>${fmtNum(row.totalTokens)}</td>
      <td>${fmtNum(row.count)}</td>
    </tr>
  `).join('');
}

document.getElementById('btn-clean').addEventListener('click', async () => {
  if (!confirm(`Delete all logs for project "${project}"?`)) return;
  const encoded = encodeURIComponent(project);
  const res = await fetch(`/api/logs?project=${encoded}`, { method: 'DELETE' });
  const data = await res.json();
  alert(`Deleted ${data.deleted} log(s).`);
  window.location.href = '/';
});

loadProject().catch(console.error);
