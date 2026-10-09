import express from 'express';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, seedDemo } from './db.js';
import { createApp } from './app.js';
import { bedrockAnalyzer } from './analyze.js';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(`${root}/data`, { recursive: true });
const db = openDb(process.env.DB_PATH || `${root}/data/ripplewise.db`);
seedDemo(db);

const analyzer = bedrockAnalyzer();
const app = createApp({ db, analyzer });

if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: `${root}/vite.config.js`, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(`${root}/dist`));
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`RippleWise running at http://localhost:${port}`);
  if (!analyzer.configured) console.warn('AWS Bedrock key not configured — analysis will fail until BEDROCK_API_KEY is set in .env');
});
