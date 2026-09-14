export class RingBuffer<T> {
  private readonly values: Array<T | undefined>;
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new Error("Telemetry buffer capacity must be a positive integer");
    this.values = new Array<T | undefined>(capacity);
  }

  get size() {
    return this.count;
  }

  push(value: T) {
    const index = (this.start + this.count) % this.capacity;
    this.values[index] = value;
    if (this.count === this.capacity)
      this.start = (this.start + 1) % this.capacity;
    else this.count++;
  }

  clear() {
    this.values.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  toArray() {
    return Array.from(
      { length: this.count },
      (_, index) => this.values[(this.start + index) % this.capacity]!,
    );
  }
}
