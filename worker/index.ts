// Project Rewire Cloudflare Worker（D1同期・パスコード認証・Gemini APIプロキシ・PWA静的アセット配信）

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  APP_PASSCODE?: string;
}

const VALID_STORE_KEYS = new Set([
  'chunks',
  'reviewStates',
  'attempts',
  'sessions',
  'aiReports',
  'settings',
  'coachMessages',
]);

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.APP_PASSCODE?.trim();
  if (!expected) {
    return true;
  }
  const provided = request.headers.get('X-App-Passcode')?.trim() ?? '';
  if (provided.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. 認証ステータス確認
    if (url.pathname === '/api/auth/status' && request.method === 'GET') {
      return jsonResponse({
        cloudAvailable: true,
        passcodeRequired: Boolean(env.APP_PASSCODE?.trim()),
        serverHasGeminiKey: Boolean(env.GEMINI_API_KEY?.trim()),
      });
    }

    // 2. パスコード検証
    if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        passcode?: string;
      };
      const expected = env.APP_PASSCODE?.trim() ?? '';
      const provided = (body.passcode ?? '').trim();
      const ok = !expected || provided === expected;
      return jsonResponse({ ok }, ok ? 200 : 401);
    }

    // 3. 以降の /api/* はパスコード認証必須
    if (url.pathname.startsWith('/api/')) {
      if (!isAuthorized(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // D1から全ストアを取得
      if (url.pathname === '/api/sync' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT store_key, data_json, updated_at FROM sync_store'
        ).all<{ store_key: string; data_json: string; updated_at: number }>();

        const stores: Record<string, unknown> = {};
        let latestUpdatedAt = 0;

        for (const row of rows.results) {
          if (VALID_STORE_KEYS.has(row.store_key)) {
            try {
              const parsed = JSON.parse(row.data_json);
              if (
                row.store_key === 'settings' &&
                parsed &&
                typeof parsed === 'object'
              ) {
                delete (parsed as Record<string, unknown>).geminiApiKey;
              }
              stores[row.store_key] = parsed;
              if (row.updated_at > latestUpdatedAt) {
                latestUpdatedAt = row.updated_at;
              }
            } catch {
              // 破損データはスキップ
            }
          }
        }

        return jsonResponse({
          stores,
          latestUpdatedAt,
          serverHasGeminiKey: Boolean(env.GEMINI_API_KEY?.trim()),
        });
      }

      // D1へストアを保存（upsert）
      if (url.pathname === '/api/sync' && request.method === 'PUT') {
        const body = (await request.json().catch(() => ({}))) as {
          stores?: Record<string, unknown>;
        };
        if (!body.stores || typeof body.stores !== 'object') {
          return jsonResponse({ error: 'Invalid payload' }, 400);
        }

        const now = Date.now();
        for (const [key, value] of Object.entries(body.stores)) {
          if (!VALID_STORE_KEYS.has(key)) continue;

          let safeValue = value;
          if (key === 'settings' && safeValue && typeof safeValue === 'object') {
            const copy = { ...(safeValue as Record<string, unknown>) };
            delete copy.geminiApiKey;
            safeValue = copy;
          }

          await env.DB.prepare(
            `INSERT INTO sync_store (store_key, data_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(store_key) DO UPDATE SET
               data_json = excluded.data_json,
               updated_at = excluded.updated_at`
          )
            .bind(key, JSON.stringify(safeValue), now)
            .run();
        }

        return jsonResponse({ ok: true, updatedAt: now });
      }

      // Gemini API プロキシ（サーバー側Secretの GEMINI_API_KEY を使用）
      if (url.pathname === '/api/gemini' && request.method === 'POST') {
        const apiKey = env.GEMINI_API_KEY?.trim();
        if (!apiKey) {
          return jsonResponse(
            { error: 'GEMINI_API_KEY is not configured on server' },
            503
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          model?: string;
          systemInstruction?: string;
          userPrompt?: string;
          temperature?: number;
          responseSchema?: Record<string, unknown>;
        };

        const model = body.model || 'gemini-2.5-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent`;

        const geminiRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: body.systemInstruction ?? '' }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: body.userPrompt ?? '' }],
              },
            ],
            generationConfig: {
              temperature: body.temperature ?? 0.7,
              responseMimeType: 'application/json',
              responseSchema: body.responseSchema,
            },
          }),
        });

        const text = await geminiRes.text();
        return new Response(text, {
          status: geminiRes.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    }

    // 4. フロントエンド静的アセット（PWA dist/）を配信
    return env.ASSETS.fetch(request);
  },
};
