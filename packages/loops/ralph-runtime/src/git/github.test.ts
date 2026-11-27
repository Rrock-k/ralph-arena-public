import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubClient } from './github.js';

test('waitForDeploy waits through initial not_found before succeeding', async () => {
  const client = new GitHubClient('token', 'https://github.com/example/repo');
  let calls = 0;

  (client as any).getDeployStatus = async () => {
    calls++;
    if (calls === 1) return { status: 'not_found' };
    if (calls === 2) return { status: 'in_progress' };
    return { status: 'success', url: 'https://preview.example', run: { id: 1, status: 'completed', conclusion: 'success', html_url: '' } };
  };
  (client as any).sleep = async () => {};

  const result = await client.waitForDeploy('abcdef123456', 1);

  assert.equal(result.status, 'success');
  assert.equal(calls, 3);
});

test('checkDeployHealth probes preferred path before default fallbacks', async () => {
  const client = new GitHubClient('token', 'https://github.com/example/repo');
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return new Response('', { status: url.endsWith('/healthz') ? 200 : 404 });
  }) as typeof fetch;

  try {
    const ok = await client.checkDeployHealth('https://preview.example', '/healthz');
    assert.equal(ok, true);
    assert.deepEqual(seen, ['https://preview.example/healthz']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
