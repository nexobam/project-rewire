// AI講師質問チャット画面（ニュアンス・語順コアイメージ・発音と例文で回答・全レベル対応1タップ質問ボタン・例文音声再生・オフライン保存＆次回再送・要件4-5）

import React, { useMemo, useState } from 'react';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { ALL_SEED_CHUNKS } from '../data/seed';
import { extractSituationMeaning } from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import { playTactileClick } from '../services/audioService';
import { getCachedCloudStatus } from '../services/cloudSyncService';
import { askAiCoachQuestion } from '../services/geminiService';
import { speakEnglishText } from '../services/ttsService';
import type { Attempt, Chunk, CoachMessage, Settings } from '../types';

export interface CoachChatPageProps {
  settings: Settings;
  messages: CoachMessage[];
  palette: ThemePalette;
  onUpsertMessage: (msg: CoachMessage) => Promise<void>;
  onDeleteMessage?: (id: string) => Promise<void>;
  onClearMessages?: () => Promise<void>;
  chunks?: Chunk[];
  attempts?: Attempt[];
  cloudEnabled?: boolean;
  serverHasGeminiKey?: boolean;
}

// Lv.1から全レベルで使える「何を聞けばいいか迷わない」1タップ質問テンプレート
const QUICK_QUESTION_TEMPLATES = [
  '「"Let me get..." と "Can I get..." のニュアンスと使い分けを教えて」',
  '「頭の中で日本語に翻訳せず、英語の語順のまま前から理解するコツは？」',
  '「ネイティブの英語が繋がって速く聴こえるとき、どう聴き取ればいい？」',
  '「発話モードで2秒以内にパッと英語が口から出るようにする練習法は？」',
  '「"gonna" と "about to" の気持ち・場面の違いを教えて」',
];

const ENGLISH_TEMPLATES = [
  'What does "take over" mean in a core image?',
  'How is "gonna" different from "about to" in feeling?',
  'Can I use "sleep on it" in a business meeting?',
  'What is the core spatial image of "pull off"?',
];

export const CoachChatPage: React.FC<CoachChatPageProps> = ({
  settings,
  messages,
  palette,
  onUpsertMessage,
  onDeleteMessage,
  onClearMessages,
  chunks = ALL_SEED_CHUNKS,
  attempts = [],
  cloudEnabled,
  serverHasGeminiKey,
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // タップで回答部分を折りたたむ（非表示にする）ためのメッセージIDセット
  const [collapsedAnswerIds, setCollapsedAnswerIds] = useState<Set<string>>(
    () => new Set()
  );

  const toggleAnswerVisibility = (id: string) => {
    setCollapsedAnswerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const pendingOfflineMessages = messages.filter(
    (m) => m.status === 'pending_offline'
  );

  // 最近間違えた問題や現在レベルの主要フレーズから4件をピックアップして1タップ質問ボタンとして提示
  const suggestedChunks = useMemo(() => {
    const activePool = chunks.length > 0 ? chunks : ALL_SEED_CHUNKS;
    const chunkMap = new Map(activePool.map((c) => [c.id, c]));
    const picked: Chunk[] = [];
    const seenIds = new Set<string>();

    // 1. 直近の赤・黄（苦戦した問題）を優先
    for (let i = attempts.length - 1; i >= 0 && picked.length < 4; i--) {
      const att = attempts[i];
      if (att.rating === 'red' || att.rating === 'yellow') {
        const ch = chunkMap.get(att.chunkId);
        if (ch && !seenIds.has(ch.id)) {
          seenIds.add(ch.id);
          picked.push(ch);
        }
      }
    }

    // 2. 直近に解いた問題
    for (let i = attempts.length - 1; i >= 0 && picked.length < 4; i--) {
      const att = attempts[i];
      const ch = chunkMap.get(att.chunkId);
      if (ch && !seenIds.has(ch.id)) {
        seenIds.add(ch.id);
        picked.push(ch);
      }
    }

    // 3. まだ4件未満なら現在レベルのコア問題から補充
    const targetLevel = Math.max(1, settings.level);
    for (const ch of activePool) {
      if (picked.length >= 4) break;
      if (ch.level === targetLevel && !seenIds.has(ch.id)) {
        seenIds.add(ch.id);
        picked.push(ch);
      }
    }

    return picked;
  }, [attempts, chunks, settings.level]);

  const isAiConnected =
    Boolean(settings.geminiApiKey?.trim()) ||
    Boolean(serverHasGeminiKey) ||
    Boolean(cloudEnabled) ||
    getCachedCloudStatus().serverHasGeminiKey;

  const handleSendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || sending) return;
    playTactileClick(settings.clickSound);
    setInput('');

    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;

    if (isOffline) {
      const offlineMsg: CoachMessage = {
        id: `coach_${Date.now()}`,
        question: trimmed,
        status: 'pending_offline',
        createdAt: Date.now(),
      };
      await onUpsertMessage(offlineMsg);
      return;
    }

    setSending(true);
    try {
      const res = await askAiCoachQuestion({
        question: trimmed,
        settings,
        chunks,
      });
      const answeredMsg: CoachMessage = {
        id: `coach_${Date.now()}`,
        question: trimmed,
        answer: res.answer,
        examples: res.examples,
        status: 'answered',
        createdAt: Date.now(),
      };
      await onUpsertMessage(answeredMsg);
    } finally {
      setSending(false);
    }
  };

  const handleResendOfflineMessage = async (msg: CoachMessage) => {
    if (sending) return;
    playTactileClick(settings.clickSound);
    setSending(true);
    try {
      const res = await askAiCoachQuestion({
        question: msg.question,
        settings,
        chunks,
      });
      await onUpsertMessage({
        ...msg,
        answer: res.answer,
        examples: res.examples,
        status: 'answered',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg">
            <MessageSquare size={20} strokeWidth={1.75} color="currentColor" />
            <span>専属AI講師に質問チャット（語順イメージ・発音・使い分け解説）</span>
          </div>
          <span
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
              color: isAiConnected
                ? (palette.greenText ?? palette.text)
                : palette.text,
            }}
            className="text-xs font-bold px-2.5 py-1 rounded border flex items-center gap-1.5"
            data-testid="ai-coach-connection-badge"
          >
            <CheckCircle size={13} strokeWidth={1.75} color="currentColor" />
            <span>
              {isAiConnected
                ? 'AI講師オンライン接続中（Gemini AI 連携済み）'
                : 'AI講師スマート解説モード'}
            </span>
          </span>
        </div>

        <p className="text-xs opacity-85">
          「このフレーズはどういう気持ち・場面で使うの？」「どうすれば英語の語順のまま理解できる？」「どう発音するとネイティブっぽくなる？」など、下のボタンを1タップするか自由に入力してAI講師に質問できます。
        </p>

        {/* オフライン保存された未送信質問がある場合の再送確認バー（要件4-5） */}
        {pendingOfflineMessages.length > 0 && (
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.amberText ?? palette.border,
            }}
            className="p-3.5 rounded-lg border space-y-2 text-xs"
            data-testid="offline-pending-questions"
          >
            <p className="font-bold">
              オフライン時に保存された未送信の質問が {pendingOfflineMessages.length}{' '}
              件あります。再送しますか？
            </p>
            <div className="space-y-2">
              {pendingOfflineMessages.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate font-medium">{m.question}</span>
                  <button
                    type="button"
                    onClick={() => handleResendOfflineMessage(m)}
                    style={{
                      borderColor: palette.border,
                      borderBottomWidth: '2px',
                    }}
                    className="flex items-center gap-1 px-3 py-1 rounded border font-bold shrink-0"
                    data-testid={`resend-question-${m.id}`}
                  >
                    <RefreshCw
                      size={13}
                      strokeWidth={1.75}
                      color="currentColor"
                    />
                    <span>再送する</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 1. 学習中のフレーズから1タップでAI講師に質問する */}
        <div
          style={{
            backgroundColor: palette.background,
            borderColor: palette.border,
          }}
          className="p-4 rounded-lg border space-y-2.5"
          data-testid="chunk-quick-ask-section"
        >
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <Sparkles size={14} strokeWidth={1.75} color="currentColor" />
            <span>
              学習中のフレーズから1タップでAI講師に詳しく聞く（タップするとすぐ質問します）
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {suggestedChunks.map((ch) => {
              const meaning = extractSituationMeaning(ch);
              const qText = `"${ch.enText}"（${meaning}）はどういう場面・ニュアンスで使い、英語の語順のままどう捉え、どう発音すればいいですか？`;
              return (
                <button
                  key={ch.id}
                  type="button"
                  disabled={sending}
                  onClick={() => void handleSendQuestion(qText)}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                    borderBottomWidth: '2px',
                  }}
                  className="p-2.5 rounded-lg border text-left text-xs space-y-0.5 tactile-btn disabled:opacity-40"
                  data-testid={`quick-ask-chunk-${ch.id}`}
                >
                  <p className="font-bold text-sm">{ch.enText}</p>
                  <p className="opacity-80">
                    「{meaning}」の語順・発音・使い方を聞く →
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. よくある疑問テンプレート（全レベルで常時表示・1タップで即質問） */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold opacity-85">
            <HelpCircle size={14} strokeWidth={1.75} color="currentColor" />
            <span>
              何を聞けばいいか迷ったらこちら（タップするとAI講師がすぐ回答します）：
            </span>
          </div>
          <div
            className="flex flex-wrap gap-2"
            data-testid="quick-question-templates"
          >
            {QUICK_QUESTION_TEMPLATES.map((tpl, idx) => (
              <button
                key={idx}
                type="button"
                disabled={sending}
                onClick={() => void handleSendQuestion(tpl)}
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                  borderBottomWidth: '2px',
                }}
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold tactile-btn text-left disabled:opacity-40"
                data-testid={`quick-template-${idx}`}
              >
                {tpl}
              </button>
            ))}
          </div>
        </div>

        {/* Lv.2以降は英語での質問テンプレートボタンも併せて表示（要件3, 4-5） */}
        {settings.level >= 2 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold opacity-75">
              英語でAI講師に質問するテンプレート（Lv.2以降・タップで入力欄にセット）：
            </p>
            <div
              className="flex flex-wrap gap-2"
              data-testid="english-question-templates"
            >
              {ENGLISH_TEMPLATES.map((tpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInput(tpl)}
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  }}
                  className="px-2.5 py-1.5 rounded border text-xs font-medium tactile-btn"
                >
                  {tpl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 自由質問入力フォーム */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendQuestion(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例：「take it easy は仕事相手にも使える？」「on my way の発音のコツは？」など自由に入力..."
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
              color: palette.text,
            }}
            className="flex-1 min-h-[48px] px-3.5 py-2 rounded-lg border text-sm"
            data-testid="coach-question-input"
          />
          <button
            type="submit"
            disabled={sending || input.trim().length === 0}
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="min-h-[48px] px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 tactile-block disabled:opacity-40"
            data-testid="coach-send-button"
          >
            <Send size={15} strokeWidth={1.75} color="currentColor" />
            <span>{sending ? 'AI講師が回答中...' : 'AI講師に聞く'}</span>
          </button>
        </form>

        {/* チャット履歴一覧（タップで回答の開閉・個別削除・全削除に対応・XSS完全防御） */}
        <div
          className="space-y-3 pt-3 border-t"
          style={{ borderColor: palette.border }}
        >
          {messages.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold opacity-80">
                質問履歴（{messages.length}件・回答をタップすると閉じられます）
              </span>
              {onClearMessages && (
                <button
                  type="button"
                  onClick={() => void onClearMessages()}
                  style={{
                    borderColor: palette.border,
                    color: palette.crimsonText ?? palette.text,
                  }}
                  className="px-2.5 py-1 rounded border font-semibold flex items-center gap-1 tactile-btn"
                  data-testid="clear-coach-history-button"
                >
                  <Trash2 size={13} strokeWidth={1.75} color="currentColor" />
                  <span>履歴をすべて消す</span>
                </button>
              )}
            </div>
          )}

          {messages.length === 0 ? (
            <p className="text-xs opacity-70 text-center py-6">
              まだ質問履歴はありません。上のフレーズボタンやテンプレートをタップすると、専属AI講師がすぐに解説します。
            </p>
          ) : (
            [...messages].reverse().map((msg) => {
              const isCollapsed = collapsedAnswerIds.has(msg.id);
              return (
                <div
                  key={msg.id}
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  }}
                  className="p-4 rounded-lg border space-y-2.5 text-xs"
                  data-testid="coach-message-item"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleAnswerVisibility(msg.id)}
                      className="flex-1 text-left font-bold text-sm flex items-start gap-1.5"
                      data-testid={`toggle-coach-answer-${msg.id}`}
                    >
                      {isCollapsed ? (
                        <ChevronDown
                          size={16}
                          strokeWidth={1.75}
                          color="currentColor"
                          className="mt-0.5 shrink-0"
                        />
                      ) : (
                        <ChevronUp
                          size={16}
                          strokeWidth={1.75}
                          color="currentColor"
                          className="mt-0.5 shrink-0"
                        />
                      )}
                      <span>あなたの質問: {msg.question}</span>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] opacity-70">
                        {msg.status === 'pending_offline'
                          ? 'オフライン保存済み'
                          : isCollapsed
                            ? '回答非表示'
                            : '回答済み'}
                      </span>
                      {onDeleteMessage && (
                        <button
                          type="button"
                          onClick={() => void onDeleteMessage(msg.id)}
                          style={{ borderColor: palette.border }}
                          className="p-1.5 rounded border opacity-80 hover:opacity-100 tactile-btn"
                          aria-label="この履歴を削除"
                          data-testid={`delete-coach-message-${msg.id}`}
                        >
                          <Trash2
                            size={13}
                            strokeWidth={1.75}
                            color="currentColor"
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  {!isCollapsed && (msg.answer || (msg.examples && msg.examples.length > 0)) && (
                    <div
                      onClick={() => toggleAnswerVisibility(msg.id)}
                      className="space-y-2.5 cursor-pointer"
                      title="タップで回答を閉じる"
                      data-testid={`coach-answer-body-${msg.id}`}
                    >
                      {msg.answer && (
                        <div className="leading-relaxed whitespace-pre-line text-sm">
                          <strong>AI講師の解説（タップで閉じる）：</strong>
                          <p className="mt-1">{msg.answer}</p>
                        </div>
                      )}
                      {msg.examples && msg.examples.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <p className="font-bold">
                            実践で使える例文（音声再生付き）：
                          </p>
                          <ul className="space-y-1.5">
                            {msg.examples.map((ex, i) => {
                              const englishOnly = ex
                                .split('（')[0]
                                .split('(')[0]
                                .trim();
                              return (
                                <li
                                  key={i}
                                  style={{
                                    backgroundColor: palette.card,
                                    borderColor: palette.border,
                                  }}
                                  className="p-2.5 rounded border flex items-center justify-between gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="font-semibold text-xs">
                                    {ex}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void speakEnglishText({
                                        text: englishOnly,
                                        rate: settings.ttsRate,
                                      });
                                    }}
                                    style={{ borderColor: palette.border }}
                                    className="px-2 py-1 rounded border text-[11px] font-bold flex items-center gap-1 shrink-0 tactile-btn"
                                    aria-label="例文の音声を再生"
                                  >
                                    <Volume2
                                      size={13}
                                      strokeWidth={1.75}
                                      color="currentColor"
                                    />
                                    <span>音声</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
