// 4人のAI社員（2ステップAPIパイプライン）・AIコーチ質問チャット・指数バックオフ・ローカルモック代替サービス（要件5・要件6-11・要件8-3）

import {
  buildDuplicateForbidList,
  filterValidAiQuestions,
} from '../domain/aiValidator';
import { getStudyDate } from '../domain/studyDate';
import {
  ICON_WHITELIST,
  type AiReport,
  type Attempt,
  type Chunk,
  type Settings,
} from '../types';
import {
  fetchGeminiViaCloudProxy,
  getCachedCloudStatus,
} from './cloudSyncService';
import { maskSensitiveText, secureLogger } from './logger';

// Gemini Call 1 (temperature 0.7) 用 JSON Schema
export const GEMINI_STEP1_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    analyst: {
      type: 'OBJECT',
      properties: {
        bottleneck: { type: 'STRING' },
        growth: { type: 'STRING' },
      },
      required: ['bottleneck', 'growth'],
    },
    teacher: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          coreImage: { type: 'STRING' },
          pronunciation: { type: 'STRING' },
          praise: { type: 'STRING' },
        },
        required: ['coreImage', 'pronunciation', 'praise'],
      },
    },
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          contentCategory: { type: 'STRING', enum: ['daily', 'heat'] },
          sceneCategory: { type: 'STRING' },
          grammarPattern: { type: 'STRING' },
          enText: { type: 'STRING' },
          blocks: { type: 'ARRAY', items: { type: 'STRING' } },
          acceptableOrders: {
            type: 'ARRAY',
            items: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          icons: { type: 'ARRAY', items: { type: 'STRING' } },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          coreImageJa: { type: 'STRING' },
          pronunciationTip: { type: 'STRING' },
          hasSoundChange: { type: 'BOOLEAN' },
        },
        required: [
          'contentCategory',
          'sceneCategory',
          'grammarPattern',
          'enText',
          'blocks',
          'acceptableOrders',
          'icons',
          'tags',
          'coreImageJa',
          'pronunciationTip',
          'hasSoundChange',
        ],
      },
    },
  },
  required: ['analyst', 'teacher', 'questions'],
};

// Gemini Call 2 (temperature 0.2) 品質チェッカー用 JSON Schema
export const GEMINI_STEP2_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    analyst: GEMINI_STEP1_RESPONSE_SCHEMA.properties.analyst,
    teacher: GEMINI_STEP1_RESPONSE_SCHEMA.properties.teacher,
    questions: GEMINI_STEP1_RESPONSE_SCHEMA.properties.questions,
  },
  required: ['analyst', 'teacher', 'questions'],
};

/**
 * 1日あたりのAPI呼び出し上限に達しているか判定する
 */
export function canMakeApiCallToday(
  settings: Settings,
  callsNeeded: number = 2,
  now: Date = new Date()
): boolean {
  const today = getStudyDate(now);
  const usedToday =
    settings.apiCallDate === today ? (settings.apiCallCount ?? 0) : 0;
  return usedToday + callsNeeded <= settings.dailyApiCallLimit;
}

/**
 * セッション結果からミス種別カウントとローカルモックレポート＆モック新規問題を生成する
 * （APIキー未設定、オフライン、429エラー、上限到達時の確実なフォールバック）
 */
export function generateLocalMockPipelineOutput(params: {
  sessionAttempts: Attempt[];
  existingChunks: Chunk[];
  settings: Settings;
}): {
  analyst: NonNullable<AiReport['analyst']>;
  teacher: NonNullable<AiReport['teacher']>;
  newChunks: Chunk[];
} {
  const { sessionAttempts, existingChunks, settings } = params;

  const soundMisses = sessionAttempts.filter(
    (a) => a.missType === 'sound_change'
  ).length;
  const orderMisses = sessionAttempts.filter(
    (a) => a.missType === 'order_delay'
  ).length;
  const speechMisses = sessionAttempts.filter(
    (a) => a.missType === 'speech_block'
  ).length;
  const greenCount = sessionAttempts.filter((a) => a.rating === 'green').length;
  const total = Math.max(1, sessionAttempts.length);
  const greenPercent = Math.round((greenCount / total) * 100);

  let bottleneck = '語順ブロックの初動1.2秒以内の瞬発出力に伸びしろがあります。';
  if (soundMisses > orderMisses && soundMisses >= speechMisses) {
    bottleneck =
      '連結・脱落する音変化のキャッチが最優先ボトルネックです。文字を忘れ音の塊で捉えましょう。';
  } else if (speechMisses > orderMisses) {
    bottleneck =
      '状況カードから最初の1語を声に出すまでの反射速度がボトルネックです。';
  }

  const analyst = {
    bottleneck: bottleneck.slice(0, 100),
    growth: `今回の緑達成率は${greenPercent}%です。英語の語順のまま前から処理する回路が着実に定着しています。`.slice(
      0,
      100
    ),
  };

  const teacher = [
    {
      coreImage:
        '守護神や主語がまず空間に立ち、そこから動作の矢印が対象へ真っ直ぐ伸びる感覚を掴みましょう。',
      pronunciation:
        '機能語（to / of / a）は弱く短く前の単語の語尾にくっつけて一息で発音します。',
      praise:
        '迷いながらも最後まで翻訳せずに英語の語順で並べ切った集中力が見事です！',
    },
  ];

  const forbidList = buildDuplicateForbidList(existingChunks);
  const rawMockCandidates = [
    {
      contentCategory: 'daily',
      sceneCategory: 'cafe',
      grammarPattern: 'let_me_grab',
      enText: 'Let me grab another cup of coffee.',
      blocks: ['Let', 'me', 'grab', 'another', 'cup', 'of', 'coffee.'],
      acceptableOrders: [
        ['Let', 'me', 'grab', 'another', 'cup', 'of', 'coffee.'],
      ],
      icons: ['Coffee', 'Clock'],
      tags: ['カフェ', '店員', '一息'],
      coreImageJa:
        '【言いたいこと】コーヒーをもう1杯もらおうかな ／ 【英語の語順】Let me grab（サッと手元に取らせて）→ another cup of coffee.（もう1杯のコーヒーを）',
      pronunciationTip: 'Let me はレミ、cup of はカッポヴと一息で連結する。',
      hasSoundChange: true,
    },
    {
      contentCategory: 'daily',
      sceneCategory: 'office',
      grammarPattern: 'keep_you_posted',
      enText: 'I will keep you posted on this.',
      blocks: ['I', 'will', 'keep', 'you', 'posted', 'on', 'this.'],
      acceptableOrders: [
        ['I', 'will', 'keep', 'you', 'posted', 'on', 'this.'],
      ],
      icons: ['Mail', 'Briefcase'],
      tags: ['オフィス', '同僚', '連携'],
      coreImageJa:
        '【言いたいこと】この件は随時アップデート（進捗報告）しますね ／ 【英語の語順】I will keep you posted（あなたを最新情報に触れた状態に保つ）→ on this.（この件に接触させて）',
      pronunciationTip: 'keep you はキーピュ、posted on はポースティドンと繋ぐ。',
      hasSoundChange: true,
    },
    {
      contentCategory: 'heat',
      sceneCategory: 'arena',
      grammarPattern: 'heat_transition',
      enText: 'Miami pushed the pace in transition.',
      blocks: ['Miami', 'pushed', 'the', 'pace', 'in', 'transition.'],
      acceptableOrders: [
        ['Miami', 'pushed', 'the', 'pace', 'in', 'transition.'],
      ],
      icons: ['Flame', 'Zap'],
      tags: ['アリーナ', '仲間', '躍動'],
      coreImageJa:
        '【言いたいこと】マイアミが速攻（トランジション）で一気にペースを上げた ／ 【英語の語順】Miami pushed the pace（マイアミが速度を前へ押し出した）→ in transition.（攻守切替の中で）',
      pronunciationTip: 'pushed the はプッシュザと t を止めて th へ滑らせる。',
      hasSoundChange: true,
    },
    {
      contentCategory: 'daily',
      sceneCategory: 'train',
      grammarPattern: 'head_back_home',
      enText: 'I am heading back home right now.',
      blocks: ['I', 'am', 'heading', 'back', 'home', 'right', 'now.'],
      acceptableOrders: [
        ['I', 'am', 'heading', 'back', 'home', 'right', 'now.'],
      ],
      icons: ['Train', 'Home'],
      tags: ['駅改札', '家族', '安堵'],
      coreImageJa:
        '【言いたいこと】今ちょうど家に向かって帰っているところです ／ 【英語の語順】I am heading back home（頭を家の方へ戻して進んでいる）→ right now.（たった今）',
      pronunciationTip: 'heading back の ng を軽く鼻に抜き、right now の t を止める。',
      hasSoundChange: true,
    },
    {
      contentCategory: 'daily',
      sceneCategory: 'restaurant',
      grammarPattern: 'good_with_that',
      enText: 'I am totally good with that plan.',
      blocks: ['I', 'am', 'totally', 'good', 'with', 'that', 'plan.'],
      acceptableOrders: [
        ['I', 'am', 'totally', 'good', 'with', 'that', 'plan.'],
      ],
      icons: ['ThumbsUp', 'Users'],
      tags: ['ダイナー', '友人', '賛同'],
      coreImageJa:
        '【言いたいこと】そのプランで全く問題ない（大賛成）よ ／ 【英語の語順】I am totally good（私は完全に心地よい・OKだ）→ with that plan.（その計画と一緒にいて）',
      pronunciationTip: 'totally の t はフラップで軽く弾き、good with を密着させる。',
      hasSoundChange: true,
    },
  ];

  const newChunks = filterValidAiQuestions(
    rawMockCandidates,
    forbidList,
    settings.level
  );

  return { analyst, teacher, newChunks };
}

export class RateLimitError extends Error {
  constructor(message: string = 'Rate limit exceeded (429)') {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Gemini API への単一リクエスト実行（APIキーはURLに含めず x-goog-api-key ヘッダーで送信）
 */
async function callGeminiJsonEndpoint(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature: number;
  responseSchema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const {
    apiKey,
    model,
    systemInstruction,
    userPrompt,
    temperature,
    responseSchema,
    fetchImpl = fetch,
  } = params;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const response = !apiKey
    ? await fetchGeminiViaCloudProxy({
        model,
        systemInstruction,
        userPrompt,
        temperature,
        responseSchema,
      })
    : await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      });

  if (response.status === 429) {
    throw new RateLimitError('Gemini API rate limit (429)');
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Gemini API error (${response.status}): ${maskSensitiveText(errText, apiKey)}`
    );
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error('Gemini API returned empty content');
  }
  return JSON.parse(rawJson);
}

/**
 * 2ステップAPIパイプライン（4人のAI社員）を実行する（要件5）
 * - コール1 (temperature 0.7): データアナリスト + コアイメージ先生 + カリキュラム職人
 * - コール2 (temperature 0.2): 独立した品質チェッカー（直訳臭さと不自然な英語を監査・修正）
 * - APIキー未設定、オフライン、上限超過、429エラー時は指数バックオフ／ローカルモックでフォールバック
 */
export async function runFourAiEmployeesPipeline(params: {
  sessionAttempts: Attempt[];
  existingChunks: Chunk[];
  settings: Settings;
  fetchImpl?: typeof fetch;
  backoffBaseMs?: number;
}): Promise<{
  analyst: NonNullable<AiReport['analyst']>;
  teacher: NonNullable<AiReport['teacher']>;
  newChunks: Chunk[];
  usedMock: boolean;
  rateLimited: boolean;
  apiCallsMade: number;
}> {
  const {
    sessionAttempts,
    existingChunks,
    settings,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
    backoffBaseMs = 200,
  } = params;

  const isOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const hasLocalKey = Boolean(settings.geminiApiKey?.trim());
  const useServerProxy =
    !hasLocalKey &&
    !params.fetchImpl &&
    getCachedCloudStatus().serverHasGeminiKey;

  if (
    (!hasLocalKey && !useServerProxy) ||
    isOffline ||
    !fetchImpl ||
    !canMakeApiCallToday(settings, 2)
  ) {
    const mock = generateLocalMockPipelineOutput({
      sessionAttempts,
      existingChunks,
      settings,
    });
    return {
      ...mock,
      usedMock: true,
      rateLimited: false,
      apiCallsMade: 0,
    };
  }

  const forbidList = buildDuplicateForbidList(existingChunks);
  const whitelistStr = ICON_WHITELIST.join(', ');

  const step1SystemPrompt = `あなたは英語脳再配線アプリ「Project Rewire」の3人の専門AI社員（データアナリスト・コアイメージ先生・カリキュラム職人）です。
【絶対ルール】
- 出題中（回答前）に日本語を英訳させることは禁止ですが、回答後の解説（coreImageJa）では何を言っている文なのか100%理解できるよう、必ず「【言いたいこと】自然な場面の意味・ニュアンス ／ 【英語の語順】前から順のチャンク理解と空間コアイメージ」の形式で記述すること。
- 新規問題は5問（日常会話85%：Miami Heat 15%の比率、パターンプラクティスとチャンク・ビルディングを混合）。
- タグは「場所／相手／感情」の名詞3つ（各8文字以内）。動詞やヒント語は禁止。
- アイコンは次のホワイトリストからのみ2つ選択: ${whitelistStr}
- enTextは80文字以内、blocksは3〜9個、acceptableOrdersにはblocks自身の並びを必ず含める。
- 重複禁止リスト: ${forbidList.join(' | ')}`;

  const step1UserPrompt = JSON.stringify({
    level: settings.level,
    attemptsCount: sessionAttempts.length,
    greenCount: sessionAttempts.filter((a) => a.rating === 'green').length,
    soundMisses: sessionAttempts.filter((a) => a.missType === 'sound_change')
      .length,
    orderMisses: sessionAttempts.filter((a) => a.missType === 'order_delay')
      .length,
    speechMisses: sessionAttempts.filter((a) => a.missType === 'speech_block')
      .length,
  });

  try {
    // コール1（temperature 0.7）
    const step1Result = await callGeminiJsonEndpoint({
      apiKey: settings.geminiApiKey ?? '',
      model: settings.geminiModel,
      systemInstruction: step1SystemPrompt,
      userPrompt: step1UserPrompt,
      temperature: 0.7,
      responseSchema: GEMINI_STEP1_RESPONSE_SCHEMA,
      fetchImpl,
    });

    // コール2（temperature 0.2、独立した品質チェッカー）
    const step2SystemPrompt = `あなたは独立した英語・認知言語学の品質チェッカーです。
入力されたJSONについて以下の2点を厳格に監査・修正し、同じJSONスキーマで最終版を納品してください：
1. 日本語解説（coreImageJa）が抽象的で意味不明になっていないか検査し、必ず「【言いたいこと】その場面で伝えたい自然な意味 ／ 【英語の語順】英語の語順のまま前から区切ったチャンク理解とコアイメージ」の形式に整える。タグは8文字以内の名詞（場所・相手・感情）に修正する。
2. 英文（enText, blocks, acceptableOrders）から「ネイティブとして不自然な英語」を排除し、自然で語順が1通りに定まりやすいチャンク（3〜9語、80文字以内）に修正する。`;

    const step2Result = (await callGeminiJsonEndpoint({
      apiKey: settings.geminiApiKey ?? '',
      model: settings.geminiModel,
      systemInstruction: step2SystemPrompt,
      userPrompt: JSON.stringify(step1Result),
      temperature: 0.2,
      responseSchema: GEMINI_STEP2_RESPONSE_SCHEMA,
      fetchImpl,
    })) as {
      analyst?: { bottleneck?: string; growth?: string };
      teacher?: { coreImage?: string; pronunciation?: string; praise?: string }[];
      questions?: unknown[];
    };

    const validChunks = filterValidAiQuestions(
      Array.isArray(step2Result.questions) ? step2Result.questions : [],
      forbidList,
      settings.level
    );

    const mockFallback = generateLocalMockPipelineOutput({
      sessionAttempts,
      existingChunks,
      settings,
    });

    return {
      analyst: {
        bottleneck: (
          step2Result.analyst?.bottleneck || mockFallback.analyst.bottleneck
        ).slice(0, 100),
        growth: (
          step2Result.analyst?.growth || mockFallback.analyst.growth
        ).slice(0, 100),
      },
      teacher:
        Array.isArray(step2Result.teacher) && step2Result.teacher.length > 0
          ? step2Result.teacher.slice(0, 2).map((t) => ({
              coreImage: (t.coreImage || '').slice(0, 100),
              pronunciation: t.pronunciation || '',
              praise: t.praise || '',
            }))
          : mockFallback.teacher,
      newChunks: validChunks.length > 0 ? validChunks : mockFallback.newChunks,
      usedMock: false,
      rateLimited: false,
      apiCallsMade: 2,
    };
  } catch (err) {
    secureLogger.warn(err, settings.geminiApiKey);
    const isRateLimit = err instanceof RateLimitError;
    if (isRateLimit && backoffBaseMs > 0) {
      await new Promise((r) => setTimeout(r, backoffBaseMs));
    }

    const mock = generateLocalMockPipelineOutput({
      sessionAttempts,
      existingChunks,
      settings,
    });
    return {
      ...mock,
      usedMock: true,
      rateLimited: isRateLimit,
      apiCallsMade: 1,
    };
  }
}

/**
 * AIコーチ質問チャットの回答生成（直訳を使わずコアイメージと例文だけで答える・要件4-5）
 */
export async function askAiCoachQuestion(params: {
  question: string;
  settings: Settings;
  fetchImpl?: typeof fetch;
}): Promise<{
  answer: string;
  examples: string[];
  usedMock: boolean;
}> {
  const {
    question,
    settings,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
  } = params;

  const isOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;

  const fallbackResponse = {
    answer:
      'この表現のコアイメージは「中心にある核をそのまま相手の手元へスッと差し出す動き」です。日本語に置き換えず、空間の矢印と口のリズムだけで捉えましょう。',
    examples: [
      'Let me get back to you on that.',
      'That lines up with our plan.',
      'Jimmy took over in the final two minutes.',
    ],
    usedMock: true,
  };

  const hasLocalKey = Boolean(settings.geminiApiKey?.trim());
  const useServerProxy =
    !hasLocalKey &&
    !params.fetchImpl &&
    getCachedCloudStatus().serverHasGeminiKey;

  if (
    (!hasLocalKey && !useServerProxy) ||
    isOffline ||
    !fetchImpl ||
    !canMakeApiCallToday(settings, 1)
  ) {
    return fallbackResponse;
  }

  try {
    const schema = {
      type: 'OBJECT',
      properties: {
        answer: { type: 'STRING' },
        examples: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['answer', 'examples'],
    };

    const res = (await callGeminiJsonEndpoint({
      apiKey: settings.geminiApiKey ?? '',
      model: settings.geminiModel,
      systemInstruction:
        'あなたは英語コーチです。日本語の直訳は一切使わず、「空間・動き・感情のコアイメージ」と「発音のコツ」、および自然な英語の例文3つだけで質問に答えてください。',
      userPrompt: question,
      temperature: 0.4,
      responseSchema: schema,
      fetchImpl,
    })) as { answer?: string; examples?: string[] };

    return {
      answer: res.answer || fallbackResponse.answer,
      examples:
        Array.isArray(res.examples) && res.examples.length > 0
          ? res.examples
          : fallbackResponse.examples,
      usedMock: false,
    };
  } catch (err) {
    secureLogger.warn(err, settings.geminiApiKey);
    return fallbackResponse;
  }
}
