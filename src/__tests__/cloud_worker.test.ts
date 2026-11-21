// Cloudflare Worker（パスコード認証・D1同期・APIキー非保存・Geminiプロキシ）および同期クライアントのテスト

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import {
  checkCloudAuthStatus,
  clearPasscode,
  fetchCloudStores,
  pushCloudStores,
  savePasscode,
  verifyCloudPasscode,
} from '../services/cloudSyncService';

// D1 のインメモリモック（sync_store テーブルのみ）
function createMockD1() {
  const rows = new Map<
    string,
    { store_key: string; data_json: string; updated_at: number }
  >();
  return {
    rows,
    prepare(query: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[] }> {
          return { results: [...rows.values()] as unknown as T[] };
        },
        async run() {
          if (query.includes('INSERT INTO sync_store')) {
            const [key, json, ts] = bound as [string, string, number];
            rows.set(key, { store_key: key, data_json: json, updated_at: ts });
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: createMockD1(),
    ASSETS: {
      fetch: vi.fn(async () => new Response('<html>app</html>', { status: 200 })),
    },
    GEMINI_API_KEY: 'AIzaServerSideSecretKey123456789',
    APP_PASSCODE: 'test-pass',
    ...overrides,
  };
}

const BASE = 'https://example.workers.dev';

describe('Cloudflare Worker - 認証・D1同期・APIキー保護', () => {
  it('認証ステータスAPIはパスコード要否とサーバー側キー有無だけを返し、キー本体は返さないこと', async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request(`${BASE}/api/auth/status`), env);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      cloudAvailable: true,
      passcodeRequired: true,
      serverHasGeminiKey: true,
    });
    expect(text).not.toContain('AIzaServerSideSecretKey');
    expect(text).not.toContain('test-pass');
  });

  it('パスコード検証：正しければ200、誤りなら401を返すこと', async () => {
    const env = createEnv();
    const ok = await worker.fetch(
      new Request(`${BASE}/api/auth/verify`, {
        method: 'POST',
        body: JSON.stringify({ passcode: 'test-pass' }),
      }),
      env
    );
    expect(ok.status).toBe(200);

    const ng = await worker.fetch(
      new Request(`${BASE}/api/auth/verify`, {
        method: 'POST',
        body: JSON.stringify({ passcode: 'wrong' }),
      }),
      env
    );
    expect(ng.status).toBe(401);
  });

  it('パスコードなし・誤りのパスコードでは同期API・Geminiプロキシに401で拒否されること', async () => {
    const env = createEnv();
    const noHeader = await worker.fetch(new Request(`${BASE}/api/sync`), env);
    expect(noHeader.status).toBe(401);

    const wrongHeader = await worker.fetch(
      new Request(`${BASE}/api/sync`, {
        headers: { 'X-App-Passcode': 'test-pasz' },
      }),
      env
    );
    expect(wrongHeader.status).toBe(401);

    const gemini = await worker.fetch(
      new Request(`${BASE}/api/gemini`, { method: 'POST', body: '{}' }),
      env
    );
    expect(gemini.status).toBe(401);
  });

  it('同期保存時に settings.geminiApiKey を除去し、不正なストアキーは無視して保存すること', async () => {
    const env = createEnv();
    const put = await worker.fetch(
      new Request(`${BASE}/api/sync`, {
        method: 'PUT',
        headers: { 'X-App-Passcode': 'test-pass' },
        body: JSON.stringify({
          stores: {
            settings: { level: 1, geminiApiKey: 'AIzaLeakedKey999' },
            attempts: [{ id: 'a1' }],
            __proto__hack: { evil: true },
            unknownStore: [1, 2, 3],
          },
        }),
      }),
      env
    );
    expect(put.status).toBe(200);

    // D1 に保存された生データにも APIキーが含まれないこと
    const savedSettings = env.DB.rows.get('settings');
    expect(savedSettings?.data_json).not.toContain('AIzaLeakedKey999');
    expect(env.DB.rows.has('unknownStore')).toBe(false);
    expect(env.DB.rows.has('__proto__hack')).toBe(false);

    const get = await worker.fetch(
      new Request(`${BASE}/api/sync`, {
        headers: { 'X-App-Passcode': 'test-pass' },
      }),
      env
    );
    const body = (await get.json()) as {
      stores: { settings: Record<string, unknown>; attempts: unknown[] };
    };
    expect(body.stores.settings.level).toBe(1);
    expect(body.stores.settings.geminiApiKey).toBeUndefined();
    expect(body.stores.attempts).toEqual([{ id: 'a1' }]);
  });

  it('不正な同期ペイロードは400で拒否すること', async () => {
    const env = createEnv();
    const res = await worker.fetch(
      new Request(`${BASE}/api/sync`, {
        method: 'PUT',
        headers: { 'X-App-Passcode': 'test-pass' },
        body: 'not-json',
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('サーバーに GEMINI_API_KEY が未設定ならGeminiプロキシは503を返すこと', async () => {
    const env = createEnv({ GEMINI_API_KEY: undefined });
    const res = await worker.fetch(
      new Request(`${BASE}/api/gemini`, {
        method: 'POST',
        headers: { 'X-App-Passcode': 'test-pass' },
        body: JSON.stringify({ userPrompt: 'hi' }),
      }),
      env
    );
    expect(res.status).toBe(503);
  });

  it('Geminiプロキシはサーバー側キーをヘッダーで送り、URLにもレスポンスにもキーを含めないこと', async () => {
    const env = createEnv();
    const captured: { url: string; key: string | null }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured.push({ url: String(input), key: headers.get('x-goog-api-key') });
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const res = await worker.fetch(
        new Request(`${BASE}/api/gemini`, {
          method: 'POST',
          headers: { 'X-App-Passcode': 'test-pass' },
          body: JSON.stringify({ model: 'gemini-2.5-flash', userPrompt: 'hi' }),
        }),
        env
      );
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      expect(captured[0].key).toBe('AIzaServerSideSecretKey123456789');
      expect(captured[0].url).not.toContain('AIzaServerSideSecretKey');
      expect(text).not.toContain('AIzaServerSideSecretKey');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('/api 以外のパスはPWAの静的アセットとして配信されること', async () => {
    const env = createEnv();
    const res = await worker.fetch(new Request(`${BASE}/`), env);
    expect(env.ASSETS.fetch).toHaveBeenCalled();
    expect(await res.text()).toContain('app');
  });
});

describe('cloudSyncService - 同期クライアント', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPasscode();
  });

  it('サーバーが存在しない環境（GitHub Pages等でHTMLが返る）ではクラウド無効と判定すること', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('<html>404</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    ) as unknown as typeof fetch;
    const status = await checkCloudAuthStatus();
    expect(status.cloudAvailable).toBe(false);
  });

  it('ネットワークエラー時もクラウド無効として落ちずに続行すること', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const status = await checkCloudAuthStatus();
    expect(status.cloudAvailable).toBe(false);
    expect(await pushCloudStores({ attempts: [] })).toBe(false);
    expect((await fetchCloudStores()).ok).toBe(false);
  });

  it('パスコード検証成功時に端末へ保存し、以後の同期リクエストへヘッダー付与すること', async () => {
    const calls: { url: string; passcode: string | null }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), passcode: headers.get('X-App-Passcode') });
      if (String(input).includes('/api/auth/verify')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ stores: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await verifyCloudPasscode('  my-pass  ')).toBe(true);
    await fetchCloudStores();
    const syncCall = calls.find((c) => c.url.includes('/api/sync'));
    expect(syncCall?.passcode).toBe('my-pass');
  });

  it('401応答を unauthorized として識別すること', async () => {
    savePasscode('expired');
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 401 })
    ) as unknown as typeof fetch;
    const res = await fetchCloudStores();
    expect(res.ok).toBe(false);
    expect(res.unauthorized).toBe(true);
  });
});
