// 専属AI講師質問チャット画面（最初の説明文＋自由質問入力＋回答エリア・タップで回答を閉じる・履歴削除対応）

import React, { useState } from 'react';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  RefreshCw,
  Send,
  Trash2,
  Volume2,
} from 'lucide-react';
import { ALL_SEED_CHUNKS } from '../data/seed';
import type { ThemePalette } from '../domain/contrast';
import { playTactileClick } from '../services/audioService';
import { getCachedCloudStatus } from '../services/cloudSyncService';
import { askAiCoachQuestion } from '../services/geminiService';
import { speakEnglishText } from '../services/ttsService';
import type { Chunk, CoachMessage, Settings } from '../types';

export interface CoachChatPageProps {
  settings: Settings;
  messages: CoachMessage[];
  palette: ThemePalette;
  onUpsertMessage: (msg: CoachMessage) => Promise<void>;
  onDeleteMessage?: (id: string) => Promise<void>;
  onClearMessages?: () => Promise<void>;
  chunks?: Chunk[];
  cloudEnabled?: boolean;
  serverHasGeminiKey?: boolean;
}

export const CoachChatPage: React.FC<CoachChatPageProps> = ({
  settings,
  messages,
  palette,
  onUpsertMessage,
  onDeleteMessage,
  onClearMessages,
  chunks = ALL_SEED_CHUNKS,
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
            <span>専属AI講師に質問チャット</span>
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
                ? 'AI講師オンライン接続中'
                : 'AI講師スマート解説モード'}
            </span>
          </span>
        </div>

        {/* 最初の説明文 */}
        <p className="text-xs opacity-85" data-testid="coach-intro-description">
          「このフレーズはどういう気持ち・場面で使うの？」「どうすれば英語の語順のまま理解できる？」「どう発音するとネイティブっぽくなる？」など、疑問に思ったことを自由に入力してAI講師に質問できます。
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

        {/* チャット履歴・回答エリア（タップで回答の開閉・個別削除・全削除に対応・XSS完全防御） */}
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
              まだ質問履歴はありません。上の入力欄から気軽にAI講師へ質問してください。
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

                  {!isCollapsed &&
                    (msg.answer || (msg.examples && msg.examples.length > 0)) && (
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
