# Web Dashboard & MongoDB Cost Tracking — Architecture Document

## Overview

Add MongoDB-based usage logging and a web dashboard to rlm-analyzer. Every CLI and MCP analysis will log token usage, cost, and metadata to MongoDB. A new `rlm dashboard` command starts an Express server serving a Chart.js-powered dashboard.

---

## New Dependencies

```json
{
  "mongodb": "^6.12.0",
  "express": "^4.21.0",
  "@types/express": "^4.17.21"
}
```

`mongodb` and `express` as runtime dependencies. `@types/express` as devDependency.

---

## File Structure

```
src/
  cost-logger.ts              # MongoDB connection + logUsage()
  web/
    server.ts                 # Express app factory + start function
    routes/
      api.ts                  # REST API routes
      pages.ts                # HTML page routes (server-rendered)
    public/
      style.css               # Dashboard styles
      dashboard.js            # Client-side Chart.js logic
    views/
      layout.html             # Shared HTML shell
      dashboard.html          # Home dashboard template
      project.html            # Project detail template
```

---

## 1. MongoDB Cost Logger — [`src/cost-logger.ts`](src/cost-logger.ts)

### Connection Management

```typescript
import { MongoClient, type Collection, type Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'rlm_analyzer';
const COLLECTION_NAME = 'usage_logs';

let client: MongoClient | null = null;
let db: Db | null = null;

async function getCollection(): Promise<Collection<UsageLog> | null> {
  try {
    if (!client) {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
      });
      await client.connect();
      db = client.db(DB_NAME);
    }
    return db!.collection<UsageLog>(COLLECTION_NAME);
  } catch {
    return null; // Graceful failure
  }
}
```

- Short timeouts so CLI doesn't hang if MongoDB is down
- Singleton connection reused across calls
- Returns `null` on failure — callers skip logging silently

### Document Schema

```typescript
export interface UsageLog {
  timestamp: Date;
  provider: string;          // 'gemini' | 'bedrock' | 'claude'
  model: string;             // e.g. 'gemini-2.5-flash'
  analysisType: string;      // AnalysisType value
  directory: string;         // project name extracted from path (basename)
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  executionTimeMs: number;
  subCallCount: number;
  source: 'cli' | 'mcp';
  success: boolean;
}
```

### `logUsage()` Function

```typescript
export async function logUsage(params: {
  provider: string;
  model: string;
  analysisType: string;
  directory: string;
  result: RLMResult;
  source: 'cli' | 'mcp';
}): Promise<void> {
  try {
    const col = await getCollection();
    if (!col) return;

    const projectName = path.basename(params.directory);
    const usage = params.result.tokenUsage;

    await col.insertOne({
      timestamp: new Date(),
      provider: params.provider,
      model: params.model,
      analysisType: params.analysisType,
      directory: projectName,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      costUsd: params.result.costUsd ?? 0,
      executionTimeMs: params.result.executionTimeMs,
      subCallCount: params.result.subCallCount,
      source: params.source,
      success: params.result.success,
    });
  } catch {
    // Silent failure — never crash the analysis
  }
}
```

### `closeConnection()` Function

```typescript
export async function closeConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
```

### Index Creation

On first connection, ensure indexes exist:

```typescript
async function ensureIndexes(col: Collection<UsageLog>): Promise<void> {
  await col.createIndex({ timestamp: -1 });
  await col.createIndex({ directory: 1, timestamp: -1 });
}
```

Call `ensureIndexes` inside `getCollection()` on first successful connect (use a boolean flag).

---

## 2. Integration Points

### CLI Integration — [`src/cli.ts`](src/cli.ts)

After every analysis command completes (summary, arch, deps, security, perf, refactor, ask, explain, find), call [`logUsage()`](src/cost-logger.ts):

```typescript
import { logUsage } from './cost-logger.js';

// After result is obtained:
await logUsage({
  provider: resolvedProvider,
  model: resolvedModel,
  analysisType: command,
  directory: targetDir,
  result,
  source: 'cli',
});
```

The CLI already has access to `provider`, `model`, `directory`, and `result` in each command handler. Add the `logUsage` call right before printing results.

### MCP Server Integration — [`src/mcp-server.ts`](src/mcp-server.ts)

Same pattern. The [`formatResult()`](src/mcp-server.ts:67) function already receives the `RLMResult`. Add `logUsage` call in each tool handler after getting the result:

```typescript
import { logUsage } from './cost-logger.js';

// Inside each tool handler, after result:
await logUsage({
  provider,
  model,
  analysisType,
  directory: args.directory,
  result,
  source: 'mcp',
});
```

---

## 3. Web Dashboard Server — [`src/web/server.ts`](src/web/server.ts)

```typescript
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { apiRouter } from './routes/api.js';
import { pagesRouter } from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/public', express.static(path.join(__dirname, 'public')));
  app.use('/api', apiRouter);
  app.use('/', pagesRouter);
  return app;
}

export function startDashboard(): void {
  const port = parseInt(process.env.RLM_WEB_PORT || '9876', 10);
  const app = createApp();
  app.listen(port, () => {
    console.log(`RLM Dashboard running at http://localhost:${port}`);
  });
}
```

### CLI Command — `rlm dashboard`

Add a `dashboard` case in [`src/cli.ts`](src/cli.ts) command switch:

```typescript
case 'dashboard':
case 'web':
  const { startDashboard } = await import('./web/server.js');
  startDashboard();
  break;
```

This is a long-running command — it keeps the process alive.

### Build Considerations

- Static files (`public/`, `views/`) must be copied to `dist/web/` during build
- Add to [`package.json`](package.json) build script: `&& cp -r src/web/public dist/web/public && cp -r src/web/views dist/web/views`
- Or use a simple post-build copy script

---

## 4. REST API Routes — [`src/web/routes/api.ts`](src/web/routes/api.ts)

### `GET /api/health`

```typescript
router.get('/health', async (_req, res) => {
  const col = await getCollection();
  res.json({ status: col ? 'ok' : 'mongodb_unavailable' });
});
```

### `GET /api/summary`

Returns aggregate costs grouped by project, day, and month.

**MongoDB Aggregation:**

```typescript
router.get('/summary', async (req, res) => {
  const col = await getCollection();
  if (!col) return res.status(503).json({ error: 'MongoDB unavailable' });

  const [byProject, byDay, byMonth] = await Promise.all([
    // By project
    col.aggregate([
      { $group: {
        _id: '$directory',
        totalCost: { $sum: '$costUsd' },
        totalInputTokens: { $sum: '$inputTokens' },
        totalOutputTokens: { $sum: '$outputTokens' },
        totalRequests: { $sum: 1 },
        lastUsed: { $max: '$timestamp' },
      }},
      { $sort: { totalCost: -1 } },
    ]).toArray(),

    // By day (last 30 days)
    col.aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - 30 * 86400000) } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        totalCost: { $sum: '$costUsd' },
        totalRequests: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray(),

    // By month (last 12 months)
    col.aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - 365 * 86400000) } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$timestamp' } },
        totalCost: { $sum: '$costUsd' },
        totalRequests: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  res.json({ byProject, byDay, byMonth });
});
```

### `GET /api/projects`

```typescript
router.get('/projects', async (_req, res) => {
  const col = await getCollection();
  if (!col) return res.status(503).json({ error: 'MongoDB unavailable' });

  const projects = await col.aggregate([
    { $group: {
      _id: '$directory',
      totalCost: { $sum: '$costUsd' },
      totalRequests: { $sum: 1 },
      lastUsed: { $max: '$timestamp' },
    }},
    { $sort: { lastUsed: -1 } },
  ]).toArray();

  res.json(projects);
});
```

### `GET /api/projects/:name`

```typescript
router.get('/projects/:name', async (req, res) => {
  const col = await getCollection();
  if (!col) return res.status(503).json({ error: 'MongoDB unavailable' });
  const name = req.params.name;

  const [summary, daily, monthly, recentLogs] = await Promise.all([
    // Overall summary for this project
    col.aggregate([
      { $match: { directory: name } },
      { $group: {
        _id: null,
        totalCost: { $sum: '$costUsd' },
        totalInputTokens: { $sum: '$inputTokens' },
        totalOutputTokens: { $sum: '$outputTokens' },
        totalRequests: { $sum: 1 },
        avgExecutionTime: { $avg: '$executionTimeMs' },
      }},
    ]).toArray(),

    // Daily breakdown (last 30 days)
    col.aggregate([
      { $match: { directory: name, timestamp: { $gte: new Date(Date.now() - 30 * 86400000) } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        totalCost: { $sum: '$costUsd' },
        totalRequests: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray(),

    // Monthly breakdown
    col.aggregate([
      { $match: { directory: name } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$timestamp' } },
        totalCost: { $sum: '$costUsd' },
        totalRequests: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray(),

    // Last 50 individual logs
    col.find({ directory: name })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray(),
  ]);

  res.json({
    project: name,
    summary: summary[0] || null,
    daily,
    monthly,
    recentLogs,
  });
});
```

### `DELETE /api/logs`

Query params: `project`, `before` (ISO date), `after` (ISO date).

```typescript
router.delete('/logs', async (req, res) => {
  const col = await getCollection();
  if (!col) return res.status(503).json({ error: 'MongoDB unavailable' });

  const filter: any = {};
  if (req.query.project) filter.directory = req.query.project;
  if (req.query.before || req.query.after) {
    filter.timestamp = {};
    if (req.query.before) filter.timestamp.$lte = new Date(req.query.before as string);
    if (req.query.after) filter.timestamp.$gte = new Date(req.query.after as string);
  }

  // If no filters, require explicit ?all=true to prevent accidental deletion
  if (Object.keys(filter).length === 0 && req.query.all !== 'true') {
    return res.status(400).json({ error: 'Specify filters or pass ?all=true to delete everything' });
  }

  const result = await col.deleteMany(filter);
  res.json({ deletedCount: result.deletedCount });
});
```

---

## 5. HTML Page Routes — [`src/web/routes/pages.ts`](src/web/routes/pages.ts)

Server-rendered HTML using simple string template replacement. Read HTML files from `views/`, replace `{{CONTENT}}` placeholders.

```typescript
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, '..', 'views');

function renderPage(template: string, title: string): string {
  const layout = fs.readFileSync(path.join(viewsDir, 'layout.html'), 'utf-8');
  const content = fs.readFileSync(path.join(viewsDir, template), 'utf-8');
  return layout
    .replace('{{TITLE}}', title)
    .replace('{{CONTENT}}', content);
}

const router = Router();

router.get('/', (_req, res) => {
  res.send(renderPage('dashboard.html', 'RLM Dashboard'));
});

router.get('/project/:name', (req, res) => {
  const html = renderPage('project.html', `Project: ${req.params.name}`)
    .replace('{{PROJECT_NAME}}', req.params.name);
  res.send(html);
});

export { router as pagesRouter };
```

---

## 6. Views & Static Assets

### [`src/web/views/layout.html`](src/web/views/layout.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
  <link rel="stylesheet" href="/public/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <nav>
    <a href="/">RLM Dashboard</a>
  </nav>
  <main>
    {{CONTENT}}
  </main>
  <script src="/public/dashboard.js"></script>
</body>
</html>
```

### [`src/web/views/dashboard.html`](src/web/views/dashboard.html) — Wireframe

```
┌─────────────────────────────────────────────────┐
│  RLM Analyzer Dashboard                         │
├─────────────────────────────────────────────────┤
│  Summary Cards:                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Total Cost│ │ Requests │ │ Projects │        │
│  │ $12.34   │ │   156    │ │    8     │        │
│  └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────┤
│  Daily Cost Chart (bar, last 30 days)           │
│  ┌─────────────────────────────────────┐        │
│  │  ▐▐  ▐▐▐▐  ▐▐▐  ▐▐▐▐▐▐  ▐▐       │        │
│  └─────────────────────────────────────┘        │
├─────────────────────────────────────────────────┤
│  Monthly Cost Chart (bar, last 12 months)       │
├─────────────────────────────────────────────────┤
│  Cost by Project (horizontal bar or table)      │
│  ┌──────────────────────────────────────┐       │
│  │ my-project    ████████████  $8.50    │       │
│  │ other-proj    ████          $2.10    │       │
│  │ ...                                  │       │
│  └──────────────────────────────────────┘       │
├─────────────────────────────────────────────────┤
│  Clean Logs Section:                            │
│  [Delete All] [Delete by Project ▼] [By Date]  │
└─────────────────────────────────────────────────┘
```

Content: summary cards div, canvas elements for charts, project table, delete controls. All data fetched client-side via `fetch('/api/summary')`.

### [`src/web/views/project.html`](src/web/views/project.html) — Wireframe

```
┌─────────────────────────────────────────────────┐
│  ← Back    Project: {{PROJECT_NAME}}            │
├─────────────────────────────────────────────────┤
│  Summary: Total Cost, Requests, Avg Time        │
├─────────────────────────────────────────────────┤
│  Daily Cost Chart (last 30 days)                │
├─────────────────────────────────────────────────┤
│  Monthly Cost Chart                             │
├─────────────────────────────────────────────────┤
│  Recent Logs Table:                             │
│  Date | Type | Model | Tokens | Cost | Time     │
│  ─────┼──────┼───────┼────────┼──────┼─────     │
│  ...  │ arch │ flash │ 50k    │$0.02 │ 12s      │
├─────────────────────────────────────────────────┤
│  [Delete Project Logs]                          │
└─────────────────────────────────────────────────┘
```

Data fetched via `fetch('/api/projects/{{PROJECT_NAME}}')`.

### [`src/web/public/dashboard.js`](src/web/public/dashboard.js)

Client-side JS responsibilities:
- Detect current page (dashboard vs project) from URL
- Fetch appropriate API endpoint
- Render Chart.js charts (bar charts for daily/monthly cost)
- Populate summary cards and tables
- Handle delete button clicks with `fetch(DELETE /api/logs?...)`
- Confirm before delete operations

### [`src/web/public/style.css`](src/web/public/style.css)

Simple, clean CSS:
- CSS Grid for summary cards (3-column)
- Max-width container (1200px, centered)
- Responsive (stack on mobile)
- Dark nav bar, light content area
- Table styling for logs

---

## 7. Gemini Pricing Notes

Current [`src/pricing.ts`](src/pricing.ts) prices are reasonable estimates. Key models:

| Model | Input/1M | Output/1M |
|-------|----------|-----------|
| gemini-2.5-flash | $0.075 | $0.30 |
| gemini-1.5-flash | $0.075 | $0.30 |
| gemini-1.5-pro | $1.25 | $5.00 |

The [`calculateCost()`](src/pricing.ts:74) function already correctly computes: `(inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M` with cache token adjustments. No changes needed to pricing logic.

Gemini's `usageMetadata` provides actual token counts which flow into [`RLMResult.tokenUsage`](src/types.ts:93) and [`RLMResult.costUsd`](src/types.ts:95). The cost logger simply records these already-calculated values.

---

## 8. Package.json Changes

```jsonc
{
  "dependencies": {
    // existing...
    "express": "^4.21.0",
    "mongodb": "^6.12.0"
  },
  "devDependencies": {
    // existing...
    "@types/express": "^4.17.21"
  },
  "scripts": {
    "build": "npm run clean && tsc && chmod +x dist/main.js dist/cli.js dist/mcp-server.js && cp -r src/web/public dist/web/public && cp -r src/web/views dist/web/views"
  }
}
```

No new bin entry needed — `rlm dashboard` is handled as a subcommand in the existing CLI.

---

## 9. Implementation Order

1. `src/cost-logger.ts` — MongoDB client, schema, `logUsage()`, `closeConnection()`
2. Integrate `logUsage()` into `src/cli.ts` (all analysis commands)
3. Integrate `logUsage()` into `src/mcp-server.ts` (all tool handlers)
4. `src/web/server.ts` — Express app factory
5. `src/web/routes/api.ts` — All REST endpoints with MongoDB aggregations
6. `src/web/routes/pages.ts` — HTML page serving
7. `src/web/views/` — layout.html, dashboard.html, project.html
8. `src/web/public/style.css` — Dashboard styles
9. `src/web/public/dashboard.js` — Client-side Chart.js rendering
10. Add `dashboard` command to `src/cli.ts`
11. Update `package.json` — dependencies + build script
12. Update `tsconfig.json` if needed (ensure `src/web/` is included)
13. Build and test

---

## 10. Architecture Diagram

```mermaid
flowchart TB
    CLI[rlm CLI] -->|analysis result| CL[cost-logger.ts]
    MCP[MCP Server] -->|analysis result| CL
    CL -->|insertOne| MongoDB[(MongoDB<br/>rlm_analyzer.usage_logs)]

    Dashboard[rlm dashboard] --> Express[Express Server :3000]
    Express --> API[/api/* routes]
    Express --> Pages[/ HTML routes]
    API -->|aggregate queries| MongoDB
    Pages -->|serves| HTML[Static HTML + Chart.js]
    HTML -->|fetch| API
```

---

## 11. Error Handling Strategy

- **MongoDB down during analysis**: `logUsage()` catches all errors, logs nothing, analysis completes normally
- **MongoDB down during dashboard**: API returns `503` with `{ error: 'MongoDB unavailable' }`, dashboard shows friendly error message
- **Invalid date params on DELETE**: Return `400` with descriptive error
- **No filters on DELETE**: Require `?all=true` safety check
