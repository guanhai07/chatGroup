/**
 * Basic local API smoke checks. Requires server already running.
 * Usage: BASE_URL=http://127.0.0.1:3001 npm test
 */
import { request } from 'undici';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001';

async function smoke() {
  console.log('=== Chat Group Smoke Test ===');
  console.log('Target:', BASE_URL);

  const health = await request(`${BASE_URL}/api/health`);
  if (health.statusCode !== 200) throw new Error(`Health HTTP ${health.statusCode}`);
  console.log('OK Health:', await health.body.json());

  const providersRes = await request(`${BASE_URL}/api/providers`);
  if (providersRes.statusCode !== 200) throw new Error(`Providers HTTP ${providersRes.statusCode}`);
  const providers = (await providersRes.body.json()) as Array<{ name: string }>;
  console.log(`OK Providers: ${providers.length}`);
  console.log('   ', providers.map((p) => p.name).join(', ') || '(none)');

  const chatRes = await request(`${BASE_URL}/api/chat/sessions`, { method: 'POST' });
  if (chatRes.statusCode !== 201 && chatRes.statusCode !== 200) {
    throw new Error(`Chat session HTTP ${chatRes.statusCode}`);
  }
  const chat = (await chatRes.body.json()) as { id: string };
  console.log('OK Chat session created:', chat.id);

  const discussionRes = await request(`${BASE_URL}/api/discussion/sessions`, { method: 'POST' });
  if (discussionRes.statusCode !== 201 && discussionRes.statusCode !== 200) {
    throw new Error(`Discussion session HTTP ${discussionRes.statusCode}`);
  }
  const discussion = (await discussionRes.body.json()) as { id: string };
  console.log('OK Discussion session created:', discussion.id);

  console.log('=== Smoke test complete ===');
}

smoke().catch((err) => {
  console.error('FAIL', err?.message || err);
  process.exit(1);
});
