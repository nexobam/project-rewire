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
 * チャンクの sceneCategory・英文（単語境界付き）・タグから、
 * 100%内容と一致する意味クラスタ・第3アイコン・焦点タグ・シーン見出しを導出する
 * （注意：\brain\b 等すべての単語マッチに単語境界 \b を使用し、train -> rain 等の部分一致誤爆を防止）
 */
export function getPictureSceneVisualMeta(chunk: Chunk): PictureSceneVisualMeta {
  const en = chunk.enText.toLowerCase();
  const scene = chunk.sceneCategory.toLowerCase();
  const [icon1, icon2] = chunk.visual.icons;
  const [placeTag, partnerTag, situationTag] = chunk.visual.tags;

  const pickThirdIcon = (candidates: IconName[]): IconName => {
    for (const c of candidates) {
      if (c !== icon1 && c !== icon2) return c;
    }
    return 'Star';
  };

  // 0. バスケ・アリーナ系
  if (chunk.contentCategory === 'heat' || scene === 'arena') {
    return {
      cluster: 'sports_arena',
      sceneTitle: `試合・${placeTag}`,
      actionTag: `${situationTag}`,
      thirdIcon: pickThirdIcon(['Trophy', 'Flame', 'Target', 'Award']),
      accentHex: '#dc2626',
      softBgCss:
        'linear-gradient(135deg, rgba(220, 38, 38, 0.16) 0%, rgba(239, 68, 68, 0.06) 100%)',
    };
  }

  // 1. 天気・雨予報系（必ず単語境界 \b を使用し train や drained への誤爆を防止）
  if (/\b(rain|rained|raining|weather|umbrella|sunny|storm)\b/.test(en)) {
    const actionTag = /\bumbrella\b/.test(en)
      ? '傘の忘れ物・雨具'
      : '雨模様・天気予報';
    return {
      cluster: 'weather_nature',
      sceneTitle: '天気・雨模様シーン',
      actionTag,
      thirdIcon: pickThirdIcon(['CloudRain', 'Umbrella', 'Wind', 'Sun']),
      accentHex: '#0284c7',
      softBgCss:
        'linear-gradient(135deg, rgba(14, 165, 233, 0.16) 0%, rgba(56, 189, 248, 0.06) 100%)',
    };
  }

  // 2. カフェ・コーヒーオーダー系
  if (
    scene === 'cafe' ||
    /\b(latte|coffee|cold brew|iced|for here|bakery)\b/.test(en)
  ) {
    const actionTag = /\bon me\b/.test(en)
      ? 'おごり・会計'
      : /\bfor here\b/.test(en)
        ? '店内イートイン'
        : /\bcatch up\b/.test(en)
          ? 'カフェ近況雑談'
          : /\btable outside\b/.test(en)
            ? 'テラス席の確保'
            : /\bpacked\b/.test(en)
              ? '店内の混雑状況'
              : 'ドリンク注文';
    return {
      cluster: 'cafe_drink',
      sceneTitle: `カフェ・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['Utensils', 'ShoppingBag', 'Heart', 'Coffee']),
      accentHex: '#d97706',
      softBgCss:
        'linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(217, 119, 6, 0.06) 100%)',
    };
  }

  // 3. 鉄道・空港・クルマ移動系
  if (
    scene === 'train' ||
    scene === 'airport' ||
    scene === 'station' ||
    /\b(train|express|next stop|check in|airport|flight|boarding|on my way|heading back|traffic)\b/.test(
      en
    )
  ) {
    const isAirport =
      scene === 'airport' || /\b(check in|airport|flight|boarding)\b/.test(en);
    const isTraffic = /\btraffic\b/.test(en);
    const actionTag = isAirport
      ? '空港・搭乗手続き'
      : isTraffic
        ? '道路の渋滞遅延'
        : /\bnext stop\b/.test(en)
          ? '次駅で降車準備'
          : /\babout to leave\b/.test(en)
            ? '発車直前の電車'
            : /\bearlier train|express\b/.test(en)
              ? '早い電車に乗車'
              : '目的地へ移動中';
    return {
      cluster: 'transit_flight',
      sceneTitle: isAirport
        ? `空港・${placeTag}`
        : isTraffic
          ? `道路・${placeTag}`
          : `鉄道・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['Navigation', 'Compass', 'MapPin', 'Train']),
      accentHex: '#2563eb',
      softBgCss:
        'linear-gradient(135deg, rgba(37, 99, 235, 0.16) 0%, rgba(59, 130, 246, 0.06) 100%)',
    };
  }

  // 4. 通話・機器故障トラブル系（充電忘れ等は除外し、実際の通話または故障のみに限定）
  if (
    scene === 'phone' ||
    /\b(breaking up|out of order|printer|call you right back)\b/.test(en)
  ) {
    const isPrinter = /\b(printer|out of order)\b/.test(en);
    const actionTag = isPrinter
      ? '機器の故障停止'
      : /\bbreaking up\b/.test(en)
        ? '通話の電波乱れ'
        : '折り返し電話連絡';
    return {
      cluster: 'phone_device_trouble',
      sceneTitle: isPrinter ? `機器・${placeTag}` : `通話・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['AlertCircle', 'Wrench', 'Smartphone', 'Phone']),
      accentHex: '#dc2626',
      softBgCss:
        'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(220, 38, 38, 0.06) 100%)',
    };
  }

  // 5. 買い物・試着・レストラン食事・会計系（服屋とレストランを明確に区別）
  if (
    scene === 'shop' ||
    scene === 'shopping' ||
    scene === 'restaurant' ||
    /\b(jacket|try .* on|out of stock|split the bill|quick bite|groceries|salt|reservation)\b/.test(
      en
    )
  ) {
    const isShop =
      scene === 'shop' ||
      scene === 'shopping' ||
      /\b(jacket|try .* on|out of stock|groceries|looking around)\b/.test(en);
    const actionTag = /\b(jacket|try)\b/.test(en)
      ? '服の試着確認'
      : /\bout of stock\b/.test(en)
        ? '商品の在庫切れ'
        : /\bgroceries\b/.test(en)
          ? '食料品の買い出し'
          : /\bsplit the bill\b/.test(en)
            ? '伝票の割り勘'
            : /\bquick bite\b/.test(en)
              ? '短時間ランチ'
              : /\breservation\b/.test(en)
                ? 'お店の予約確認'
                : `${situationTag}`;
    return {
      cluster: 'shopping_payment',
      sceneTitle: isShop ? `買い物・${placeTag}` : `食事・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon([
        'ShoppingBag',
        'CreditCard',
        'Utensils',
        'Gift',
      ]),
      accentHex: '#db2777',
      softBgCss:
        'linear-gradient(135deg, rgba(219, 39, 119, 0.15) 0%, rgba(244, 63, 94, 0.06) 100%)',
    };
  }

  // 6. 休息・励まし・アドバイス受容系
  if (/\b(take it easy|get used to|keep that in mind)\b/.test(en)) {
    const actionTag = /\btake it easy\b/.test(en)
      ? '無理せず休養'
      : /\bget used to\b/.test(en)
        ? '環境への慣れ'
        : '助言を心に留める';
    return {
      cluster: 'care_encouragement',
      sceneTitle: `対話・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['Heart', 'ThumbsUp', 'Sun', 'Award']),
      accentHex: '#16a34a',
      softBgCss:
        'linear-gradient(135deg, rgba(34, 197, 94, 0.16) 0%, rgba(22, 163, 74, 0.06) 100%)',
    };
  }

  // 7. 自宅くらし・生活アクション系（scene === 'home' をすべて確実にカバーし、オフィスに落ちないようにする）
  if (
    scene === 'home' ||
    /\b(milk|volume|turn down|sleep on it|takeout|laundry|charge my phone|cooking|out of energy)\b/.test(
      en
    )
  ) {
    const actionTag = /\bmilk\b/.test(en)
      ? '牛乳の在庫切れ'
      : /\bvolume\b/.test(en)
        ? 'TV音量を下げる'
        : /\bsleep on it\b/.test(en)
          ? '一晩寝て考える'
          : /\btakeout\b/.test(en)
            ? '出前・テイクアウト'
            : /\blaundry\b/.test(en)
              ? '洗濯物の片付け'
              : /\bcharge my phone\b/.test(en)
                ? 'スマホの充電忘れ'
                : `${situationTag}`;
    return {
      cluster: 'home_living_item',
      sceneTitle: `自宅・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['Home', 'Tv', 'Moon', 'Package']),
      accentHex: '#059669',
      softBgCss:
        'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(5, 150, 105, 0.06) 100%)',
    };
  }

  // 8. 時刻約束・スケジュール・曜日系
  if (
    /\b(tomorrow|friday|by seven|running a bit late|schedule)\b/.test(en)
  ) {
    const actionTag = /\bby seven\b/.test(en)
      ? '7時までの到着'
      : /\bfriday\b/.test(en)
        ? '金曜日の予定'
        : /\bschedule\b/.test(en)
          ? '予定の再確認'
          : '翌日以降の連絡';
    return {
      cluster: 'schedule_time',
      sceneTitle: `予定・${placeTag}`,
      actionTag,
      thirdIcon: pickThirdIcon(['Calendar', 'Clock', 'Bell', 'CheckCircle']),
      accentHex: '#7c3aed',
      softBgCss:
        'linear-gradient(135deg, rgba(124, 58, 237, 0.16) 0%, rgba(139, 92, 246, 0.06) 100%)',
    };
  }

  // 9. オフィス・街角・その他の日常シーン（場所タグと状況タグを使って正確に表現）
  const isOffice =
    scene === 'office' ||
    scene === 'meeting' ||
    /オフィス|会議|デスク|職場/.test(placeTag);
  return {
    cluster: 'office_meeting_work',
    sceneTitle: isOffice
      ? `職場・${placeTag}`
      : `日常・${placeTag}（対${partnerTag}）`,
    actionTag: /\bwrap up\b/.test(en)
      ? '会議の締めくくり'
      : /\bup to speed\b/.test(en)
        ? '最新状況の共有'
        : /\bkeep you posted\b/.test(en)
          ? '進捗の随時報告'
          : `${situationTag}`,
    thirdIcon: pickThirdIcon(['Briefcase', 'FileText', 'Users', 'Laptop']),
    accentHex: '#4f46e5',
    softBgCss:
      'linear-gradient(135deg, rgba(79, 70, 229, 0.16) 0%, rgba(99, 102, 241, 0.06) 100%)',
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
    const cIcons = new Set<string>([...cand.visual.icons, candMeta.thirdIcon]);

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
