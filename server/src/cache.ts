export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>();
  constructor(private ttlMs: number, private max = 500) {}
  get(key: string, now = Date.now()): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) { this.store.delete(key); return undefined; }
    return hit.value;
  }
  set(key: string, value: T, now = Date.now()) {
    if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value as string);
    this.store.set(key, { at: now, value });
  }
  clear() { this.store.clear(); }
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}
