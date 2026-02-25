// Per-session ring buffer with sequence numbers for incremental catch-up

export interface JournalEntry {
  seq: bigint;
  data: Buffer;
  byteLength: number;
}

export interface OutputJournalOptions {
  maxEntries?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export class OutputJournal {
  private entries: JournalEntry[] = [];
  private totalBytes = 0;
  private nextSeq = 1n;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: OutputJournalOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /**
   * Append data to the journal, returning the assigned sequence number.
   */
  append(data: Buffer): bigint {
    const seq = this.nextSeq++;
    const entry: JournalEntry = {
      seq,
      data,
      byteLength: data.length,
    };

    this.entries.push(entry);
    this.totalBytes += data.length;
    this.evict();

    return seq;
  }

  /**
   * Get all entries after the given sequence number.
   * Returns null if the requested seq has been evicted (caller should use snapshot).
   */
  getEntriesAfter(seq: bigint): JournalEntry[] | null {
    if (this.entries.length === 0) {
      if (seq < this.nextSeq) {
        return [];
      }
      return [];
    }

    const oldestSeq = this.entries[0].seq;

    // If the requested seq is older than our oldest entry, data has been evicted
    if (seq < oldestSeq - 1n) {
      return null;
    }

    // Find the first entry with seq > requested seq
    const result: JournalEntry[] = [];
    for (const entry of this.entries) {
      if (entry.seq > seq) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Get the current (latest assigned) sequence number.
   * Returns 0n if no entries have been appended.
   */
  getCurrentSeq(): bigint {
    return this.nextSeq - 1n;
  }

  /**
   * Check if a given sequence number is still in the journal.
   */
  hasSeq(seq: bigint): boolean {
    if (this.entries.length === 0) return false;
    return seq >= this.entries[0].seq && seq <= this.entries[this.entries.length - 1].seq;
  }

  /**
   * Get the oldest sequence number still in the journal.
   * Returns null if the journal is empty.
   */
  getOldestSeq(): bigint | null {
    if (this.entries.length === 0) return null;
    return this.entries[0].seq;
  }

  /**
   * Get the number of entries in the journal.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Get total bytes stored.
   */
  get bytes(): number {
    return this.totalBytes;
  }

  private evict(): void {
    // Evict oldest entries when over limits
    while (
      this.entries.length > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const evicted = this.entries.shift();
      if (evicted) {
        this.totalBytes -= evicted.byteLength;
      } else {
        break;
      }
    }
  }
}
