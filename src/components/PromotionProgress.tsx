// 昇格ゲート進捗・ETA表示・ボス戦挑戦コンポーネント（要件2-1-6, 3）

import React from 'react';
import { Award, Clock, Lock, Shield, Unlock } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import type { GateStatus } from '../domain/promotionGate';

export interface PromotionProgressProps {
  gateStatus: GateStatus;
  etaText: string;
  bossCooldownUntil?: number;
  palette: ThemePalette;
  onStartBossBattle: () => void;
  nowMs?: number;
}

export const PromotionProgress: React.FC<PromotionProgressProps> = ({
  gateStatus,
  etaText,
  bossCooldownUntil,
  palette,
  onStartBossBattle,
  nowMs = Date.now(),
}) => {
  if (gateStatus.level >= 4) {
    return (
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-lg p-5 space-y-2"
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <Award size={20} strokeWidth={1.75} color="currentColor" />
          <span>Lv.4 ネイティブ雑談・自由発話フェーズ到達済み</span>
        </div>
        <p className="text-xs opacity-80">
          すべての昇格ゲートを突破しました。All EnglishモードとLive実戦で170wpmのNBAポッドキャスト聴取・自由発話を磨きましょう。
        </p>
      </div>
    );
  }

  const nextLevel = gateStatus.level + 1;
  const inCooldown =
    typeof bossCooldownUntil === 'number' && bossCooldownUntil > nowMs;
  const cooldownHoursLeft = inCooldown
    ? Math.ceil((bossCooldownUntil - nowMs) / (60 * 60 * 1000))
    : 0;

  const listeningLabel =
    gateStatus.level === 1
      ? '② 音変化リスニング（直近40問で85%以上）'
      : gateStatus.level === 2
        ? '② 複数話者リスニング（直近40問で85%以上）'
        : '② ノイズ下リスニング（直近40問で85%以上）';

  const speakingLabel =
    gateStatus.level === 1
      ? '③ 発話ドリル（直近40回で緑75%以上）'
      : gateStatus.level === 2
        ? '③ チャンク・ビルディング（直近40回で緑75%以上）'
        : '③ パラフレーズ（直近40回で緑75%以上）';

  return (
    <div
      style={{
        backgroundColor: palette.card,
        borderColor: palette.border,
        color: palette.text,
      }}
      className="border rounded-lg p-5 space-y-4"
      data-testid="promotion-gate-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-base">
          <Shield size={19} strokeWidth={1.75} color="currentColor" />
          <span>
            実力昇格ゲート（Lv.{gateStatus.level} → Lv.{nextLevel}）
          </span>
        </div>
        <div
          style={{ borderColor: palette.border }}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border"
          data-testid="eta-display"
        >
          <Clock size={14} strokeWidth={1.75} color="currentColor" />
          <span>予測ETA: {etaText}</span>
        </div>
      </div>

      <div className="space-y-3 text-xs">
        {/* ① コアセット */}
        <div className="space-y-1">
          <div className="flex items-center justify-between font-semibold">
            <span>
              ① コアセット80%以上（直近3回中2回以上緑＆最新緑・語順形式のみ集計）
            </span>
            <span>
              {gateStatus.coreMastered}/{gateStatus.coreTotal} (
              {Math.round(gateStatus.coreRate * 100)}%)
            </span>
          </div>
          <div
            style={{ backgroundColor: palette.background }}
            className="w-full h-2 rounded overflow-hidden"
          >
            <div
              style={{
                width: `${Math.min(100, Math.round(gateStatus.coreRate * 100))}%`,
                backgroundColor: gateStatus.corePassed
                  ? (palette.greenText ?? palette.text)
                  : palette.text,
              }}
              className="h-full transition-all"
            />
          </div>
        </div>

        {/* ② リスニング */}
        <div className="space-y-1">
          <div className="flex items-center justify-between font-semibold">
            <span>{listeningLabel}</span>
            <span>
              {gateStatus.listeningSampled < 40 && (
                <span className="text-[11px] font-normal opacity-75 mr-1">
                  計測中
                </span>
              )}
              {Math.round(gateStatus.listeningRate * 100)}% ({gateStatus.listeningSampled}
              /40問)
            </span>
          </div>
          <div
            style={{ backgroundColor: palette.background }}
            className="w-full h-2 rounded overflow-hidden"
          >
            <div
              style={{
                width: `${Math.min(100, Math.round(gateStatus.listeningRate * 100))}%`,
                backgroundColor: gateStatus.listeningPassed
                  ? (palette.greenText ?? palette.text)
                  : palette.text,
              }}
              className="h-full transition-all"
            />
          </div>
        </div>

        {/* ③ 発話 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between font-semibold">
            <span>{speakingLabel}</span>
            <span>
              {gateStatus.speakingSampled < 40 && (
                <span className="text-[11px] font-normal opacity-75 mr-1">
                  計測中
                </span>
              )}
              {Math.round(gateStatus.speakingGreenRate * 100)}% (
              {gateStatus.speakingSampled}/40回)
            </span>
          </div>
          <div
            style={{ backgroundColor: palette.background }}
            className="w-full h-2 rounded overflow-hidden"
          >
            <div
              style={{
                width: `${Math.min(100, Math.round(gateStatus.speakingGreenRate * 100))}%`,
                backgroundColor: gateStatus.speakingPassed
                  ? (palette.greenText ?? palette.text)
                  : palette.text,
              }}
              className="h-full transition-all"
            />
          </div>
        </div>
      </div>

      {/* ④ ボス戦ボタン */}
      <div className="pt-2 border-t flex items-center justify-between gap-3" style={{ borderColor: palette.border }}>
        <div className="text-xs opacity-80">
          {gateStatus.bossUnlocked ? (
            inCooldown ? (
              <span>
                ボス戦クールダウン中（あと約{cooldownHoursLeft}時間で再挑戦可能）
              </span>
            ) : (
              <span className="font-semibold">
                全条件クリア！ボス戦（全10問・ヒントなし・8問以上黄以内で合格）に挑戦できます。
              </span>
            )
          ) : (
            <span>①〜③をすべて満たすとボス戦が解放されます。</span>
          )}
        </div>

        <button
          type="button"
          disabled={!gateStatus.bossUnlocked || inCooldown}
          onClick={onStartBossBattle}
          style={{
            backgroundColor:
              gateStatus.bossUnlocked && !inCooldown
                ? (palette.greenText ?? palette.text)
                : palette.background,
            color:
              gateStatus.bossUnlocked && !inCooldown
                ? palette.background === '#141416'
                  ? '#141416'
                  : '#FFFFFF'
                : palette.text,
            borderColor: palette.border,
            borderBottomWidth: '3px',
          }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold tactile-block disabled:opacity-40 shrink-0"
          data-testid="boss-battle-button"
        >
          {gateStatus.bossUnlocked && !inCooldown ? (
            <Unlock size={15} strokeWidth={1.75} color="currentColor" />
          ) : (
            <Lock size={15} strokeWidth={1.75} color="currentColor" />
          )}
          <span>④ ボス戦に挑戦</span>
        </button>
      </div>
    </div>
  );
};
