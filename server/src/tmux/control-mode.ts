// tmux control mode interface
// Spawns `tmux -C` and parses structured control output events

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface TmuxOutputEvent {
  paneId: string;
  data: string;
}

export interface TmuxCommandResponse {
  output: string;
  error: boolean;
}

export class TmuxControlMode extends EventEmitter {
  private process: ChildProcess | null = null;
  private lineBuffer = '';
  private pendingCommands: Array<{
    resolve: (resp: TmuxCommandResponse) => void;
    output: string[];
    error: boolean;
  }> = [];
  private inBlock = false;

  /**
   * Start tmux in control mode, attaching to or creating the given session.
   */
  start(sessionName = 'nokk'): void {
    this.process = spawn('tmux', ['-C', 'new-session', '-A', '-s', sessionName], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      logger.error('tmux stderr:', chunk.toString('utf-8'));
    });

    this.process.on('exit', (code) => {
      logger.info(`tmux control mode exited with code ${code}`);
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      logger.error('tmux process error:', err);
      this.emit('error', err);
    });

    logger.info(`tmux control mode started for session "${sessionName}"`);
  }

  /**
   * Send a tmux command and wait for its response.
   */
  sendCommand(cmd: string): Promise<TmuxCommandResponse> {
    return new Promise((resolve) => {
      if (!this.process?.stdin?.writable) {
        resolve({ output: '', error: true });
        return;
      }
      this.pendingCommands.push({ resolve, output: [], error: false });
      this.process.stdin.write(cmd + '\n');
    });
  }

  /**
   * List tmux sessions.
   */
  async listSessions(): Promise<string[]> {
    const resp = await this.sendCommand('list-sessions -F "#{session_name}"');
    if (resp.error) return [];
    return resp.output
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Capture the contents of a pane.
   */
  async capturePane(target: string): Promise<string> {
    const resp = await this.sendCommand(`capture-pane -t ${target} -p -e`);
    return resp.output;
  }

  /**
   * Send keys to a pane.
   */
  async sendKeys(target: string, keys: string): Promise<void> {
    await this.sendCommand(`send-keys -t ${target} ${JSON.stringify(keys)}`);
  }

  /**
   * Resize a pane.
   */
  async resizePane(target: string, cols: number, rows: number): Promise<void> {
    await this.sendCommand(`resize-window -t ${target} -x ${cols} -y ${rows}`);
  }

  /**
   * Destroy the control mode process.
   */
  destroy(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Parse incoming data from tmux control mode stdout.
   * tmux control mode outputs:
   *   %output %<paneId> <data>
   *   %begin <timestamp> <cmd_num> <flags>
   *   %end <timestamp> <cmd_num> <flags>
   *   %error <timestamp> <cmd_num> <flags>
   *   %session-changed, %window-add, etc.
   */
  handleData(raw: string): void {
    this.lineBuffer += raw;
    const lines = this.lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      this.parseLine(line);
    }
  }

  private parseLine(line: string): void {
    if (line.startsWith('%output ')) {
      this.handleOutputLine(line);
    } else if (line.startsWith('%begin ')) {
      this.inBlock = true;
    } else if (line.startsWith('%end ')) {
      this.inBlock = false;
      this.resolveCurrentCommand(false);
    } else if (line.startsWith('%error ')) {
      this.inBlock = false;
      this.resolveCurrentCommand(true);
    } else if (line.startsWith('%session-changed ')) {
      this.emit('session-changed', line.substring('%session-changed '.length));
    } else if (line.startsWith('%window-add ')) {
      this.emit('window-add', line.substring('%window-add '.length));
    } else if (line.startsWith('%window-close ')) {
      this.emit('window-close', line.substring('%window-close '.length));
    } else if (line.startsWith('%pane-mode-changed ')) {
      this.emit('pane-mode-changed', line.substring('%pane-mode-changed '.length));
    } else if (this.inBlock && this.pendingCommands.length > 0) {
      // Accumulate output for the current command
      this.pendingCommands[0].output.push(line);
    }
  }

  private handleOutputLine(line: string): void {
    // Format: %output %<paneId> <data>
    const match = line.match(/^%output %(\d+) (.*)$/);
    if (match) {
      const event: TmuxOutputEvent = {
        paneId: match[1],
        data: match[2],
      };
      this.emit('output', event);
    }
  }

  private resolveCurrentCommand(error: boolean): void {
    const pending = this.pendingCommands.shift();
    if (pending) {
      pending.resolve({
        output: pending.output.join('\n'),
        error,
      });
    }
  }
}
