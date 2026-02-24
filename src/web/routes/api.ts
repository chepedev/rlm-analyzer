import { Router, type Request, type Response } from 'express';
import { getDb } from '../../cost-logger.js';

export const apiRouter = Router();

const COLLECTION = 'usage_logs';

// GET /api/health
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/summary?period=day|month&source=
apiRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const period = req.query['period'] === 'month' ? 'month' : 'day';
    const format = period === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const source = req.query['source'] as string | undefined;
    const db = await getDb();
    const col = db.collection(COLLECTION);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceFilter: Record<string, any> = {};
    if (source === 'rlm') sourceFilter = { source: { $in: ['cli', 'mcp'] } };
    else if (source) sourceFilter = { source };
    const matchStage: Record<string, any> = { $match: sourceFilter };
    const results = await col.aggregate([
      matchStage,
      {
        $group: {
          _id: {
            project: '$project',
            period: { $dateToString: { format, date: '$timestamp' } },
          },
          totalCost: { $sum: '$costUsd' },
          totalTokens: { $sum: '$totalTokens' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          project: '$_id.project',
          period: '$_id.period',
          totalCost: 1,
          totalTokens: 1,
          count: 1,
        },
      },
      { $sort: { period: -1, project: 1 } },
    ]).toArray();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/projects?source=
apiRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const source = req.query['source'] as string | undefined;
    const db = await getDb();
    const col = db.collection(COLLECTION);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceFilter: Record<string, any> = {};
    if (source === 'rlm') sourceFilter = { source: { $in: ['cli', 'mcp'] } };
    else if (source) sourceFilter = { source };
    const matchStage: Record<string, any> = { $match: sourceFilter };
    const results = await col.aggregate([
      matchStage,
      {
        $group: {
          _id: '$project',
          totalCost: { $sum: '$costUsd' },
          totalTokens: { $sum: '$totalTokens' },
          count: { $sum: 1 },
          lastUsed: { $max: '$timestamp' },
          sources: { $addToSet: '$source' },
        },
      },
      {
        $project: {
          _id: 0,
          project: '$_id',
          totalCost: 1,
          totalTokens: 1,
          count: 1,
          lastUsed: 1,
          sources: 1,
        },
      },
      { $sort: { lastUsed: -1 } },
    ]).toArray();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/projects/:name?period=day|month&source=
apiRouter.get('/projects/:name', async (req: Request, res: Response) => {
  try {
    const period = req.query['period'] === 'month' ? 'month' : 'day';
    const format = period === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const source = req.query['source'] as string | undefined;
    const db = await getDb();
    const col = db.collection(COLLECTION);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceFilter: Record<string, any> = {};
    if (source === 'rlm') sourceFilter = { source: { $in: ['cli', 'mcp'] } };
    else if (source) sourceFilter = { source };
    const results = await col.aggregate([
      { $match: { project: req.params['name'], ...sourceFilter } },
      {
        $group: {
          _id: { $dateToString: { format, date: '$timestamp' } },
          totalCost: { $sum: '$costUsd' },
          totalTokens: { $sum: '$totalTokens' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          period: '$_id',
          totalCost: 1,
          totalTokens: 1,
          count: 1,
        },
      },
      { $sort: { period: -1 } },
    ]).toArray();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/logs
apiRouter.delete('/logs', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const col = db.collection(COLLECTION);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {};
    if (req.query['project']) {
      filter['project'] = req.query['project'];
    }
    if (req.query['before'] || req.query['after']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tsFilter: Record<string, any> = {};
      if (req.query['before']) tsFilter['$lt'] = new Date(req.query['before'] as string);
      if (req.query['after']) tsFilter['$gt'] = new Date(req.query['after'] as string);
      filter['timestamp'] = tsFilter;
    }
    const result = await col.deleteMany(filter);
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
