import { Provider, PublicProvider, Session, DiscussionResult, DiscussionRequest } from '@chat-group/shared';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function normalizeSession(row: any): Session {
  return {
    id: row.id,
    title: row.title || '未命名',
    createdAt: row.createdAt ?? row.created_at ?? 0,
    updatedAt: row.updatedAt ?? row.updated_at ?? 0,
  };
}

export type StreamEvent = {
  type: string;
  content?: string;
  turn?: DiscussionResult['turns'][0];
  message?: string;
};

async function consumeSseStream(
  res: Response,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: (body as any).error || `HTTP ${res.status}` });
    return;
  }
  if (!res.body) {
    onEvent({ type: 'error', message: '服务器没有返回响应流' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = chunk.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data) as StreamEvent;
          onEvent(event);
          if (event.type === 'done') completed = true;
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  }

  if (!completed) onEvent({ type: 'error', message: '响应流意外结束' });
}

function startSseStream(
  url: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void
): () => void {
  const controller = new AbortController();
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => consumeSseStream(res, onEvent))
    .catch((e) => {
      if (e?.name === 'AbortError') return;
      onEvent({ type: 'error', message: e.message || '网络请求失败' });
    })
    .finally(() => {
      if (!controller.signal.aborted) onEvent({ type: 'settled' });
    });
  return () => controller.abort();
}

export const api = {
  // Providers
  listProviders: () => request<PublicProvider[]>('/api/providers'),
  createProvider: (data: { name: string; baseUrl: string; apiKey: string; models?: string[] }) =>
    request<PublicProvider>('/api/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id: string, data: Partial<Provider> & { apiKey?: string }) =>
    request<PublicProvider>(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (id: string) => request<{ success: boolean }>(`/api/providers/${id}`, { method: 'DELETE' }),
  fetchProviderModels: (id: string) => request<{ models: string[] }>(`/api/providers/${id}/models`, { method: 'POST' }),

  // Chat
  createChatSession: () => request<{ id: string }>('/api/chat/sessions', { method: 'POST' }),
  listChatSessions: async () => (await request<any[]>('/api/chat/sessions')).map(normalizeSession),
  getChatSession: (id: string) => request<{ session: Session; messages: any[] }>(`/api/chat/sessions/${id}`),
  deleteChatSession: (id: string) => request<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),
  renameChatSession: (id: string, title: string) =>
    request<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),

  // Discussion
  createDiscussionSession: () => request<{ id: string }>('/api/discussion/sessions', { method: 'POST' }),
  listDiscussionSessions: async () => (await request<any[]>('/api/discussion/sessions')).map(normalizeSession),
  getDiscussionSession: async (id: string) => {
    const data = await request<{ session: any; messages: any[] }>(`/api/discussion/sessions/${id}`);
    return { session: normalizeSession(data.session), messages: data.messages };
  },
  deleteDiscussionSession: (id: string) =>
    request<{ success: boolean }>(`/api/discussion/sessions/${id}`, { method: 'DELETE' }),
  renameDiscussionSession: (id: string, title: string) =>
    request<{ success: boolean }>(`/api/discussion/sessions/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
};


export function streamChat(
  sessionId: string,
  body: {
    providerId: string;
    model: string;
    message: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  },
  onEvent: (event: StreamEvent) => void
): () => void {
  return startSseStream(`/api/chat/${sessionId}`, body, onEvent);
}

export function streamDiscussion(
  sessionId: string,
  body: DiscussionRequest,
  onEvent: (event: StreamEvent) => void
): () => void {
  return startSseStream(`/api/discussion/${sessionId}`, body, onEvent);
}
