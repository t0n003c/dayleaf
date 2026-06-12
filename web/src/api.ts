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

  /** POST /api/ask and stream the plain-text answer chunk by chunk. */
  async ask(
    body: { question: string; tabIds: number[] | null; from?: string; to?: string },
    onChunk: (text: string) => void
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
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  },
};
