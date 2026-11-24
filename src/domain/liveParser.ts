// Live実戦モードのプロンプト生成および終了時JSONログ抽出・検証パーサー（会話内容詳細・弱点解説・AI出力揺れ吸収対応）

import type {
  Chunk,
  Level,
  LiveLogSummary,
  LiveWeakItemDetail,
} from '../types';

// weakChunks用文字フィルタ：英字・数字・空白・基本的な記号のみ許可（かつ英数字を1文字以上含む）
const SAFE_ENGLISH_CHUNK_REGEX = /^(?=.*[A-Za-z0-9])[A-Za-z0-9\s.,!?'"-]+$/;

const LIVE_KNOWN_KEYS = [
  'durationMinutes',
  'overallReview',
  'goodPoints',
  'badPoints',
  'fluencyScore',
  'weakChunks',
  'weakItems',
  'topicsDiscussed',
  'conversationHighlights',
  'review',
  'summary',
  'feedback',
  'score',
  'corrections',
  'improvements',
];

function isLikelyLiveLogObject(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const rec = obj as Record<string, unknown>;
  return LIVE_KNOWN_KEYS.some((k) => k in rec);
}

/**
 * テキストからコードフェンス内、または対応が取れた {...} を抽出する
 * 複数の {...} がある場合は、Liveログのキーを含むJSONオブジェクトを優先して返す
 */
export function extractJsonStringFromText(rawText: string): string | null {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const candidates: string[] = [];

  // 1. コードフェンス ```json ... ``` または ``` ... ``` を優先収集
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(rawText)) !== null) {
    const fencedContent = match[1].trim();
    const extracted = extractFirstBalancedBraces(fencedContent);
    if (extracted) {
      candidates.push(extracted);
    }
  }

  // 2. テキスト全体から対応が取れた {...} をすべて探索
  let offset = 0;
  while (offset < rawText.length) {
    const sub = rawText.slice(offset);
    const firstBrace = sub.indexOf('{');
    if (firstBrace === -1) break;
    const candidate = extractFirstBalancedBraces(sub.slice(firstBrace));
    if (!candidate) {
      offset += firstBrace + 1;
      continue;
    }
    candidates.push(candidate);
    offset += firstBrace + 1;
  }

  // Liveログのキーを持つ有効なJSONを最優先で返す
  let firstValidJson: string | null = null;
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (!firstValidJson) {
        firstValidJson = cand;
      }
      if (isLikelyLiveLogObject(parsed)) {
        return cand;
      }
    } catch {
      // ignore invalid candidate
    }
  }

  if (firstValidJson) {
    return firstValidJson;
  }

  return candidates[0] ?? extractFirstBalancedBraces(rawText);
}

/**
 * 文字列リテラル内の波括弧やエスケープを正しく考慮して、最初の対応が取れた {...} を返す
 */
export function extractFirstBalancedBraces(text: string): string | null {
  let startIdx = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') {
        if (depth === 0) {
          startIdx = i;
        }
        depth += 1;
      } else if (ch === '}') {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && startIdx !== -1) {
            return text.slice(startIdx, i + 1);
          }
        }
      }
    }
  }

  return null;
}

export interface ParsedLiveResult {
  summary: LiveLogSummary;
  calendarMinutes: number;
  generatedChunks: Chunk[];
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((s) => s.length > 0);
}

function parseFlexibleFluencyScore(rec: Record<string, unknown>): number {
  const raw =
    rec.fluencyScore ??
    rec.score ??
    rec.fluency ??
    rec.rating ??
    rec.levelScore;

  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return Math.min(5, Math.max(1, Math.round(raw)));
  }
  if (typeof raw === 'string') {
    const m = raw.match(/([1-5](?:\.\d+)?)/);
    if (m) {
      return Math.min(5, Math.max(1, Math.round(Number(m[1]))));
    }
  }
  return 3;
}

function buildCoreImageFromDetail(detail: LiveWeakItemDetail): string {
  const baseCore = detail.coreImageJa?.trim() ?? '';
  const wanted = detail.whatYouWantedToSay?.trim();
  const attempt = detail.yourAttempt?.trim();

  if (baseCore.includes('【言いたいこと】') && baseCore.includes('【英語の語順】')) {
    if (attempt) {
      return `${baseCore} （会話中のあなたの発言: "${attempt}"）`;
    }
    return baseCore;
  }

  const meaningPart = wanted
    ? `${wanted}${attempt ? `（会話中のあなたの発言: "${attempt}"）` : ''}`
    : baseCore || 'Live実戦の会話の中で言いたかった表現';
  const orderPart =
    baseCore && baseCore !== meaningPart
      ? baseCore
      : `${detail.enText} の語順のまま前からチャンクでイメージを並べる`;

  return `【言いたいこと】${meaningPart} ／ 【英語の語順】${orderPart}`;
}

function normalizeSceneTags(tags?: string[]): [string, string, string] {
  const defaults: [string, string, string] = ['Live会話', '会話相手', '実践'];
  if (!Array.isArray(tags) || tags.length === 0) {
    return defaults;
  }
  const cleaned = tags
    .map((t) => (typeof t === 'string' ? t.trim().slice(0, 8) : ''))
    .filter((t) => t.length > 0);
  return [
    cleaned[0] || defaults[0],
    cleaned[1] || defaults[1],
    cleaned[2] || defaults[2],
  ];
}

/**
 * Live実戦ログのテキストをパース・検証し、学習時間・会話詳細と弱点チャンク（語順／発話専用）へ変換する
 * - AIの出力揺れ（overallReview や fluencyScore の欠落・別キー名・weakItems詳細オブジェクト）を柔軟に吸収
 * - weakChunks は最大5件、1件40文字以内、英字・空白・基本的な記号だけを許可
 * - durationMinutes が5〜60ならその値、範囲外なら20分としてカレンダーに加算
 * - 3語以上のものは空白で分割したブロックの語順問題にし、3語未満のものは発話ドリル専用（speakOnly: true）にする
 */
export function parseLiveSessionLog(
  rawText: string,
  currentLevel: Level
): ParsedLiveResult {
  const jsonStr = extractJsonStringFromText(rawText);
  if (!jsonStr) {
    throw new Error(
      '有効なJSONブロックが見つかりませんでした。Finish後に出力されたJSONを貼り付けてください。'
    );
  }

  let parsedObj: unknown;
  try {
    parsedObj = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      'JSONの構文が壊れています。波括弧 { ... } が最後までコピーされているか確認してください。'
    );
  }

  if (!isLikelyLiveLogObject(parsedObj)) {
    throw new Error(
      'JSON内に会話レビュー項目（overallReview / fluencyScore / weakChunks 等）が見つかりませんでした。Finish後に出力されたJSON全体を貼り付けてください。'
    );
  }

  const rec = parsedObj as Record<string, unknown>;

  // 学習時間：5〜60ならその値、範囲外なら20分
  const rawMinutes = Number(rec.durationMinutes ?? rec.minutes ?? 20);
  const calendarMinutes =
    !Number.isNaN(rawMinutes) && rawMinutes >= 5 && rawMinutes <= 60
      ? Math.round(rawMinutes)
      : 20;

  const topicsDiscussed = toStringArray(
    rec.topicsDiscussed ?? rec.topics ?? rec.conversationTopics
  );
  const goodPoints = toStringArray(
    rec.goodPoints ?? rec.strengths ?? rec.good
  );
  const badPoints = toStringArray(
    rec.badPoints ?? rec.improvements ?? rec.areasToImprove ?? rec.weakPoints
  );

  const conversationHighlights =
    typeof rec.conversationHighlights === 'string' &&
    rec.conversationHighlights.trim().length > 0
      ? rec.conversationHighlights.trim()
      : typeof rec.conversationSummary === 'string' &&
          rec.conversationSummary.trim().length > 0
        ? rec.conversationSummary.trim()
        : undefined;

  // overallReview の柔軟な抽出・自動補完（undefined エラーを防止）
  const rawReviewCandidates = [
    rec.overallReview,
    rec.review,
    rec.summary,
    rec.feedback,
    rec.comment,
    conversationHighlights,
  ];
  let overallReview = '';
  for (const cand of rawReviewCandidates) {
    if (typeof cand === 'string' && cand.trim().length > 0) {
      overallReview = cand.trim();
      break;
    }
  }
  if (!overallReview) {
    if (topicsDiscussed.length > 0) {
      overallReview = `話題（${topicsDiscussed.join('・')}）を中心に英会話セッションを実施しました。`;
    } else if (goodPoints.length > 0 || badPoints.length > 0) {
      overallReview = [...goodPoints, ...badPoints].slice(0, 2).join(' ／ ');
    } else {
      overallReview = 'Live英会話セッションを完了しました。';
    }
  }

  const fluencyScore = parseFlexibleFluencyScore(rec);

  // weakItems（詳細オブジェクト配列）および weakChunks（文字列またはオブジェクト配列）の統合抽出
  const detailMap = new Map<string, LiveWeakItemDetail>();
  const orderedChunkTexts: string[] = [];

  const registerCandidate = (detail: LiveWeakItemDetail) => {
    const cleaned = detail.enText.trim().replace(/\s+/g, ' ');
    if (
      cleaned.length === 0 ||
      cleaned.length > 40 ||
      !SAFE_ENGLISH_CHUNK_REGEX.test(cleaned)
    ) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (!detailMap.has(key)) {
      orderedChunkTexts.push(cleaned);
      detailMap.set(key, {
        ...detail,
        enText: cleaned,
      });
    } else {
      const existing = detailMap.get(key)!;
      detailMap.set(key, {
        enText: existing.enText,
        whatYouWantedToSay:
          existing.whatYouWantedToSay || detail.whatYouWantedToSay,
        yourAttempt: existing.yourAttempt || detail.yourAttempt,
        coreImageJa: existing.coreImageJa || detail.coreImageJa,
        pronunciationTip: existing.pronunciationTip || detail.pronunciationTip,
        sceneTags: existing.sceneTags || detail.sceneTags,
      });
    }
  };

  const rawWeakItems = Array.isArray(rec.weakItems)
    ? rec.weakItems
    : Array.isArray(rec.corrections)
      ? rec.corrections
      : [];

  for (const item of rawWeakItems) {
    if (typeof item === 'string') {
      registerCandidate({ enText: item });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const enText =
        typeof obj.enText === 'string'
          ? obj.enText
          : typeof obj.naturalEnglish === 'string'
            ? obj.naturalEnglish
            : typeof obj.chunk === 'string'
              ? obj.chunk
              : typeof obj.expression === 'string'
                ? obj.expression
                : '';
      if (enText) {
        registerCandidate({
          enText,
          whatYouWantedToSay:
            typeof obj.whatYouWantedToSay === 'string'
              ? obj.whatYouWantedToSay
              : typeof obj.intentJa === 'string'
                ? obj.intentJa
                : undefined,
          yourAttempt:
            typeof obj.yourAttempt === 'string'
              ? obj.yourAttempt
              : typeof obj.userSaid === 'string'
                ? obj.userSaid
                : undefined,
          coreImageJa:
            typeof obj.coreImageJa === 'string'
              ? obj.coreImageJa
              : typeof obj.explanation === 'string'
                ? obj.explanation
                : undefined,
          pronunciationTip:
            typeof obj.pronunciationTip === 'string'
              ? obj.pronunciationTip
              : undefined,
          sceneTags: toStringArray(obj.sceneTags ?? obj.tags),
        });
      }
    }
  }

  const rawWeakChunks = Array.isArray(rec.weakChunks) ? rec.weakChunks : [];
  for (const item of rawWeakChunks) {
    if (typeof item === 'string') {
      registerCandidate({ enText: item });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const enText =
        typeof obj.enText === 'string'
          ? obj.enText
          : typeof obj.chunk === 'string'
            ? obj.chunk
            : '';
      if (enText) {
        registerCandidate({
          enText,
          whatYouWantedToSay:
            typeof obj.whatYouWantedToSay === 'string'
              ? obj.whatYouWantedToSay
              : undefined,
          yourAttempt:
            typeof obj.yourAttempt === 'string' ? obj.yourAttempt : undefined,
          coreImageJa:
            typeof obj.coreImageJa === 'string' ? obj.coreImageJa : undefined,
          pronunciationTip:
            typeof obj.pronunciationTip === 'string'
              ? obj.pronunciationTip
              : undefined,
          sceneTags: toStringArray(obj.sceneTags),
        });
      }
    }
  }

  const sanitizedWeakChunks = orderedChunkTexts.slice(0, 5);
  const sanitizedWeakItems: LiveWeakItemDetail[] = sanitizedWeakChunks.map(
    (text) => detailMap.get(text.toLowerCase()) ?? { enText: text }
  );

  const nowIso = new Date().toISOString();
  const generatedChunks: Chunk[] = sanitizedWeakItems.map((detail, idx) => {
    const chunkText = detail.enText;
    const words = chunkText.split(' ').filter((w) => w.length > 0);
    const isSpeakOnly = words.length < 3;
    const blocks = words.map((w, bIdx) => ({
      id: `live_${Date.now()}_${idx}_b${bIdx}`,
      text: w,
    }));

    return {
      id: `live_${Date.now()}_${idx}`,
      level: Math.max(1, currentLevel) as Level,
      contentCategory:
        /heat|butler|adebayo|spoelstra|miami|nba|court|playoff/i.test(chunkText)
          ? 'heat'
          : 'daily',
      sceneCategory: 'live_review',
      grammarPattern: isSpeakOnly ? 'live_short_phrase' : 'live_sentence',
      enText: chunkText,
      blocks,
      acceptableOrders: [words],
      speakOnly: isSpeakOnly,
      visual: {
        icons: ['MessageSquare', 'Zap'],
        tags: normalizeSceneTags(detail.sceneTags),
      },
      coreImageJa:
        detail.coreImageJa || detail.whatYouWantedToSay
          ? buildCoreImageFromDetail(detail)
          : 'Live実戦で詰まった表現。状況と感情をそのまま音に乗せて出す。',
      pronunciationTip:
        detail.pronunciationTip?.trim() ||
        '単語を切らず、ひと息のチャンクとして滑らかに繋げる。',
      hasSoundChange: words.length >= 3,
      source: 'live',
      isCore: false,
      disabled: false,
      createdAt: nowIso,
    };
  });

  const summary: LiveLogSummary = {
    durationMinutes: calendarMinutes,
    overallReview,
    goodPoints,
    badPoints,
    fluencyScore,
    weakChunks: sanitizedWeakChunks,
    ...(topicsDiscussed.length > 0 ? { topicsDiscussed } : {}),
    ...(conversationHighlights ? { conversationHighlights } : {}),
    ...(sanitizedWeakItems.length > 0 ? { weakItems: sanitizedWeakItems } : {}),
  };

  return {
    summary,
    calendarMinutes,
    generatedChunks,
  };
}

/**
 * Live実戦モード開始用のシステムプロンプトを生成する
 */
export function buildLiveSessionPrompt(params: {
  level: Level;
  weakChunks: string[];
  missingGateSummary: string;
}): string {
  const { level, weakChunks, missingGateSummary } = params;
  const speedDesc =
    level <= 1
      ? 'ゆっくり明瞭なテンポ（約120wpm）、短いチャンク中心'
      : level === 2
        ? '自然な日常会話テンポ（約145wpm）、理由や背景の継ぎ足しを促す'
        : level === 3
          ? 'ネイティブ同士のテンポ（約160wpm）、言い換え（パラフレーズ）を引き出す'
          : 'ネイティブ雑談の高速テンポ（約175wpm）、スラングや深い議論を含む';

  const weakList =
    weakChunks.length > 0
      ? weakChunks.slice(0, 5).join(' / ')
      : 'I mean / It feels like / Let me get';

  return `あなたは私の英語会話パートナー（Miami在住の同僚・Miami Heatファン）です。これから20分間の英会話セッション（Lv.${level}）を行います。

【絶対ルール】
1. 会話トピック比率は「日常会話 85% ： Miami Heat（NBA）トーク 15%」で自然に混ぜてください。
2. 話すスピードとレベル感：${speedDesc}
3. 私が言葉に詰まったら、日本語の直訳は絶対に言わず、簡単な英語の言い換えや状況のヒント（助け舟）を出してください。また、会話の中で私が「何を言おうとしてどう詰まったか・どんな不自然な言い回しをしたか」を全て記憶しておいてください。
4. 今日の私の弱点ミッション：「${weakList}」（昇格ゲート課題：${missingGateSummary}）。これらを私が自然に使えるような質問を振ってください。
5. 私が「Finish」と言ったら、会話を終了し、今日実際に話した内容・やり取り・私の発言の改善点を詳しく振り返り、以下のJSON形式のみをコードフェンスで出力してください（私がアプリに貼り付けて復習問題として自動登録します）：

\`\`\`json
{
  "durationMinutes": 20,
  "topicsDiscussed": [
    "今日実際に話したトピック1（具体的に）",
    "今日実際に話したトピック2"
  ],
  "conversationHighlights": "今日の会話でどんなやり取りをして、どの話題で盛り上がり、どの場面で言葉に詰まっていたかの具体的な振り返り（150〜250字）",
  "overallReview": "英語の語順・チャンクのリズム・空間イメージの観点からの総評と次回への改善アドバイス",
  "goodPoints": [
    "会話の中で実際にうまく使えていた英語表現と良かった点1",
    "良かった点2"
  ],
  "badPoints": [
    "会話の中で詰まった場面や不自然だった表現と、どう言えばよかったかの具体策1",
    "具体策2"
  ],
  "fluencyScore": 4,
  "weakChunks": [
    "今日言えなかった・詰まった自然な英語表現1(必ず英語40文字以内)",
    "今日言えなかった・詰まった自然な英語表現2(必ず英語40文字以内)"
  ],
  "weakItems": [
    {
      "enText": "今日言えなかった・詰まった自然な英語表現1(weakChunksと同じ英文・40文字以内)",
      "whatYouWantedToSay": "その場面で私が本当は言いたかったこと（日本語）",
      "yourAttempt": "私が実際に言った英語や詰まった言い方",
      "coreImageJa": "【言いたいこと】場面の自然な意味・ニュアンス ／ 【英語の語順】前から順のチャンク理解とコアイメージ解説",
      "pronunciationTip": "リンキングや脱落など、その表現を1息で言う発音のコツ",
      "sceneTags": ["場所(8字以内)", "相手(8字以内)", "感情(8字以内)"]
    }
  ]
}
\`\`\`

まずは軽い挨拶から英語で話しかけてください！`;
}
