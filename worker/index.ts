// Project Rewire Cloudflare Worker（D1同期・パスコード認証・Gemini APIプロキシ・PWA静的アセット配信）

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch?: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
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

const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
]);

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

// 簡易ブルートフォース対策（Workerインスタンス単位の連続失敗回数制限）
const authFailureMap = new Map<string, { count: number; lockedUntil: number }>();
const AUTH_MAX_FAILURES = 8;
const AUTH_LOCK_MS = 60_000;

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(digest);
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  if (hashA.length !== hashB.length) return false;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    diff |= hashA[i] ^ hashB[i];
  }
  return diff === 0;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.APP_PASSCODE?.trim();
  // Fail-Closed: パスコード未設定時は認証を通さない
  if (!expected) {
    return false;
  }
  const provided = request.headers.get('X-App-Passcode')?.trim() ?? '';
  if (!provided) {
    return false;
  }
  return constantTimeEqual(provided, expected);
}

function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function getProfilePrefix(request: Request, url: URL): string {
  const raw =
    url.searchParams.get('profile') ??
    request.headers.get('X-App-Profile') ??
    '';
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === 'M' || trimmed === 'Y') {
    return `${trimmed}:`;
  }
  return '';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      // 1. 認証ステータス確認
      if (url.pathname === '/api/auth/status' && request.method === 'GET') {
        return jsonResponse({
          cloudAvailable: Boolean(env.APP_PASSCODE?.trim()),
          passcodeRequired: Boolean(env.APP_PASSCODE?.trim()),
          serverHasGeminiKey: Boolean(env.GEMINI_API_KEY?.trim()),
        });
      }

      // 2. パスコード検証（Fail-Closed + ブルートフォース対策）
      if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
        const expected = env.APP_PASSCODE?.trim() ?? '';
        if (!expected) {
          return jsonResponse({ ok: false, error: 'Passcode not configured' }, 503);
        }

        const clientIp = getClientIp(request);
        const now = Date.now();
        const failRecord = authFailureMap.get(clientIp);
        if (failRecord && failRecord.lockedUntil > now) {
          return jsonResponse(
            { ok: false, error: 'Too many attempts. Try again later.' },
            429
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          passcode?: string;
        };
        const provided = typeof body.passcode === 'string' ? body.passcode.trim() : '';
        const ok = provided.length > 0 && (await constantTimeEqual(provided, expected));

        if (ok) {
          authFailureMap.delete(clientIp);
          return jsonResponse({ ok: true }, 200);
        }

        const nextCount = (failRecord?.count ?? 0) + 1;
        authFailureMap.set(clientIp, {
          count: nextCount,
          lockedUntil: nextCount >= AUTH_MAX_FAILURES ? now + AUTH_LOCK_MS : 0,
        });
        return jsonResponse({ ok: false }, 401);
      }

      // 3. 以降の /api/* はパスコード認証必須
      if (url.pathname.startsWith('/api/')) {
        if (!(await isAuthorized(request, env))) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        // D1から全ストアを取得（プロファイル指定時は M: / Y: のプレフィックス付きキーのみ取得）
        if (url.pathname === '/api/sync' && request.method === 'GET') {
          const profilePrefix = getProfilePrefix(request, url);
          const rows = await env.DB.prepare(
            'SELECT store_key, data_json, updated_at FROM sync_store'
          ).all<{ store_key: string; data_json: string; updated_at: number }>();

          const stores: Record<string, unknown> = {};
          let latestUpdatedAt = 0;

          for (const row of rows.results) {
            let logicalKey: string | null = null;
            if (profilePrefix) {
              if (row.store_key.startsWith(profilePrefix)) {
                logicalKey = row.store_key.slice(profilePrefix.length);
              }
            } else {
              logicalKey = row.store_key;
            }

            if (logicalKey && VALID_STORE_KEYS.has(logicalKey)) {
              try {
                const parsed = JSON.parse(row.data_json);
                if (
                  logicalKey === 'settings' &&
                  parsed &&
                  typeof parsed === 'object'
                ) {
                  delete (parsed as Record<string, unknown>).geminiApiKey;
                }
                stores[logicalKey] = parsed;
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

        // D1へストアを保存（トランザクションバッチで原子的にupsert・プロファイル別に分離）
        if (url.pathname === '/api/sync' && request.method === 'PUT') {
          const profilePrefix = getProfilePrefix(request, url);
          const body = (await request.json().catch(() => null)) as {
            stores?: Record<string, unknown>;
          } | null;
          if (!body || !body.stores || typeof body.stores !== 'object' || Array.isArray(body.stores)) {
            return jsonResponse({ error: 'Invalid payload' }, 400);
          }

          const now = Date.now();
          const statements: D1PreparedStatement[] = [];

          for (const [key, value] of Object.entries(body.stores)) {
            if (!VALID_STORE_KEYS.has(key)) continue;
            if (value === undefined) {
              return jsonResponse({ error: `Invalid store value for ${key}` }, 400);
            }
            if (key === 'settings') {
              if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return jsonResponse({ error: 'Invalid settings store' }, 400);
              }
            } else if (!Array.isArray(value)) {
              return jsonResponse({ error: `Store ${key} must be an array` }, 400);
            }

            let safeValue = value;
            if (key === 'settings' && safeValue && typeof safeValue === 'object') {
              const copy = { ...(safeValue as Record<string, unknown>) };
              delete copy.geminiApiKey;
              safeValue = copy;
            }

            const serialized = JSON.stringify(safeValue);
            // D1の2MB行上限を超える前に明示エラー（1.8MB制限）
            if (serialized.length > 1_800_000) {
              return jsonResponse(
                { error: `Store ${key} exceeds size limit` },
                413
              );
            }

            const dbStoreKey = `${profilePrefix}${key}`;
            statements.push(
              env.DB.prepare(
                `INSERT INTO sync_store (store_key, data_json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(store_key) DO UPDATE SET
                   data_json = excluded.data_json,
                   updated_at = excluded.updated_at`
              ).bind(dbStoreKey, serialized, now)
            );
          }

          if (statements.length > 0) {
            if (typeof env.DB.batch === 'function') {
              await env.DB.batch(statements);
            } else {
              for (const stmt of statements) {
                await stmt.run();
              }
            }
          }

          return jsonResponse({ ok: true, updatedAt: now });
        }

        // Gemini API プロキシ（サーバー側Secretの GEMINI_API_KEY を使用・モデル別payload＆自動フォールバック）
        if (url.pathname === '/api/gemini' && request.method === 'POST') {
          const apiKey = env.GEMINI_API_KEY?.trim();
          if (!apiKey) {
            return jsonResponse(
              { error: 'GEMINI_API_KEY is not configured on server' },
              503
            );
          }

          const body = (await request.json().catch(() => null)) as {
            model?: string;
            systemInstruction?: string;
            userPrompt?: string;
            temperature?: number;
            responseSchema?: Record<string, unknown>;
          } | null;

          if (!body || typeof body !== 'object') {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
          }

          const systemInstruction =
            typeof body.systemInstruction === 'string'
              ? body.systemInstruction.slice(0, 20000)
              : '';
          const userPrompt =
            typeof body.userPrompt === 'string'
              ? body.userPrompt.slice(0, 20000)
              : '';
          const rawTemp = typeof body.temperature === 'number' ? body.temperature : 0.7;
          const temperature = Math.max(0, Math.min(2, rawTemp));

          const requestedModel = (body.model || 'gemini-2.5-flash').trim();
          const primaryModel = ALLOWED_GEMINI_MODELS.has(requestedModel)
            ? requestedModel
            : 'gemini-2.5-flash';

          const candidateModels = Array.from(
            new Set([
              primaryModel,
              'gemini-2.5-flash',
              'gemini-flash-latest',
            ])
          ).slice(0, 3);

          let lastStatus = 503;
          let lastErrorPayload: Record<string, unknown> = {
            error: { message: 'Gemini API request timed out or unavailable' },
          };
          const startedAt = Date.now();

          for (const candidateModel of candidateModels) {
            // Worker全体の時間バジェット（24秒）を超えたら打ち切る
            if (Date.now() - startedAt > 24000) {
              lastStatus = 504;
              break;
            }

            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
              candidateModel
            )}:generateContent`;

            // gemini-2.5系のみ thinkingBudget: 0 を付与（gemini-3系では400エラーの原因になるため省略）
            const generationConfig: Record<string, unknown> = {
              temperature,
              responseMimeType: 'application/json',
              ...(body.responseSchema ? { responseSchema: body.responseSchema } : {}),
              ...(candidateModel.startsWith('gemini-2.5')
                ? { thinkingConfig: { thinkingBudget: 0 } }
                : {}),
            };

            const requestPayload = JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text: userPrompt }],
                },
              ],
              generationConfig,
            });

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
              const geminiRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': apiKey,
                },
                body: requestPayload,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              lastStatus = geminiRes.status;
              const rawText = await geminiRes.text();

              if (geminiRes.ok) {
                return new Response(rawText, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store',
                    ...SECURITY_HEADERS,
                  },
                });
              }

              try {
                lastErrorPayload = JSON.parse(rawText) as Record<string, unknown>;
              } catch {
                lastErrorPayload = {
                  error: {
                    message: `Gemini upstream error (${geminiRes.status})`,
                  },
                };
              }

              // 400（パラメータ非互換）・404（モデル廃止）・429（制限）・503（混雑）は次候補へフォールバック
              if (
                geminiRes.status !== 400 &&
                geminiRes.status !== 404 &&
                geminiRes.status !== 429 &&
                geminiRes.status !== 503
              ) {
                break;
              }
            } catch {
              clearTimeout(timeoutId);
              lastStatus = 504;
            }
          }

          return jsonResponse(lastErrorPayload, lastStatus);
        }

        return jsonResponse({ error: 'Not Found' }, 404);
      }

      // 4. フロントエンド静的アセット（PWA dist/）を配信
      const assetRes = await env.ASSETS.fetch(request);
      const nextHeaders = new Headers(assetRes.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        nextHeaders.set(k, v);
      }
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: nextHeaders,
      });
    } catch (err) {
      return jsonResponse(
        {
          error:
            err instanceof Error ? err.message : 'Internal server error',
        },
        500
      );
    }
  },
};
