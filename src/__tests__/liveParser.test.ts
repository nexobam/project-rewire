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
  });
});
