import type {
  ApiError,
  CreateVisitorRequest,
  CreateVisitorResponse,
  MarkReadRequest,
  SendMessageRequest,
  SendMessageResponse,
  UpdateVisitorRequest,
  UpdateVisitorResponse,
  VisitorStateResponse,
} from './protocol';

export class HailboxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HailboxApiError';
  }

  /** The stored visitor token is no longer valid (e.g. the visitor was deleted). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

export function socketUrl(apiUrl: string, path: string): string {
  const url = new URL(normalizeApiUrl(apiUrl) + path);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class HailboxApi {
  private readonly base: string;

  constructor(
    apiUrl: string,
    private readonly getToken: () => string | null,
  ) {
    this.base = normalizeApiUrl(apiUrl);
  }

  createVisitor(body: CreateVisitorRequest): Promise<CreateVisitorResponse> {
    return this.request('POST', '/api/v1/visitors', body, false);
  }

  getState(after?: number): Promise<VisitorStateResponse> {
    const query = after === undefined ? '' : `?after=${after}`;
    return this.request('GET', `/api/v1/visitor${query}`);
  }

  updateVisitor(body: UpdateVisitorRequest): Promise<UpdateVisitorResponse> {
    return this.request('PATCH', '/api/v1/visitor', body);
  }

  sendMessage(body: SendMessageRequest): Promise<SendMessageResponse> {
    return this.request('POST', '/api/v1/messages', body);
  }

  markRead(body: MarkReadRequest): Promise<{ ok: true }> {
    return this.request('POST', '/api/v1/read', body);
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = this.getToken();
      if (!token) throw new HailboxApiError('Not signed in', 401);
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as T | ApiError | null;
    if (!res.ok) {
      const message = data && typeof data === 'object' && 'error' in data ? data.error : res.statusText;
      throw new HailboxApiError(message || `Request failed (${res.status})`, res.status);
    }
    return data as T;
  }
}
