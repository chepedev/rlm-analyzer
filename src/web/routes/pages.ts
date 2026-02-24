import { Router, type Request, type Response } from 'express';

export const pagesRouter = Router();

function baseHTML(title: string, bodyContent: string, scripts: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="/public/style.css" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="nav-brand">🔍 RLM Analyzer</a>
    <span class="nav-subtitle">Cost Dashboard</span>
  </nav>
  <main class="container">
    ${bodyContent}
  </main>
  ${scripts}
</body>
</html>`;
}

// GET /
pagesRouter.get('/', (_req: Request, res: Response) => {
  const body = `
    <div class="page-header">
      <h1>Dashboard</h1>
      <div class="page-actions">
        <select id="period-filter" class="select-field" onchange="updatePeriod(this.value)">
          <option value="hour">Per Hour</option>
          <option value="day" selected>Per Day</option>
          <option value="week">Per Week</option>
          <option value="month">Per Month</option>
        </select>
        <button id="btn-clean" class="btn btn-danger">🗑 Clean All Logs</button>
      </div>
    </div>

    <div class="cards-row" id="summary-cards">
      <div class="card">
        <div class="card-label">Today's Cost</div>
        <div class="card-value" id="cost-today">—</div>
      </div>
      <div class="card">
        <div class="card-label">This Month</div>
        <div class="card-value" id="cost-month">—</div>
      </div>
      <div class="card">
        <div class="card-label">All Time</div>
        <div class="card-value" id="cost-alltime">—</div>
      </div>
      <div class="card">
        <div class="card-label">Total Analyses</div>
        <div class="card-value" id="count-alltime">—</div>
      </div>
    </div>

    <div class="section">
      <h2 id="chart-title">Daily Cost (Last 30 Days)</h2>
      <div class="chart-wrap">
        <canvas id="chart-daily"></canvas>
      </div>
    </div>

    <div class="section">
      <h2>Projects</h2>
      <div class="filter-bar">
        <select id="source-filter" class="select-field" onchange="filterBySource(this.value)">
          <option value="">All Sources</option>
          <option value="rlm">RLM Analyzer Only</option>
          <option value="kilocode">Kilo Code Only</option>
        </select>
      </div>
      <div class="table-wrap">
        <table id="projects-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Total Cost</th>
              <th>Total Tokens</th>
              <th>Analyses</th>
              <th>Last Used</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="projects-tbody">
            <tr><td colspan="7" class="loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const scripts = `<script src="/public/dashboard.js"></script>`;
  res.send(baseHTML('RLM Analyzer — Dashboard', body, scripts));
});

// GET /project/:name
pagesRouter.get('/project/:name', (req: Request, res: Response) => {
  const name = String(req.params['name']);
  const encoded = encodeURIComponent(name);

  const body = `
    <div class="page-header">
      <div>
        <a href="/" class="back-link">← Back</a>
        <h1>${name}</h1>
      </div>
      <button id="btn-clean" class="btn btn-danger" data-project="${encoded}">🗑 Clean Project Logs</button>
    </div>

    <div class="cards-row" id="project-cards">
      <div class="card">
        <div class="card-label">Total Cost</div>
        <div class="card-value" id="stat-cost">—</div>
      </div>
      <div class="card">
        <div class="card-label">Total Tokens</div>
        <div class="card-value" id="stat-tokens">—</div>
      </div>
      <div class="card">
        <div class="card-label">Analyses</div>
        <div class="card-value" id="stat-count">—</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 id="chart-title">Daily Cost</h2>
        <div class="filter-bar">
          <select id="period-filter" class="select-field" onchange="updatePeriod(this.value)">
            <option value="hour">Per Hour</option>
            <option value="day" selected>Per Day</option>
            <option value="week">Per Week</option>
            <option value="month">Per Month</option>
          </select>
          <select id="source-filter" class="select-field" onchange="filterBySource(this.value)">
            <option value="">All Sources</option>
            <option value="rlm">RLM Analyzer Only</option>
            <option value="kilocode">Kilo Code Only</option>
          </select>
        </div>
      </div>
      <div class="chart-wrap">
        <canvas id="chart-daily"></canvas>
      </div>
    </div>

    <div class="section">
      <h2>Recent Activity</h2>
      <div class="table-wrap">
        <table id="logs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Model</th>
              <th>Tokens (In/Out)</th>
              <th>Cost (USD)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody id="logs-tbody">
            <tr><td colspan="6" class="loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Monthly Breakdown</h2>
      <div class="table-wrap">
        <table id="monthly-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Total Cost</th>
              <th>Total Tokens</th>
              <th>Analyses</th>
            </tr>
          </thead>
          <tbody id="monthly-tbody">
            <tr><td colspan="4" class="loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const scripts = `<script>window.__PROJECT__ = ${JSON.stringify(name)};</script>
<script src="/public/project.js"></script>`;
  res.send(baseHTML(`RLM Analyzer — ${name}`, body, scripts));
});
