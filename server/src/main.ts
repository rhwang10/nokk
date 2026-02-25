// nokk server entry point: Express + WebSocket

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { TmuxControlMode } from './tmux/control-mode';
import { SessionManager } from './tmux/session-manager';
import { ClientHub } from './ws/client-hub';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '7777', 10);
const TMUX_SESSION = process.env.TMUX_SESSION ?? 'nokk';

async function main() {
  // Initialize tmux control mode
  const controlMode = new TmuxControlMode();
  controlMode.start(TMUX_SESSION);

  // Initialize session manager
  const sessionManager = new SessionManager(controlMode);

  // Wire tmux output events to client broadcast
  const clientHub = new ClientHub(sessionManager);
  controlMode.on('output', (event) => {
    const journal = sessionManager.getJournal(event.paneId);
    if (journal) {
      // The journal already has the entry (SessionManager handles it),
      // broadcast the latest seq to connected clients
      clientHub.broadcastOutput(
        event.paneId,
        journal.getCurrentSeq(),
        Buffer.from(event.data, 'utf-8')
      );
    }
  });

  // Express app
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/sessions', async (_req, res) => {
    const sessions = await sessionManager.listSessions();
    res.json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        currentSeq: s.currentSeq.toString(),
      })),
    });
  });

  // HTTP server + WebSocket
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clientHub.addClient(ws);
  });

  server.listen(PORT, () => {
    logger.info(`nokk server listening on port ${PORT}`);
    logger.info(`tmux session: ${TMUX_SESSION}`);
    logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    controlMode.destroy();
    wss.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
