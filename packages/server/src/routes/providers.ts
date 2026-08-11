import { Router } from 'express';
import { getDb } from '../services/db.js';
import { fetchModels } from '../services/ai.js';
import { nanoid } from 'nanoid';
import { Provider, PublicProvider } from '@chat-group/shared';

export const providerRoutes = Router();

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

function toPublicProvider(provider: Provider): PublicProvider {
  const { apiKey: _apiKey, ...publicProvider } = provider;
  return publicProvider;
}

// List all providers
providerRoutes.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM providers ORDER BY created_at ASC').all();
  res.json((rows as any[]).map((row) => toPublicProvider(rowToProvider(row))));
});

// Create provider
providerRoutes.post('/', (req, res) => {
  const { name, baseUrl, apiKey, models } = req.body;
  if (!name || !baseUrl || !apiKey) {
    return res.status(400).json({ error: 'name, baseUrl, apiKey are required' });
  }
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    'INSERT INTO providers (id, name, base_url, api_key, models, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(id, name, baseUrl, apiKey, JSON.stringify(models || []), now, now);
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  res.status(201).json(toPublicProvider(rowToProvider(row)));
});

// Update provider
providerRoutes.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, baseUrl, apiKey, models, enabled } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'Provider not found' });

  const now = Date.now();
  db.prepare(
    `UPDATE providers SET name=?, base_url=?, api_key=?, models=?, enabled=?, updated_at=? WHERE id=?`
  ).run(
    name ?? existing.name,
    baseUrl ?? existing.base_url,
    apiKey ?? existing.api_key,
    models ? JSON.stringify(models) : existing.models,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    now,
    id
  );
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id);
  res.json(toPublicProvider(rowToProvider(row)));
});

// Delete provider
providerRoutes.delete('/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  res.json({ success: true });
});

// Fetch models from provider
providerRoutes.post('/:id/models', async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
  if (!row) return res.status(404).json({ error: 'Provider not found' });

  try {
    const models = await fetchModels(rowToProvider(row));
    // Update stored models
    db.prepare('UPDATE providers SET models=?, updated_at=? WHERE id=?').run(
      JSON.stringify(models), Date.now(), id
    );
    res.json({ models });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});
