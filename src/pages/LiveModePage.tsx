// Live実戦モード画面（開始用プロンプト生成＆ワンタップコピー・終了時JSONログ取り込みパーサー・要件4-3）

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Radio,
  Upload,
} from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import {
  buildLiveSessionPrompt,
  parseLiveSessionLog,
} from '../domain/liveParser';
import type { GateStatus } from '../domain/promotionGate';
import { playTactileClick } from '../services/audioService';
import type {
  AiReport,
  Attempt,
  Chunk,
  Session,
  Settings,
} from '../types';

export interface LiveModePageProps {
  settings: Settings;
  chunks: Chunk[];
  attempts: Attempt[];
  gateStatus: GateStatus;
  currentStudyDate: string;
  palette: ThemePalette;
  onSaveLiveResult: (params: {
    session: Session;
    report: AiReport;
    newChunks: Chunk[];
  }) => Promise<void>;
  onExitHome: () => void;
}

export const LiveModePage: React.FC<LiveModePageProps> = ({
  settings,
  chunks,
  attempts,
  gateStatus,
  currentStudyDate,
  palette,
  onSaveLiveResult,
  onExitHome,
}) => {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastImportedText, setLastImportedText] = useState<string | null>(null);
  const [logInput, setLogInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importedSummary, setImportedSummary] = useState<{
    minutes: number;
    fluencyScore: number;
    overallReview: string;
    addedChunks: Chunk[];
  } | null>(null);

  // 直近の弱点チャンク（赤評価またはLive由来）を最大5件抽出
  const recentWeakEnTexts = useMemo(() => {
    const chunkMap = new Map(chunks.map((c) => [c.id, c.enText]));
    const reds = attempts
      .filter((a) => a.rating === 'red')
      .slice(-10)
      .map((a) => chunkMap.get(a.chunkId))
      .filter((t): t is string => Boolean(t));
    const unique = [...new Set(reds)];
    return unique.slice(0, 5);
  }, [attempts, chunks]);

  const missingGateSummary = useMemo(() => {
    const parts: string[] = [];
    if (!gateStatus.corePassed) {
      parts.push(
        `コアセット残り${Math.max(0, Math.ceil(gateStatus.coreTotal * 0.8) - gateStatus.coreMastered)}個`
      );
    }
    if (!gateStatus.listeningPassed) {
      parts.push('音変化・高速リスニング85%未達');
    }
    if (!gateStatus.speakingPassed) {
      parts.push('瞬発発話75%未達');
    }
    return parts.length > 0 ? parts.join(' / ') : 'ボス戦挑戦可能';
  }, [gateStatus]);

  const generatedPrompt = useMemo(
    () =>
      buildLiveSessionPrompt({
        level: settings.level,
        weakChunks: recentWeakEnTexts,
        missingGateSummary,
      }),
    [missingGateSummary, recentWeakEnTexts, settings.level]
  );

  const handleCopyPrompt = async () => {
    playTactileClick(settings.clickSound);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(generatedPrompt);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(
        '自動コピーに失敗しました。下のプロンプト枠を選択して手動でコピーしてください。'
      );
    }
  };

  const handleImportLog = async () => {
    if (importing) return;
    if (lastImportedText !== null && lastImportedText === logInput.trim()) {
      setParseError('このログはすでに取り込み済みです。');
      return;
    }
    playTactileClick(settings.clickSound);
    setParseError(null);
    setImporting(true);
    try {
      const parsed = parseLiveSessionLog(logInput, settings.level);
      const sessionId = `sess_live_${Date.now()}`;

      const liveSession: Session = {
        id: sessionId,
        mode: 'live',
        plannedMinutes: 20,
        activeSeconds: parsed.calendarMinutes * 60,
        studyDate: currentStudyDate,
        startedAt: Date.now() - parsed.calendarMinutes * 60 * 1000,
        endedAt: Date.now(),
      };

      const liveReport: AiReport = {
        id: `report_${sessionId}`,
        sessionId,
        studyDate: currentStudyDate,
        status: 'done',
        retryCount: 0,
        liveLog: parsed.summary,
        createdAt: Date.now(),
      };

      await onSaveLiveResult({
        session: liveSession,
        report: liveReport,
        newChunks: parsed.generatedChunks,
      });

      setLastImportedText(logInput.trim());
      setImportedSummary({
        minutes: parsed.calendarMinutes,
        fluencyScore: parsed.summary.fluencyScore,
        overallReview: parsed.summary.overallReview,
        addedChunks: parsed.generatedChunks,
      });
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'ログの解析に失敗しました。Finish後に出力されたJSONを貼り付けてください。'
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Radio size={20} strokeWidth={1.75} color="currentColor" />
          <span>Live実戦モード（1回20分・Gemini Live手動連携）</span>
        </div>
        <button
          type="button"
          onClick={onExitHome}
          style={{ borderColor: palette.border }}
          className="px-3 py-1.5 rounded border text-xs font-semibold"
        >
          ホームへ戻る
        </button>
      </div>

      {/* Step 1: 開始用プロンプトの生成とワンタップコピー */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-base">
            Step 1: 本日専用のLive開始プロンプトをコピー
          </h2>
          <button
            type="button"
            onClick={handleCopyPrompt}
            style={{
              backgroundColor: palette.amberSurface ?? palette.text,
              color: palette.amberSurfaceText ?? palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border font-bold text-xs tactile-block"
            data-testid="copy-live-prompt-button"
          >
            <FileText size={15} strokeWidth={1.75} color="currentColor" />
            <span>
              {copied ? 'コピーしました！' : 'ワンタップでプロンプトをコピー'}
            </span>
          </button>
        </div>

        <pre
          style={{
            backgroundColor: palette.background,
            borderColor: palette.border,
          }}
          className="p-3.5 rounded-lg border text-xs whitespace-pre-wrap font-mono max-h-56 overflow-y-auto"
          data-testid="live-prompt-preview"
        >
          {generatedPrompt}
        </pre>
      </div>

      {/* Step 2: 終了時のJSONログ貼り付け・取り込み */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <h2 className="font-bold text-base">
          Step 2: 「Finish」で出力されたJSONログを貼り付けて取り込む
        </h2>
        <p className="text-xs opacity-80">
          前後に雑談の文やコードフェンス（```json ... ```）が混ざっていても自動で抽出・検証します。3語以上の弱点は語順問題、3語未満は発話ドリル専用としてSRS最優先キューに登録されます。
        </p>

        <textarea
          rows={7}
          value={logInput}
          onChange={(e) => setLogInput(e.target.value)}
          placeholder='{"durationMinutes": 20, "overallReview": "...", "goodPoints": ["..."], "badPoints": ["..."], "fluencyScore": 4, "weakChunks": ["let me get back to you", "on me"]}'
          style={{
            backgroundColor: palette.background,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="w-full p-3 rounded-lg border text-base sm:text-xs font-mono"
          data-testid="live-json-textarea"
        />

        {copyError && (
          <p className="text-xs font-semibold" style={{ color: palette.amberText }}>
            {copyError}
          </p>
        )}

        {parseError && (
          <div
            style={{
              color: palette.crimsonText,
              borderColor: palette.crimsonText,
            }}
            className="p-3 rounded border text-xs font-semibold flex items-center gap-2"
            data-testid="live-parse-error"
          >
            <AlertCircle size={16} strokeWidth={1.75} color="currentColor" />
            <span>{parseError}</span>
          </div>
        )}

        <button
          type="button"
          disabled={importing || logInput.trim().length === 0}
          onClick={handleImportLog}
          style={{
            backgroundColor: palette.text,
            color: palette.card,
            borderColor: palette.text,
            borderBottomWidth: '3px',
          }}
          className="w-full min-h-[52px] px-5 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 tactile-block"
          data-testid="import-live-log-button"
        >
          <Upload size={17} strokeWidth={1.75} color="currentColor" />
          <span>ログを検証してカレンダー＆SRSに取り込む</span>
        </button>

        {importedSummary && (
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.greenText ?? palette.border,
            }}
            className="p-4 rounded-lg border-2 space-y-2 text-xs"
            data-testid="live-import-success"
          >
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <CheckCircle size={18} strokeWidth={1.75} color="currentColor" />
              <span>
                取り込み完了！カレンダーに {importedSummary.minutes} 分を加算しました
              </span>
            </div>
            <p>
              Fluency Score: {importedSummary.fluencyScore}/5 / 総評:{' '}
              {importedSummary.overallReview}
            </p>
            <p className="font-semibold">
              登録された弱点チャンク ({importedSummary.addedChunks.length}件):
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {importedSummary.addedChunks.map((c) => (
                <li key={c.id}>
                  <span className="font-mono font-bold">{c.enText}</span> (
                  {c.speakOnly ? '3語未満：発話ドリル専用' : '3語以上：語順ブロック問題'}
                  )
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
