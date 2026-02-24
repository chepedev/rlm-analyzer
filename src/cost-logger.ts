/**
 * Cost Logger
 * Manages MongoDB connection and logs LLM usage data for analytics.
 */

import * as path from 'path';
import { MongoClient, type Db, type Collection } from 'mongodb';

const DB_NAME = 'rlm_analyzer';
const COLLECTION_NAME = 'usage_logs';

export interface UsageLog {
  timestamp: Date;
  provider: string;
  model: string;
  analysisType: string;
  project: string;
  directory: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  executionTimeMs: number;
  subCallCount: number;
  source: string;
  success: boolean;
  cacheHit?: boolean;
  changedFilesCount?: number;
}

export type UsageLogInput = Omit<UsageLog, 'timestamp' | 'project'> & {
  project?: string;
};

let client: MongoClient | null = null;
let db: Db | null = null;
let indexesCreated = false;

async function connect(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB_NAME);

  if (!indexesCreated) {
    const col: Collection<UsageLog> = db.collection(COLLECTION_NAME);
    await col.createIndex({ timestamp: -1 });
    await col.createIndex({ project: 1, timestamp: -1 });
    indexesCreated = true;
  }

  return db;
}

export async function getDb(): Promise<Db> {
  return connect();
}

export async function logUsage(data: UsageLogInput): Promise<void> {
  try {
    const database = await connect();
    const col: Collection<UsageLog> = database.collection(COLLECTION_NAME);
    const doc: UsageLog = {
      ...data,
      timestamp: new Date(),
      project: data.project ?? path.basename(data.directory),
    };
    await col.insertOne(doc);
  } catch (err) {
    console.error('[rlm-analyzer] cost-logger: failed to log usage:', err instanceof Error ? err.message : String(err));
  }
}

export async function closeConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    indexesCreated = false;
  }
}
