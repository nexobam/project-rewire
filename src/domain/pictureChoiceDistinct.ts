// 絵カード4択（picture_choice）の視覚情報強化（3アイコン＋4タグ＋シーン図解）および完全非重複4択選出ロジック

import type { Chunk, IconName } from '../types';
import { extractSituationMeaning } from './chunkExplanation';
import { shuffleArray } from './shuffle';

export type PictureSemanticCluster =
  | 'cafe_drink'
  | 'transit_flight'
  | 'schedule_time'
  | 'home_living_item'
  | 'office_meeting_work'
  | 'weather_nature'
  | 'phone_device_trouble'
  | 'shopping_payment'
  | 'care_encouragement'
  | 'sports_arena';

export interface PictureSceneVisualMeta {
  cluster: PictureSemanticCluster;
  sceneTitle: string;
  actionTag: string;
  thirdIcon: IconName;
  accentHex: string;
  softBgCss: string;
}

/**
 * チャンクの英文・タグ・文法パターンから、意味クラスタ・第3アイコン・第4具体アクションタグ・シーン図解テーマを導出する
 */
export function getPictureSceneVisualMeta(chunk: Chunk): PictureSceneVisualMeta {
  const en = chunk.enText.toLowerCase();
  const [icon1, icon2] = chunk.visual.icons;

  const pickThirdIcon = (candidates: IconName[]): IconName => {
    for (const c of candidates) {
      if (c !== icon1 && c !== icon2) return c;
    }
    return 'Star';
  };

  // 1. カフェ・コーヒー・飲食注文系
  if (
    /latte|coffee|for here|cold brew|iced/.test(en) ||
    chunk.sceneCategory === 'cafe'
  ) {
    const actionTag = /on me/.test(en)
      ? 'おごり・会計'
      : /for here/.test(en)
        ? '店内イートイン'
        : /catch up/.test(en)
          ? 'カフェ近況雑談'
          : 'ドリンク注文';
    return {
      cluster: 'cafe_drink',
      sceneTitle: 'カフェ・飲食オーダー',
      actionTag,
      thirdIcon: pickThirdIcon(['Utensils', 'ShoppingBag', 'Heart', 'Coffee']),
      accentHex: '#d97706',
      softBgCss: 'linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(217, 119, 6, 0.06) 100%)',
    };
  }

  // 2. 天気・雨予報系
  if (/rain|weather|umbrella|sunny|storm/.test(en)) {
    return {
      cluster: 'weather_nature',
      sceneTitle: '空模様・天気チェック',
      actionTag: '雨予報と傘準備',
      thirdIcon: pickThirdIcon(['CloudRain', 'Umbrella', 'Wind', 'Sun']),
      accentHex: '#0284c7',
      softBgCss: 'linear-gradient(135deg, rgba(14, 165, 233, 0.16) 0%, rgba(56, 189, 248, 0.06) 100%)',
    };
  }

  // 3. 通話・プリンター・機器トラブル系
  if (/breaking up|printer|out of order|voice|phone|call/.test(en)) {
    const isPhone = /voice|breaking up|phone|call/.test(en);
    return {
      cluster: 'phone_device_trouble',
      sceneTitle: isPhone ? 'スマホ通話・通信状況' : 'オフィス機器トラブル',
      actionTag: isPhone ? '通話の電波乱れ' : '機器の故障停止',
      thirdIcon: pickThirdIcon(['AlertCircle', 'Wrench', 'Smartphone', 'Zap']),
      accentHex: '#dc2626',
      softBgCss: 'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(220, 38, 38, 0.06) 100%)',
    };
  }

  // 4. 電車・空港・移動系
  if (
    /train|next stop|check in|airport|flight|on my way/.test(en) ||
    chunk.sceneCategory === 'train' ||
    chunk.sceneCategory === 'airport'
  ) {
    const actionTag = /check in/.test(en)
      ? '空港搭乗手続き'
      : /next stop/.test(en)
        ? '次駅で降車準備'
        : /about to leave/.test(en)
          ? '発車直前の乗車'
          : '目的地へ移動中';
    return {
      cluster: 'transit_flight',
      sceneTitle: /check in|airport/.test(en)
        ? '空港・フライト移動'
        : '鉄道・アクセス移動',
      actionTag,
      thirdIcon: pickThirdIcon(['Navigation', 'Compass', 'MapPin', 'Train']),
      accentHex: '#2563eb',
      softBgCss: 'linear-gradient(135deg, rgba(37, 99, 235, 0.16) 0%, rgba(59, 130, 246, 0.06) 100%)',
    };
  }

  // 5. 買い物・試着・レストラン会計・食事系
  if (
    /jacket|try.*on|split the bill|quick bite|groceries|salt/.test(en) ||
    chunk.sceneCategory === 'shop' ||
    chunk.sceneCategory === 'shopping' ||
    chunk.sceneCategory === 'restaurant'
  ) {
    const actionTag = /jacket|try/.test(en)
      ? '服の試着確認'
      : /split the bill/.test(en)
        ? '伝票の割り勘'
        : /quick bite/.test(en)
          ? '短時間ランチ'
          : '買い物・食事';
    return {
      cluster: 'shopping_payment',
      sceneTitle: /jacket|try/.test(en)
        ? 'ショップ・試着室'
        : 'レストラン・お会計',
      actionTag,
      thirdIcon: pickThirdIcon(['ShoppingBag', 'CreditCard', 'Utensils', 'Gift']),
      accentHex: '#db2777',
      softBgCss: 'linear-gradient(135deg, rgba(219, 39, 119, 0.15) 0%, rgba(244, 63, 94, 0.06) 100%)',
    };
  }

  // 6. 自宅の牛乳・テレビ音量・就寝前熟考系
  if (/milk|volume|turn down|sleep on it/.test(en)) {
    const actionTag = /milk/.test(en)
      ? '牛乳の在庫切れ'
      : /volume/.test(en)
        ? 'TV音量を下げる'
        : '一晩寝て考える';
    return {
      cluster: 'home_living_item',
      sceneTitle: '自宅くらし・生活アクション',
      actionTag,
      thirdIcon: pickThirdIcon(['Home', 'Tv', 'Moon', 'Package']),
      accentHex: '#059669',
      softBgCss: 'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(5, 150, 105, 0.06) 100%)',
    };
  }

  // 7. 休息・励まし・アドバイス受容系
  if (/take it easy|get used to|keep that in mind/.test(en)) {
    const actionTag = /take it easy/.test(en)
      ? '無理せず休養'
      : /get used to/.test(en)
        ? '環境への慣れ'
        : '助言を心に留める';
    return {
      cluster: 'care_encouragement',
      sceneTitle: '休息・フォロー対話',
      actionTag,
      thirdIcon: pickThirdIcon(['Heart', 'ThumbsUp', 'Sun', 'Award']),
      accentHex: '#16a34a',
      softBgCss: 'linear-gradient(135deg, rgba(34, 197, 94, 0.16) 0%, rgba(22, 163, 74, 0.06) 100%)',
    };
  }

  // 8. 時刻約束・スケジュール・曜日系
  if (/tomorrow|friday|by seven|running a bit late|schedule/.test(en)) {
    const actionTag = /by seven/.test(en)
      ? '7時までの到着'
      : /friday/.test(en)
        ? '金曜日の楽しみ'
        : '翌日以降の連絡';
    return {
      cluster: 'schedule_time',
      sceneTitle: 'スケジュール・時刻約束',
      actionTag,
      thirdIcon: pickThirdIcon(['Calendar', 'Clock', 'Bell', 'CheckCircle']),
      accentHex: '#7c3aed',
      softBgCss: 'linear-gradient(135deg, rgba(124, 58, 237, 0.16) 0%, rgba(139, 92, 246, 0.06) 100%)',
    };
  }

  // 9. オフィス会議・業務引き継ぎ系
  return {
    cluster: 'office_meeting_work',
    sceneTitle: 'オフィス・会議ワーク',
    actionTag: /wrap up/.test(en)
      ? '会議の締めくくり'
      : /up to speed/.test(en)
        ? '最新状況の共有'
        : '業務の進行連携',
    thirdIcon: pickThirdIcon(['Briefcase', 'FileText', 'Users', 'Laptop']),
    accentHex: '#4f46e5',
    softBgCss: 'linear-gradient(135deg, rgba(79, 70, 229, 0.16) 0%, rgba(99, 102, 241, 0.06) 100%)',
  };
}

/**
 * 正解チャンクと意味クラスタ・場面カテゴリ・アイコン・全タグが被らないダミー選択肢3枚を選出する
 */
export function selectDistinctPictureDistractors(
  targetChunk: Chunk,
  allChunks: Chunk[],
  count = 3
): Chunk[] {
  const targetMeaning = extractSituationMeaning(targetChunk);

  const dailyPool = allChunks.filter(
    (c) =>
      c.id !== targetChunk.id &&
      !c.disabled &&
      c.contentCategory === 'daily' &&
      c.enText !== targetChunk.enText &&
      extractSituationMeaning(c) !== targetMeaning
  );

  const fallbackPool = allChunks.filter(
    (c) =>
      c.id !== targetChunk.id &&
      !c.disabled &&
      c.enText !== targetChunk.enText &&
      extractSituationMeaning(c) !== targetMeaning
  );

  const candidates = shuffleArray(
    dailyPool.length >= count ? dailyPool : fallbackPool
  );

  const chosen: Chunk[] = [];
  const existingCards: Chunk[] = [targetChunk];

  const scoreCandidate = (cand: Chunk): number => {
    const candMeta = getPictureSceneVisualMeta(cand);
    const [cPlace, cPartner, cSit] = cand.visual.tags;
    const cIcons = new Set<string>([
      ...cand.visual.icons,
      candMeta.thirdIcon,
    ]);

    let score = 1000;

    for (const ex of existingCards) {
      const exMeta = getPictureSceneVisualMeta(ex);
      const [ePlace, ePartner, eSit] = ex.visual.tags;

      // 1. 同じ意味クラスタ（例：カフェ同士、移動同士、時間約束同士）は最大のペナルティで徹底排除
      if (candMeta.cluster === exMeta.cluster) {
        score -= 500;
      }
      // 2. 同じ sceneCategory も強く排除
      if (cand.sceneCategory === ex.sceneCategory) {
        score -= 250;
      }
      // 3. アイコン（メイン・サブ）が1つでも被っていたら減点
      for (const ic of ex.visual.icons) {
        if (cIcons.has(ic)) {
          score -= 120;
        }
      }
      // 4. 場所タグ・相手タグ・状況タグ・アクションタグの重複を排除
      if (cPlace === ePlace) score -= 150;
      if (cPartner === ePartner) score -= 90;
      if (cSit === eSit) score -= 180;
      if (candMeta.actionTag === exMeta.actionTag) score -= 200;
    }

    return score;
  };

  while (chosen.length < count && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const s = scoreCandidate(candidates[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }

    const picked = candidates.splice(bestIdx, 1)[0];
    chosen.push(picked);
    existingCards.push(picked);
  }

  return chosen;
}
