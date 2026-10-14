const size = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const reference = ref => /^(?:ctx|note)-[a-f0-9]{20}$/.test(ref || '');

/** Cold evidence remains in authenticated storage, not an unbounded RAM map. */
export class ContextArchive {
  constructor(journal, { cacheBytes = 262144, metadataEntries = 128, signal } = {}) {
    this.journal = journal; this.cacheBytes = cacheBytes; this.metadataEntries = metadataEntries;
    this.signal = signal; this.cache = new Map(); this.metadata = new Map(); this.cachedBytes = 0;
    this.start = journal.rows.findLast(row => row.kind === 'conversation_reset')?.seq || 0;
    this.count = journal.rows.filter(row => row.seq > this.start && row.kind === 'context_archive').length;
  }
  peek(ref) { return this.metadata.get(ref); }
  remember(unit) {
    const { output, ...metadata } = unit;
    this.metadata.delete(unit.ref); this.metadata.set(unit.ref, metadata);
    while (this.metadata.size > this.metadataEntries) this.metadata.delete(this.metadata.keys().next().value);
  }
  sweepCache() { this.cache.clear(); this.metadata.clear(); this.cachedBytes = 0; }
  async store(unit) {
    if (!reference(unit.ref) || typeof unit.output !== 'string') throw new Error('Invalid archived evidence');
    const artifact = await this.journal.put({ schema: 1, unit });
    await this.journal.append('context_archive', { schema: 1, ref: unit.ref, artifact });
    this.count++; this.remember(unit);
  }
  async *entries() {
    // Stream payloads one at a time; journal metadata contains no source bodies.
    for (let i = this.journal.rows.length - 1; i >= 0; i--) {
      this.signal?.throwIfAborted();
      const row = this.journal.rows[i];
      if (row.seq <= this.start) break;
      if (row.kind !== 'context_archive') continue;
      const entry = await this.journal.get(row.artifact);
      if (entry.schema !== 1 || !reference(entry.ref) || !/^[a-f0-9]{64}$/.test(entry.artifact || '')) throw new Error('Invalid archive catalog');
      yield { ...entry, seq: row.seq };
    }
  }
  async read(entry) {
    const data = await this.journal.get(entry.artifact), unit = data.unit;
    if (data.schema !== 1 || unit?.ref !== entry.ref || typeof unit.output !== 'string'
      || !['observed', 'inferred'].includes(unit.provenance)) throw new Error('Invalid archived evidence payload');
    this.remember(unit); return unit;
  }
  async get(ref) {
    if (!reference(ref)) return null;
    if (this.cache.has(ref)) {
      const value = this.cache.get(ref); this.cache.delete(ref); this.cache.set(ref, value);
      this.remember(value.unit); return value.unit;
    }
    for await (const entry of this.entries()) if (entry.ref === ref) {
      const unit = await this.read(entry), bytes = size(unit);
      if (bytes <= this.cacheBytes) {
        while (this.cachedBytes + bytes > this.cacheBytes && this.cache.size) {
          const oldest = this.cache.keys().next().value;
          this.cachedBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
        }
        this.cache.set(ref, { unit, bytes }); this.cachedBytes += bytes;
      }
      return unit;
    }
    return null;
  }
}

