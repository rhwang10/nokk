import { describe, it, expect } from 'vitest';
import { OutputJournal } from '../src/journal/output-journal';

describe('OutputJournal', () => {
  it('should assign monotonically increasing seq numbers', () => {
    const journal = new OutputJournal();
    const s1 = journal.append(Buffer.from('a'));
    const s2 = journal.append(Buffer.from('b'));
    const s3 = journal.append(Buffer.from('c'));
    expect(s1).toBe(1n);
    expect(s2).toBe(2n);
    expect(s3).toBe(3n);
  });

  it('should track getCurrentSeq', () => {
    const journal = new OutputJournal();
    expect(journal.getCurrentSeq()).toBe(0n);
    journal.append(Buffer.from('x'));
    expect(journal.getCurrentSeq()).toBe(1n);
    journal.append(Buffer.from('y'));
    expect(journal.getCurrentSeq()).toBe(2n);
  });

  it('should return entries after a given seq (catch-up within range)', () => {
    const journal = new OutputJournal();
    journal.append(Buffer.from('a'));
    journal.append(Buffer.from('b'));
    journal.append(Buffer.from('c'));
    journal.append(Buffer.from('d'));

    const entries = journal.getEntriesAfter(2n);
    expect(entries).not.toBeNull();
    expect(entries!).toHaveLength(2);
    expect(entries![0].seq).toBe(3n);
    expect(entries![0].data.toString()).toBe('c');
    expect(entries![1].seq).toBe(4n);
    expect(entries![1].data.toString()).toBe('d');
  });

  it('should return all entries when catching up from 0', () => {
    const journal = new OutputJournal();
    journal.append(Buffer.from('a'));
    journal.append(Buffer.from('b'));

    const entries = journal.getEntriesAfter(0n);
    expect(entries).not.toBeNull();
    expect(entries!).toHaveLength(2);
  });

  it('should return empty array when already up to date', () => {
    const journal = new OutputJournal();
    journal.append(Buffer.from('a'));
    journal.append(Buffer.from('b'));

    const entries = journal.getEntriesAfter(2n);
    expect(entries).not.toBeNull();
    expect(entries!).toHaveLength(0);
  });

  it('should return null when seq is evicted (out of range)', () => {
    const journal = new OutputJournal({ maxEntries: 3 });
    journal.append(Buffer.from('a')); // seq 1
    journal.append(Buffer.from('b')); // seq 2
    journal.append(Buffer.from('c')); // seq 3
    journal.append(Buffer.from('d')); // seq 4 — evicts seq 1

    // seq 0 is before the oldest (seq 2), should return null
    const entries = journal.getEntriesAfter(0n);
    expect(entries).toBeNull();
  });

  it('should evict by entry count', () => {
    const journal = new OutputJournal({ maxEntries: 2 });
    journal.append(Buffer.from('a'));
    journal.append(Buffer.from('b'));
    journal.append(Buffer.from('c'));

    expect(journal.size).toBe(2);
    expect(journal.getOldestSeq()).toBe(2n);
    expect(journal.hasSeq(1n)).toBe(false);
    expect(journal.hasSeq(2n)).toBe(true);
    expect(journal.hasSeq(3n)).toBe(true);
  });

  it('should evict by byte size', () => {
    const journal = new OutputJournal({ maxBytes: 10 });
    journal.append(Buffer.alloc(5, 'a'));  // 5 bytes, seq 1
    journal.append(Buffer.alloc(5, 'b'));  // 5 bytes, seq 2 — total 10
    journal.append(Buffer.alloc(5, 'c'));  // 5 bytes, seq 3 — over 10, evict seq 1

    expect(journal.size).toBe(2);
    expect(journal.getOldestSeq()).toBe(2n);
  });

  it('should track getOldestSeq', () => {
    const journal = new OutputJournal();
    expect(journal.getOldestSeq()).toBeNull();
    journal.append(Buffer.from('a'));
    expect(journal.getOldestSeq()).toBe(1n);
  });
});
