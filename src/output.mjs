import { createHash } from 'node:crypto';

const MARKER_RESERVE = 160;

/** Retain bounded memory while keeping the beginning and end of a command stream. */
export class BoundedOutput {
  constructor({ maxChars = 6_500 } = {}) {
    if (!Number.isInteger(maxChars) || maxChars < 256) throw new Error('maxChars must be an integer of at least 256');
    this.maxChars = maxChars;
    this.totalChars = 0;
    this.full = '';
    this.head = '';
    this.tail = '';
    this.hash = createHash('sha256');
    this.truncated = false;
  }

  append(chunk) {
    const value = String(chunk);
    this.hash.update(value);
    this.totalChars += value.length;
    if (!this.truncated && this.totalChars <= this.maxChars) {
      this.full += value;
      return;
    }
    const available = this.maxChars - MARKER_RESERVE;
    const headLimit = Math.floor(available / 4);
    const tailLimit = available - headLimit;
    if (!this.truncated) {
      this.head = this.full.slice(0, headLimit);
      if (this.head.length < headLimit) this.head += value.slice(0, headLimit - this.head.length);
      this.tail = value.length >= tailLimit ? value.slice(-tailLimit) : `${this.full.slice(-(tailLimit - value.length))}${value}`;
      this.full = '';
      this.truncated = true;
      return;
    }
    this.tail = value.length >= tailLimit ? value.slice(-tailLimit) : `${this.tail.slice(-(tailLimit - value.length))}${value}`;
  }

  render({ maxChars = this.maxChars } = {}) {
    if (!Number.isInteger(maxChars) || maxChars < 256 || maxChars > this.maxChars) {
      throw new Error('Render budget must be between 256 and the capture budget');
    }
    if (!this.truncated && this.totalChars <= maxChars) return this.full;
    const available = maxChars - MARKER_RESERVE;
    const headLimit = Math.floor(available / 4);
    const tailLimit = available - headLimit;
    let head = (this.truncated ? this.head : this.full).slice(0, headLimit);
    let tail = (this.truncated ? this.tail : this.full).slice(-tailLimit);
    // Omit partial boundary lines so a truncated credential cannot escape redaction.
    head = head.slice(0, head.lastIndexOf('\n') + 1);
    const tailBoundary = tail.indexOf('\n');
    tail = tailBoundary < 0 ? '' : tail.slice(tailBoundary + 1);
    const omitted = this.totalChars - head.length - tail.length;
    const digest = this.hash.copy().digest('hex');
    return `${head}\n… [${omitted} chars omitted; stream sha256=${digest}]\n${tail}`;
  }
}
