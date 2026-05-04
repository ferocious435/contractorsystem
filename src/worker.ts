import express from 'express';
import { config } from 'dotenv';

config();

const app = express();
const port = process.env.WORKER_PORT || 3001;

const server = app.listen(port, () => {
  console.log(`🚀 Worker started on port ${port}`);
  console.log('🤖 Waiting for document processing tasks...');
});

server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Kill the process manually.`);
    process.exit(1);
  } else {
    console.error('❌ Worker server error:', e);
    process.exit(1);
  }
});

process.once('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down worker...');
  server.close(() => {
    console.log('✅ Worker stopped successfully.');
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down worker...');
  server.close(() => {
    console.log('✅ Worker stopped successfully.');
    process.exit(0);
  });
});

app.get('/status', (req, res) => {
  res.json({ alive: true, mode: 'worker' });
});
