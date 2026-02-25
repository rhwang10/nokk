import { describe, it, expect, vi } from 'vitest';
import { TmuxControlMode } from '../src/tmux/control-mode';

describe('TmuxControlMode', () => {
  it('should be instantiable', () => {
    const tm = new TmuxControlMode();
    expect(tm).toBeInstanceOf(TmuxControlMode);
  });

  it('should expose the expected interface', () => {
    const tm = new TmuxControlMode();
    expect(typeof tm.start).toBe('function');
    expect(typeof tm.sendCommand).toBe('function');
    expect(typeof tm.listSessions).toBe('function');
    expect(typeof tm.capturePane).toBe('function');
    expect(typeof tm.sendKeys).toBe('function');
    expect(typeof tm.resizePane).toBe('function');
    expect(typeof tm.destroy).toBe('function');
    expect(typeof tm.handleData).toBe('function');
  });
});
