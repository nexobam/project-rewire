// AIコーチ質問チャット画面（直訳禁止・コアイメージと例文のみで回答・Lv.2+英語質問テンプレートボタン・オフライン保存＆次回再送確認・要件4-5）

import React, { useState } from 'react';
import { MessageSquare, RefreshCw, Send } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import { playTactileClick } from '../services/audioService';
import { askAiCoachQuestion } from '../services/geminiService';
import type { CoachMessage, Settings } from '../types';

export interface CoachChatPageProps {
  settings: Settings;
  messages: CoachMessage[];
  palette: ThemePalette;
  onUpsertMessage: (msg: CoachMessage) => Promise<void>;
}

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
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const pendingOfflineMessages = messages.filter(
    (m) => m.status === 'pending_offline'
  );

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
        className="border rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 font-bold text-lg">
          <MessageSquare size={20} strokeWidth={1.75} color="currentColor" />
          <span>AIコーチ質問チャット（直訳全面禁止・コアイメージ＆例文解説）</span>
        </div>

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

        {/* Lv.2以降は英語質問テンプレートボタンを解禁（要件3, 4-5） */}
        {settings.level >= 2 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold opacity-75">
              英語質問テンプレート（Lv.2以降解禁・タップで入力）：
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

        {/* 質問入力フォーム */}
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
            placeholder="表現のコアイメージや使い分けを質問..."
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
            <span>送信</span>
          </button>
        </form>

        {/* チャット履歴一覧（すべて安全なテキストノードとして描画・XSS完全防御） */}
        <div className="space-y-3 pt-3 border-t" style={{ borderColor: palette.border }}>
          {messages.length === 0 ? (
            <p className="text-xs opacity-70 text-center py-6">
              まだ質問はありません。チャンクの空間イメージや発音フォームについて気軽に質問してください。
            </p>
          ) : (
            [...messages].reverse().map((msg) => (
              <div
                key={msg.id}
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                }}
                className="p-4 rounded-lg border space-y-2 text-xs"
              >
                <div className="flex items-center justify-between font-bold text-sm">
                  <span>Q: {msg.question}</span>
                  <span className="text-[11px] opacity-70">
                    {msg.status === 'pending_offline'
                      ? 'オフライン保存済み（未送信）'
                      : '回答済み'}
                  </span>
                </div>
                {msg.answer && (
                  <p className="leading-relaxed">
                    <strong>コアイメージ解説：</strong> {msg.answer}
                  </p>
                )}
                {msg.examples && msg.examples.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="font-semibold">例文：</p>
                    <ul className="list-disc pl-5 font-mono space-y-0.5">
                      {msg.examples.map((ex, i) => (
                        <li key={i}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
