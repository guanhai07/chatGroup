import { ChatMessage, ChatResponse } from '@chat-group/shared';
import { Provider } from '@chat-group/shared';
import { getDb } from './db.js';
import { nanoid } from 'nanoid';

interface ChatCompletionChunk {
  choices?: {
    delta?: { content?: string };
    message?: { content?: string };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function fetchModels(provider: Provider): Promise<string[]> {
  const url = `${normalizeBaseUrl(provider.baseUrl)}/v1/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`获取模型失败: HTTP ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { data?: { id: string }[] };
  return (data.data || []).map((m) => m.id).sort();
}

export async function createSession(type: 'chat' | 'discussion', config?: unknown): Promise<string> {
  const db = getDb();
  const id = nanoid();
  db.prepare(
    'INSERT INTO sessions (id, title, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, 'New Session', type, config ? JSON.stringify(config) : null, Date.now(), Date.now());
  return id;
}

export async function saveMessage(
  sessionId: string,
  role: 'system' | 'user' | 'assistant',
  content: string,
  opts?: { providerId?: string; model?: string; round?: number; usage?: ChatResponse['usage'] }
): Promise<void> {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (session_id, role, content, provider_id, model, round, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    role,
    content,
    opts?.providerId || null,
    opts?.model || null,
    opts?.round ?? null,
    opts?.usage ? JSON.stringify(opts.usage) : null,
    Date.now()
  );
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

export function getSession(sessionId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
  if (!row) return null;
  return { ...row, config: row.config ? JSON.parse(row.config) : null };
}

export function getSessionMessages(sessionId: string) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as any[];
  return rows.map((r) => ({
    ...r,
    usage: r.usage_json ? JSON.parse(r.usage_json) : null,
  }));
}

export async function chatCompletion(
  provider: Provider,
  model: string,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; stream?: boolean; onDelta?: (delta: string) => void }
): Promise<ChatResponse> {
  const url = `${normalizeBaseUrl(provider.baseUrl)}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: opts?.stream ?? false,
  };
  if (opts?.temperature !== undefined) body.temperature = opts.temperature;
  if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`对话失败: HTTP ${res.status} ${await res.text()}`);
  }

  if (opts?.stream && res.body) {
    let full = '';
    let usage: ChatResponse['usage'] | undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE lines separated by \n\n
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = chunk.split('\n').filter((l) => l.startsWith('data:'));
        for (const line of lines) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data) as ChatCompletionChunk;
            const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
            if (delta) {
              full += delta;
              opts.onDelta?.(delta);
            }
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              };
            }
          } catch {
            // ignore parse errors in stream
          }
        }
      }
    }
    return { providerId: provider.id, model, content: full, usage };
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: any };
  const content = data.choices?.[0]?.message?.content ?? '';
  return {
    providerId: provider.id,
    model,
    content,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}
