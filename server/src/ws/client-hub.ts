// WebSocket hub: dispatches nokk frames by type, manages client subscriptions

import { WebSocket } from 'ws';
import {
  encodeFrame,
  decodeFrame,
  encodeOutputPayload,
  encodeSnapshotPayload,
  decodeResumePayload,
} from '../protocol/frames';
import { NokkMessageType, NokkFrame } from '../protocol/types';
import { SessionManager } from '../tmux/session-manager';
import { JournalEntry } from '../journal/output-journal';
import { logger } from '../utils/logger';

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class ClientHub {
  private clients = new Map<WebSocket, ClientState>();
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Register a new WebSocket client.
   */
  addClient(ws: WebSocket): void {
    const state: ClientState = {
      ws,
      subscriptions: new Set(),
    };
    this.clients.set(ws, state);
    logger.info(`Client connected (${this.clients.size} total)`);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(ws, data);
    });

    ws.on('close', () => {
      this.removeClient(ws);
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error:', err);
      this.removeClient(ws);
    });
  }

  /**
   * Remove a client and clean up subscriptions.
   */
  private removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    logger.info(`Client disconnected (${this.clients.size} total)`);
  }

  /**
   * Handle an incoming binary frame from a client.
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    let frame: NokkFrame;
    try {
      frame = decodeFrame(data);
    } catch (err) {
      logger.warn('Failed to decode frame:', err);
      return;
    }

    switch (frame.type) {
      case NokkMessageType.SUBSCRIBE:
        await this.handleSubscribe(state, frame.sessionId);
        break;
      case NokkMessageType.UNSUBSCRIBE:
        this.handleUnsubscribe(state, frame.sessionId);
        break;
      case NokkMessageType.RESUME:
        await this.handleResume(state, frame.payload);
        break;
      case NokkMessageType.INPUT:
        await this.handleInput(frame.sessionId, frame.payload);
        break;
      case NokkMessageType.RESIZE:
        await this.handleResize(frame.sessionId, frame.payload);
        break;
      case NokkMessageType.PING:
        this.sendFrame(ws, {
          type: NokkMessageType.PONG,
          sessionId: '',
          payload: Buffer.alloc(0),
        });
        break;
      default:
        logger.warn(`Unknown message type: 0x${frame.type.toString(16)}`);
    }
  }

  /**
   * Subscribe client to a session: send snapshot, then live output.
   */
  private async handleSubscribe(
    state: ClientState,
    sessionId: string
  ): Promise<void> {
    state.subscriptions.add(sessionId);
    logger.info(`Client subscribed to ${sessionId}`);

    // Send initial snapshot
    const snapshot = await this.sessionManager.getSnapshot(sessionId);
    const snapshotPayload = encodeSnapshotPayload(
      snapshot.seq,
      snapshot.cols,
      snapshot.rows,
      Buffer.from(snapshot.text, 'utf-8')
    );
    this.sendFrame(state.ws, {
      type: NokkMessageType.SNAPSHOT,
      sessionId,
      payload: snapshotPayload,
    });
  }

  /**
   * Unsubscribe client from a session.
   */
  private handleUnsubscribe(state: ClientState, sessionId: string): void {
    state.subscriptions.delete(sessionId);
    logger.info(`Client unsubscribed from ${sessionId}`);
  }

  /**
   * Handle RESUME: for each session, send incremental or snapshot.
   */
  private async handleResume(
    state: ClientState,
    payload: Buffer
  ): Promise<void> {
    const resume = decodeResumePayload(payload);

    for (const session of resume.sessions) {
      state.subscriptions.add(session.sessionId);

      const data = await this.sessionManager.getResumeData(
        session.sessionId,
        session.lastSeq
      );

      if (data.type === 'incremental') {
        // Send each missed output frame
        for (const entry of data.entries) {
          const outputPayload = encodeOutputPayload(entry.seq, entry.data);
          this.sendFrame(state.ws, {
            type: NokkMessageType.OUTPUT,
            sessionId: session.sessionId,
            payload: outputPayload,
          });
        }
      } else {
        // Send snapshot fallback
        const snapshotPayload = encodeSnapshotPayload(
          data.seq,
          data.cols,
          data.rows,
          Buffer.from(data.text, 'utf-8')
        );
        this.sendFrame(state.ws, {
          type: NokkMessageType.SNAPSHOT,
          sessionId: session.sessionId,
          payload: snapshotPayload,
        });
      }
    }

    logger.info(
      `Client resumed ${resume.sessions.length} session(s)`
    );
  }

  /**
   * Handle input from client → tmux.
   */
  private async handleInput(
    sessionId: string,
    payload: Buffer
  ): Promise<void> {
    await this.sessionManager.sendInput(sessionId, payload.toString('utf-8'));
  }

  /**
   * Handle resize from client.
   */
  private async handleResize(
    sessionId: string,
    payload: Buffer
  ): Promise<void> {
    if (payload.length < 8) return;
    const cols = payload.readUInt32LE(0);
    const rows = payload.readUInt32LE(4);
    await this.sessionManager.resizePane(sessionId, cols, rows);
  }

  /**
   * Send a frame to a client.
   */
  private sendFrame(ws: WebSocket, frame: NokkFrame): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeFrame(frame));
    }
  }

  /**
   * Broadcast an output frame to all clients subscribed to a session.
   */
  broadcastOutput(sessionId: string, seq: bigint, data: Buffer): void {
    const outputPayload = encodeOutputPayload(seq, data);
    const frame = encodeFrame({
      type: NokkMessageType.OUTPUT,
      sessionId,
      payload: outputPayload,
    });

    for (const [, state] of this.clients) {
      if (
        state.subscriptions.has(sessionId) &&
        state.ws.readyState === WebSocket.OPEN
      ) {
        state.ws.send(frame);
      }
    }
  }
}
