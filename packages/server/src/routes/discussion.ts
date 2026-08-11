import { Router } from 'express';
import { getDb } from '../services/db.js';
import { chatCompletion, createSession, saveMessage, getSession } from '../services/ai.js';
import { Provider, ChatMessage, DiscussionRequest } from '@chat-group/shared';

export const discussionRoutes = Router();

function rowToProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    models: JSON.parse(row.models),
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Create a discussion session
discussionRoutes.post('/sessions', async (_req, res) => {
  const id = await createSession('discussion');
  res.status(201).json({ id });
});

// Get discussion sessions
discussionRoutes.get('/sessions', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sessions WHERE type = ? ORDER BY updated_at DESC').all('discussion');
  res.json(rows);
});

// Delete discussion session
discussionRoutes.delete('/sessions/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ? AND type = ?').run(id, 'discussion');
  res.json({ success: true });
});

// Rename discussion session
discussionRoutes.put('/sessions/:id', (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const db = getDb();
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND type = ?').run(title, Date.now(), id, 'discussion');
  res.json({ success: true });
});

// Get session messages
discussionRoutes.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(req.params.id) as any[];
  const messages = rows.map((r) => ({
    ...r,
    usage: r.usage_json ? JSON.parse(r.usage_json) : null,
  }));
  res.json({ session, messages });
});

// Run discussion
discussionRoutes.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const body = req.body as DiscussionRequest;
  const { providerModels, rounds, initialPrompt, systemPrompt, maxTokensPerTurn, temperature } = body;

  if (!providerModels?.length || !rounds || !initialPrompt) {
    return res.status(400).json({ error: 'providerModels, rounds, initialPrompt are required' });
  }

  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const db = getDb();
  const providers = new Map<string, Provider>();
  for (const pm of providerModels) {
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(pm.providerId) as any;
    if (row && row.enabled) providers.set(pm.providerId, rowToProvider(row));
  }

  // Build transcript
  const transcript: ChatMessage[] = [];
  if (systemPrompt) {
    transcript.push({ role: 'system', content: systemPrompt });
  }
  transcript.push({ role: 'user', content: initialPrompt });
  await saveMessage(sessionId, 'user', initialPrompt, {});
  // Auto-title from initial prompt
  if (session.title === 'New Session') {
    const trimmed = initialPrompt.trim().replace(/\s+/g, ' ');
    const newTitle = trimmed.slice(0, 18) + (trimmed.length > 18 ? '…' : '');
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(newTitle, Date.now(), sessionId);
  }

  const discussionPrompt = (round: number, speakerLabel: string, prevContent: string) =>
    `You are participating in a multi-model round-table discussion.\n` +
    `Topic/question: ${initialPrompt}\n\n` +
    `So far, the discussion transcript is:\n${prevContent}\n\n` +
    `It is now ${speakerLabel}'s turn (round ${round}). ` +
    `Please respond concisely, building on or challenging the previous points. ` +
    `Stay on topic and do not repeat others.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let fullTranscript = `[${systemPrompt ? 'System: ' + systemPrompt + '\n' : ''}User: ${initialPrompt}]`;

    for (let round = 1; round <= rounds; round++) {
      for (const pm of providerModels) {
        const provider = providers.get(pm.providerId);
        if (!provider) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: `Provider ${pm.providerId} not found` })}\n\n`);
          continue;
        }

        const messages: ChatMessage[] = [
          ...transcript,
          {
            role: 'user',
            content: discussionPrompt(round, `${provider.name}/${pm.model}`, fullTranscript),
          },
        ];

        let content = '';
        try {
          const result = await chatCompletion(provider, pm.model, messages, {
            temperature,
            maxTokens: maxTokensPerTurn,
          });
          content = result.content;
        } catch (e: any) {
          content = `[Error: ${e.message}]`;
          res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
        }

        const turnText = `\n${provider.name}/${pm.model} (round ${round}): ${content}`;
        fullTranscript += turnText;

        // Keep only last N turns to limit context
        await saveMessage(sessionId, 'assistant', content, {
          providerId: pm.providerId,
          model: pm.model,
          round,
        });

        res.write(`data: ${JSON.stringify({ type: 'turn', turn: { round, providerId: pm.providerId, model: pm.model, content } })}\n\n`);
      }
    }

    // Summary
    const summaryPrompt =
      `Please provide a concise summary (in Chinese) of the above multi-model discussion, ` +
      `including key points, agreements, disagreements, and remaining open questions.`;
    const summaryMessages: ChatMessage[] = [
      { role: 'system', content: 'You are a discussion summarizer.' },
      { role: 'user', content: `Discussion transcript:\n${fullTranscript}\n\n${summaryPrompt}` },
    ];

    let summary = '';
    try {
      const first = providerModels[0];
      const firstProvider = providers.get(first.providerId);
      if (!firstProvider) {
        throw new Error(`Provider ${first.providerId} not found`);
      }
      const result = await chatCompletion(firstProvider, first.model, summaryMessages, { temperature: 0.3 });
      summary = result.content;
      await saveMessage(sessionId, 'assistant', summary, {
        providerId: first.providerId,
        model: first.model,
        round: rounds + 1,
        usage: { kind: 'summary' } as any,
      });
    } catch (e: any) {
      summary = `[Summary failed: ${e.message}]`;
    }

    res.write(`data: ${JSON.stringify({ type: 'summary', content: summary })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }

  res.end();
});
