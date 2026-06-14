export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function handle(res: Response) {
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    throw new ApiError(res.status, body);
  }
  return res.json();
}

export const api = {
  get: (url: string) => fetch(url).then(handle),

  post: (url: string, body?: any) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).then(handle),

  put: (url: string, body?: any) =>
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).then(handle),

  del: (url: string) => fetch(url, { method: 'DELETE' }).then(handle),

  form: (method: 'POST' | 'PUT', url: string, form: FormData) =>
    fetch(url, { method, body: form }).then(handle),

  /** POST /api/ask, stream the answer; onMeta reports how much context fit. */
  async ask(
    body: { question: string; tabIds: number[] | null; from?: string; to?: string },
    onChunk: (text: string) => void,
    onMeta?: (meta: { included: number; total: number }) => void
  ) {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let parsed: any = null;
      try { parsed = await res.json(); } catch {}
      throw new ApiError(res.status, parsed);
    }
    const ctx = res.headers.get('X-Dayleaf-Context');
    if (ctx && onMeta) {
      const [included, total] = ctx.split('/').map(Number);
      onMeta({ included, total });
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  },

  /** POST /api/recap. The server streams progress lines, a \f separator, then
   *  the digest. We route each side to its own callback. */
  async recap(
    body: { tabIds: number[] | null; from?: string; to?: string; lens: string },
    onProgress: (text: string) => void,
    onChunk: (text: string) => void
  ) {
    const res = await fetch('/api/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let parsed: any = null;
      try { parsed = await res.json(); } catch {}
      throw new ApiError(res.status, parsed);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      if (!started) {
        const sep = text.indexOf('\f');
        if (sep === -1) { onProgress(text); continue; }
        if (sep > 0) onProgress(text.slice(0, sep));
        text = text.slice(sep + 1);
        started = true;
      }
      if (started && text) onChunk(text);
    }
  },
};
