// 慣用句・句動詞・コロケーションの「塊チャンク × 簡単英語イコール（英英パラフレーズ） × 空間コアイメージ」抽出エンジン
// （英⇔日の1対1単語暗記による翻訳癖を防ぎ、既存の簡単な英語と空間感覚へ直結させる）

export interface IdiomAnchor {
  chunkPhrase: string;
  easyEnglish: string;
  spatialImageJa: string;
}

interface IdiomRule {
  pattern: RegExp;
  chunkPhrase: string;
  easyEnglish: string;
  spatialImageJa: string;
}

const IDIOM_RULES: IdiomRule[] = [
  {
    pattern: /\bmight as well\b/i,
    chunkPhrase: 'might as well + 動詞',
    easyEnglish: '= let us just do it (no better option)',
    spatialImageJa: '他の選択肢と比べて「まあ同じくらい(as well)アリだよね＝いっそ〜しちゃおう」と軽く決める塊',
  },
  {
    pattern: /\bfigure(?:d|s|ing)?\s+(?:it\s+)?out\b/i,
    chunkPhrase: 'figure out',
    easyEnglish: '= find the answer / understand',
    spatialImageJa: '頭の中のモヤモヤした形(figure)を外(out)へ引っ張り出してハッキリさせる動き',
  },
  {
    pattern: /\bend(?:ed|s|ing)?\s+up\b/i,
    chunkPhrase: 'end up + -ing',
    easyEnglish: '= finally do (after everything)',
    spatialImageJa: 'あれこれ動いた末に、最終地点(end)へポンと浮上(up)して行き着くイメージ',
  },
  {
    pattern: /\b(?:run|ran|running)\s+out\s+of\b/i,
    chunkPhrase: 'run out of ~',
    easyEnglish: '= have no more ~ left',
    spatialImageJa: '容器の中から中身が外(out)へ走り去って空っぽになる空間イメージ',
  },
  {
    pattern: /\bwrap(?:ped|s|ping)?\s+up\b/i,
    chunkPhrase: 'wrap up ~',
    easyEnglish: '= finish / bring to a close',
    spatialImageJa: '広げた荷物をパッと包み上げて(wrap up)綺麗に締めくくる動き',
  },
  {
    pattern: /\bcatch(?:ing|es|caught)?\s+up\b/i,
    chunkPhrase: 'catch up (on / over ~)',
    easyEnglish: '= get updated / finish pending things',
    spatialImageJa: '遅れていた距離を走って追いつき(catch up)、最新の位置に並ぶ感覚',
  },
  {
    pattern: /\bturn(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'turn down ~',
    easyEnglish: '= lower (volume) / say no politely',
    spatialImageJa: 'つまみや差し出された手を下向き(down)に回して(turn)下げる・丁重に断る動き',
  },
  {
    pattern: /\blook(?:ed|s|ing)?\s+forward\s+to\b/i,
    chunkPhrase: 'look forward to ~',
    easyEnglish: '= cannot wait for ~ / excited about',
    spatialImageJa: '首を前(forward)にぐっと乗り出して、その日(to ~)に視線を向けている姿勢',
  },
  {
    pattern: /\bsplit(?:ting|s)?\s+the\s+bill\b/i,
    chunkPhrase: 'split the bill',
    easyEnglish: '= each pay our own share',
    spatialImageJa: '1枚の伝票(bill)をスパッと半分に割る(split)イメージ',
  },
  {
    pattern: /\bkeep\s+(?:that|it|this)\s+in\s+mind\b/i,
    chunkPhrase: 'keep ~ in mind',
    easyEnglish: '= remember ~ / not forget',
    spatialImageJa: '心の箱(in mind)の中にそれを入れてキープ(keep)しておく感覚',
  },
  {
    pattern: /\bsleep\s+on\s+it\b/i,
    chunkPhrase: 'sleep on it',
    easyEnglish: '= think about it until tomorrow',
    spatialImageJa: 'その問題を枕の下に敷いて(on it)一晩寝かせるイメージ',
  },
  {
    pattern: /\bon\s+me\b/i,
    chunkPhrase: 'be on me',
    easyEnglish: '= I will pay for this',
    spatialImageJa: 'お会計の負担が自分の肩の上(on me)に乗っている＝「ここは私の奢り」',
  },
  {
    pattern: /\bout\s+of\s+order\b/i,
    chunkPhrase: 'out of order',
    easyEnglish: '= broken / not working',
    spatialImageJa: '正常な順序・状態(order)の枠から外(out)へ外れて動かない状態',
  },
  {
    pattern: /\bout\s+of\s+stock\b/i,
    chunkPhrase: 'out of stock',
    easyEnglish: '= sold out / none left in store',
    spatialImageJa: '在庫の棚(stock)から外(out)へ出払って空になっている状態',
  },
  {
    pattern: /\bmake\s+it\b/i,
    chunkPhrase: 'make it (by / on time)',
    easyEnglish: '= arrive in time / succeed',
    spatialImageJa: '目指す場所・時間というゴール地点まで「状況を完成させる(make it)＝間に合う」',
  },
  {
    pattern: /\bget(?:ting|s|got)?\s+used\s+to\b/i,
    chunkPhrase: 'get used to ~',
    easyEnglish: '= become comfortable with ~',
    spatialImageJa: '最初は違和感がある状態から、馴染んだ状態(used)へ矢印(to)で移行(get)する動き',
  },
  {
    pattern: /\bup\s+to\s+speed\b/i,
    chunkPhrase: 'get ~ up to speed',
    easyEnglish: '= share the latest info with ~',
    spatialImageJa: '今みんなが走っている巡航速度(speed)の高さ(up to)まで引き上げるイメージ',
  },
  {
    pattern: /\btake\s+it\s+easy\b/i,
    chunkPhrase: 'take it easy',
    easyEnglish: '= relax / do not push too hard',
    spatialImageJa: '張り詰めた状況を気楽な状態(easy)で手に取る(take)＝「無理せずゆっくり休む」',
  },
  {
    pattern: /\bon\s+my\s+way\b/i,
    chunkPhrase: 'on my way',
    easyEnglish: '= going there right now',
    spatialImageJa: 'すでに目的地へ続く道の上(on my way)に自分の足が乗って進んでいる感覚',
  },
  {
    pattern: /\babout\s+to\b/i,
    chunkPhrase: 'be about to + 動詞',
    easyEnglish: '= going to happen in a few seconds',
    spatialImageJa: 'アクションのすぐ周囲(about)に接していて、今まさに飛び出す寸前の状態',
  },
  {
    pattern: /\bsupposed\s+to\b/i,
    chunkPhrase: 'be supposed to ~',
    easyEnglish: '= expected to ~ / scheduled to ~',
    spatialImageJa: '周りのみんなや予報から「〜するはずだ」と思われている規定路線',
  },
  {
    pattern: /\bgrab\s+a\s+(?:quick\s+)?(?:bite|coffee|cup|table)\b/i,
    chunkPhrase: 'grab a ~',
    easyEnglish: '= quickly get / eat / take ~',
    spatialImageJa: '時間をかけず手でサッと掴み取る(grab)軽快なアクション',
  },
  {
    pattern: /\bbreak(?:ing|s|broke)?\s+up\b/i,
    chunkPhrase: 'break up (voice / call)',
    easyEnglish: '= sound cuts out / bad connection',
    spatialImageJa: '繋がっていた音声がバラバラの破片に砕け散る(break up)イメージ',
  },
  {
    pattern: /\btry\s+(?:this|that|it|[a-z]+\s+[a-z]+)\s+on\b/i,
    chunkPhrase: 'try ~ on',
    easyEnglish: '= wear ~ to check the size',
    spatialImageJa: '服を自分の体の上に接触(on)させて試す(try)動き',
  },
  {
    pattern: /\bget(?:ting|s|got)?\s+off\b/i,
    chunkPhrase: 'get off (at ~)',
    easyEnglish: '= leave the train / bus',
    spatialImageJa: '乗っていた車体の床面から足を離して(off)外へ降りる動き',
  },
  {
    pattern: /\bpull(?:ed|s|ing)?\s+off\b/i,
    chunkPhrase: 'pull off ~',
    easyEnglish: '= succeed in doing something hard',
    spatialImageJa: '難しい状況から勝利や成功をグイッと引き抜いて(pull off)達成する感覚',
  },
  {
    pattern: /\b(?:come|came|coming)\s+up\s+with\b/i,
    chunkPhrase: 'come up with ~',
    easyEnglish: '= produce / create (an idea or play)',
    spatialImageJa: '水面下からアイデアやビッグプレーを携えて(with)浮上(come up)してくる動き',
  },
  {
    pattern: /\bkeep\s+you\s+posted\b/i,
    chunkPhrase: 'keep you posted',
    easyEnglish: '= send you the latest updates',
    spatialImageJa: '掲示板(post)の最新情報に相手を常に触れさせ続ける(keep)イメージ',
  },
  {
    pattern: /\b(?:take|taking|took)\s+over\b/i,
    chunkPhrase: 'take over ~',
    easyEnglish: '= take control of ~',
    spatialImageJa: '全体の上(over)に手を被せて主導権を自分の手に奪い取る(take)動き',
  },
  {
    pattern: /\block(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'lock down ~',
    easyEnglish: '= completely block / secure',
    spatialImageJa: '上からガチッと鍵をかけて(lock)押さえ込む(down)イメージ',
  },
  {
    pattern: /\bknock(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'knock down ~',
    easyEnglish: '= hit / score cleanly',
    spatialImageJa: 'ターゲットやシュートを上からスパッと撃ち抜いて沈める(knock down)感覚',
  },
  {
    pattern: /\b(?:hold|held)\s+up\b/i,
    chunkPhrase: 'get held up',
    easyEnglish: '= get delayed / stuck',
    spatialImageJa: '渋滞などにガシッと掴まれて(held)進行を止められている(up)状態',
  },
  {
    pattern: /\btake\s+care\s+of\b/i,
    chunkPhrase: 'take care of ~',
    easyEnglish: '= handle / deal with ~',
    spatialImageJa: 'その案件を自分の手元に引き取って責任を持って処理する塊',
  },
  {
    pattern: /\brun\s+this\s+idea\s+by\b/i,
    chunkPhrase: 'run ~ by you',
    easyEnglish: '= tell you ~ to get your opinion',
    spatialImageJa: '自分のアイデアを相手の目の前(by you)にサッと走らせて(run)反応を見る動き',
  },
  {
    pattern: /\bhead(?:ing|ed|s)?\s+back\b/i,
    chunkPhrase: 'head back (home)',
    easyEnglish: '= return / go back',
    spatialImageJa: '頭(head)の向きを元の場所(back)へくるっと向けて進んでいく動き',
  },
];

/**
 * 英文に含まれる重要な慣用句・句動詞・コロケーションを検出し、
 * 「塊チャンク × 簡単な英語イコール（英英言い換え） × 空間コアイメージ」を返す
 */
export function spotIdiomAnchor(enText: string): IdiomAnchor | null {
  const cleaned = enText.trim();
  for (const rule of IDIOM_RULES) {
    if (rule.pattern.test(cleaned)) {
      return {
        chunkPhrase: rule.chunkPhrase,
        easyEnglish: rule.easyEnglish,
        spatialImageJa: rule.spatialImageJa,
      };
    }
  }
  return null;
}
