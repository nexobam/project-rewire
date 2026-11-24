// Live実戦ログパーサーの単体テスト（雑談混入・コードフェンス・壊れたJSON・6件以上切り詰め・3語境界・時間補正）

import { describe, expect, it } from 'vitest';
import {
  buildLiveSessionPrompt,
  parseLiveSessionLog,
} from '../domain/liveParser';

describe('liveParser - Live実戦ログの抽出と検証', () => {
  it('前後に雑談の文が混ざっていてもコードフェンス内または最初の {...} を抽出できること', () => {
    const textWithChatter = `
Great talking with you today about the Miami Heat!
Here is your review after saying Finish:
\`\`\`json
{
  "durationMinutes": 25,
  "overallReview": "英語の語順のまま迷わず主語と動詞を置けていました。",
  "goodPoints": ["自然なチャンク連結", "Heatの話題での即興力"],
  "badPoints": ["時制の切り替え"],
  "fluencyScore": 4,
  "weakChunks": [
    "let me get back to you",
    "on me"
  ]
}
\`\`\`
See you next time!
`;

    const result = parseLiveSessionLog(textWithChatter, 1);
    expect(result.calendarMinutes).toBe(25);
    expect(result.summary.fluencyScore).toBe(4);
    expect(result.generatedChunks.length).toBe(2);

    // 3語以上は語順問題（speakOnly: false）、3語未満は発話専用（speakOnly: true）
    const fiveWordsChunk = result.generatedChunks[0];
    expect(fiveWordsChunk.enText).toBe('let me get back to you');
    expect(fiveWordsChunk.speakOnly).toBe(false);
    expect(fiveWordsChunk.blocks.length).toBe(6);
    expect(fiveWordsChunk.source).toBe('live');

    const twoWordsChunk = result.generatedChunks[1];
    expect(twoWordsChunk.enText).toBe('on me');
    expect(twoWordsChunk.speakOnly).toBe(true);
  });

  it('コードフェンスなしの生テキストから対応する波括弧を抽出し、weakChunks 6件以上を5件に制限、40文字超・日本語混入を除外、durationMinutes範囲外を20分に補正すること', () => {
    const rawNoFence = `Sure! Here is the summary: {"durationMinutes": 120, "overallReview": "Good rhythm", "goodPoints": [], "badPoints": [], "fluencyScore": 3, "weakChunks": ["one two three", "four five six", "seven eight nine", "ten eleven twelve", "thirteen fourteen", "fifteen sixteen", "this chunk is way too long because it exceeds forty characters easily", "日本語混入チャンク"]} End of chat.`;

    const res = parseLiveSessionLog(rawNoFence, 2);
    // durationMinutes = 120 は 5〜60 の範囲外なので 20分になる
    expect(res.calendarMinutes).toBe(20);
    // 有効な6件のうち最大5件に切り詰められ、40文字超と日本語混入は除外される
    expect(res.summary.weakChunks.length).toBe(5);
    expect(res.generatedChunks.length).toBe(5);
  });

  it('壊れたJSONやJSONが含まれない文字列は明確なエラーで拒否すること', () => {
    expect(() => parseLiveSessionLog('Just plain text without braces', 1)).toThrow();
    expect(() =>
      parseLiveSessionLog('```json\n{"durationMinutes": 20, broken}\n```', 1)
    ).toThrow();
  });

  it('Live開始用プロンプトにレベル・弱点チャンク・Finish時のJSON指示が含まれること', () => {
    const prompt = buildLiveSessionPrompt({
      level: 2,
      weakChunks: ['take it easy', 'figure it out'],
      missingGateSummary: 'リスニング85%未達',
    });
    expect(prompt).toContain('Lv.2');
    expect(prompt).toContain('take it easy');
    expect(prompt).toContain('Finish');
    expect(prompt).toContain('durationMinutes');
    expect(prompt).toContain('topicsDiscussed');
    expect(prompt).toContain('weakItems');
  });

  it('会話内容詳細（topicsDiscussed / conversationHighlights / weakItems）から具体的なコアイメージ解説付きチャンクを生成し、overallReview・fluencyScore欠落時も柔軟に補完できること', () => {
    const richJson = `
\`\`\`json
{
  "durationMinutes": 20,
  "topicsDiscussed": ["週末のカフェ巡り", "仕事のスケジュール調整"],
  "conversationHighlights": "週末に行ったカフェの話題で盛り上がりましたが、予定変更の理由を説明する際に過去形のチャンクに詰まる場面がありました。",
  "goodPoints": ["I mean を使った自然なつなぎ"],
  "badPoints": ["ended up + -ing の形がすぐに出なかった"],
  "weakItems": [
    {
      "enText": "I ended up staying home.",
      "whatYouWantedToSay": "結局家にいることになっちゃった",
      "yourAttempt": "I was stay home finally",
      "coreImageJa": "【言いたいこと】結局家にいることになった ／ 【英語の語順】I ended up（最終的に行き着いた）→ staying home.（家にいる状態に）",
      "pronunciationTip": "ended up はエンディダッと一息で繋ぐ。",
      "sceneTags": ["カフェ", "同僚", "雑談"]
    }
  ]
}
\`\`\`
`;
    const parsed = parseLiveSessionLog(richJson, 2);
    expect(parsed.summary.topicsDiscussed).toEqual([
      '週末のカフェ巡り',
      '仕事のスケジュール調整',
    ]);
    expect(parsed.summary.conversationHighlights).toContain(
      '週末に行ったカフェの話題'
    );
    // overallReview や fluencyScore が省略されていてもエラーにならず補完される
    expect(parsed.summary.overallReview.length).toBeGreaterThan(0);
    expect(parsed.summary.fluencyScore).toBe(3);

    expect(parsed.generatedChunks.length).toBe(1);
    const chunk = parsed.generatedChunks[0];
    expect(chunk.enText).toBe('I ended up staying home.');
    expect(chunk.coreImageJa).toContain('結局家にいることになった');
    expect(chunk.coreImageJa).toContain('I was stay home finally');
    expect(chunk.pronunciationTip).toBe('ended up はエンディダッと一息で繋ぐ。');
    expect(chunk.visual.tags).toEqual(['カフェ', '同僚', '雑談']);
  });
});
