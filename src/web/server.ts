#!/usr/bin/env node
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { pagesRouter } from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/public', express.static(path.join(__dirname, 'public')));
  app.use('/api', apiRouter);
  app.use('/', pagesRouter);
  return app;
}

export function startDashboard(port?: number) {
  const p = port || parseInt(process.env.RLM_WEB_PORT || '9876');
  const app = createApp();
  app.listen(p, () => {
    console.log(`🚀 RLM Analyzer Dashboard: http://localhost:${p}`);
  });
}

// Auto-start when run directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  startDashboard();
}
