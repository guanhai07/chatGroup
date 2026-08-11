import { Router } from 'express';
import { getDb } from '../services/db.js';
import { chatCompletion, createSession, saveMessage, getSession, getSessionMessages } from '../services/ai.js';
import { Provider, ChatMessage } from '@chat-group/shared';

export const chatRoutes = Router();

// Create a new chat session
chatRoutes.post('/sessions', async (_req, res) => {
  const id = await createSession('chat');
  res.status(201).json({ id });
});

// Get chat sessions
chatRoutes.get('/sessions', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions WHERE type = ? ORDER BY updated_at DESC').all('chat');
  res.json(rows);
});


// Delete chat session
chatRoutes.delete('/sessions/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ? AND type = ?').run(id, 'chat');
  res.json({ success: true });
});

// Update session title
chatRoutes.put('/sessions/:id', (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const db = getDb();
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND type = ?').run(title, Date.now(), id, 'chat');
  res.json({ success: true });
});

// Get session messages
chatRoutes.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const messages = getSessionMessages(req.params.id);
  res.json({ session, messages });
});

// Send a message (streaming)
chatRoutes.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { providerId, model, message, systemPrompt, temperature, maxTokens } = req.body;

  if (!providerId || !model || !message) {
    return res.status(400).json({ error: 'providerId, model, message are required' });
  }

  const db = getDb();
  const providerRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
  if (!providerRow) return res.status(404).json({ error: 'Provider not found' });
  if (!providerRow.enabled) return res.status(409).json({ error: 'Provider is disabled' });

  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const provider: Provider = {
    id: providerRow.id,
    name: providerRow.name,
    baseUrl: providerRow.base_url,
    apiKey: providerRow.api_key,
    models: JSON.parse(providerRow.models),
    enabled: !!providerRow.enabled,
    createdAt: providerRow.created_at,
    updatedAt: providerRow.updated_at,
  };

  // Save user message
  await saveMessage(sessionId, 'user', message, { providerId, model });
  // Auto-title from first message
  if (session.title === 'New Session') {
    const trimmed = message.trim().replace(/\s+/g, ' ');
    const newTitle = trimmed.slice(0, 18) + (trimmed.length > 18 ? '…' : '');
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(newTitle, Date.now(), sessionId);
  }

  // Build messages
  const existingMessages = getSessionMessages(sessionId);
  const chatMessages: ChatMessage[] = existingMessages.map((m: any) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));
  if (systemPrompt) {
    chatMessages.unshift({ role: 'system', content: systemPrompt });
  }

  // SSE stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let fullContent = '';
    await chatCompletion(provider, model, chatMessages, {
      temperature,
      maxTokens,
      stream: true,
      onDelta: (delta) => {
        fullContent += delta;
        res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      },
    });

    // Save assistant message
    await saveMessage(sessionId, 'assistant', fullContent, { providerId, model });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }

  res.end();
});
