// Session manager: wires tmux control mode output into per-pane OutputJournals

import { TmuxControlMode, TmuxOutputEvent } from './control-mode';
import { OutputJournal, JournalEntry } from '../journal/output-journal';
import { logger } from '../utils/logger';

export interface IncrementalResumeData {
  type: 'incremental';
  entries: JournalEntry[];
}

export interface SnapshotResumeData {
  type: 'snapshot';
  seq: bigint;
  cols: number;
  rows: number;
  text: string;
}

export type ResumeData = IncrementalResumeData | SnapshotResumeData;

export interface SessionInfo {
  sessionId: string;
  currentSeq: bigint;
}

export class SessionManager {
  private journals = new Map<string, OutputJournal>();
  private controlMode: TmuxControlMode;
  private defaultCols = 80;
  private defaultRows = 24;

  constructor(controlMode: TmuxControlMode) {
    this.controlMode = controlMode;
    this.controlMode.on('output', (event: TmuxOutputEvent) => {
      this.handleOutput(event);
    });
  }

  /**
   * Handle tmux output events by appending to the appropriate journal.
   */
  private handleOutput(event: TmuxOutputEvent): void {
    const journal = this.getOrCreateJournal(event.paneId);
    const seq = journal.append(Buffer.from(event.data, 'utf-8'));
    logger.debug(`pane ${event.paneId}: output seq=${seq}`);
  }

  /**
   * Get or create a journal for a pane.
   */
  private getOrCreateJournal(paneId: string): OutputJournal {
    let journal = this.journals.get(paneId);
    if (!journal) {
      journal = new OutputJournal();
      this.journals.set(paneId, journal);
    }
    return journal;
  }

  /**
   * Get resume data for a session: incremental if possible, snapshot fallback.
   */
  async getResumeData(sessionId: string, lastSeq: bigint): Promise<ResumeData> {
    const journal = this.journals.get(sessionId);

    if (journal) {
      const entries = journal.getEntriesAfter(lastSeq);
      if (entries !== null) {
        return { type: 'incremental', entries };
      }
    }

    // Fallback to snapshot
    const text = await this.controlMode.capturePane(sessionId);
    const currentSeq = journal?.getCurrentSeq() ?? 0n;

    return {
      type: 'snapshot',
      seq: currentSeq,
      cols: this.defaultCols,
      rows: this.defaultRows,
      text,
    };
  }

  /**
   * Send input to a tmux pane.
   */
  async sendInput(sessionId: string, data: string): Promise<void> {
    await this.controlMode.sendKeys(sessionId, data);
  }

  /**
   * Resize a tmux pane.
   */
  async resizePane(sessionId: string, cols: number, rows: number): Promise<void> {
    this.defaultCols = cols;
    this.defaultRows = rows;
    await this.controlMode.resizePane(sessionId, cols, rows);
  }

  /**
   * List active sessions.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.controlMode.listSessions();
    return sessions.map((name) => ({
      sessionId: name,
      currentSeq: this.journals.get(name)?.getCurrentSeq() ?? 0n,
    }));
  }

  /**
   * Get a snapshot of a pane for initial subscription.
   */
  async getSnapshot(sessionId: string): Promise<{
    seq: bigint;
    cols: number;
    rows: number;
    text: string;
  }> {
    const text = await this.controlMode.capturePane(sessionId);
    const journal = this.getOrCreateJournal(sessionId);
    return {
      seq: journal.getCurrentSeq(),
      cols: this.defaultCols,
      rows: this.defaultRows,
      text,
    };
  }

  /**
   * Get the journal for a session (for subscribing to live output).
   */
  getJournal(sessionId: string): OutputJournal | undefined {
    return this.journals.get(sessionId);
  }
}
