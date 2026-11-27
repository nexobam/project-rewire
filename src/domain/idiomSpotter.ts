// 慣用句・句動詞・コロケーションの「塊チャンク × 簡単英語イコール（英英パラフレーズ） × 空間コアイメージ × 応用例文」抽出エンジン
// （英⇔日の1対1単語暗記による翻訳癖を防ぎ、既存の簡単な英語と空間感覚・別場面での使い回しへ直結させる）

export interface IdiomAnchor {
  chunkPhrase: string;
  easyEnglish: string;
  spatialImageJa: string;
  examples: string[];
}

interface IdiomRule {
  pattern: RegExp;
  chunkPhrase: string;
  easyEnglish: string;
  spatialImageJa: string;
  examples: string[];
}

const IDIOM_RULES: IdiomRule[] = [
  {
    pattern: /\bmight as well\b/i,
    chunkPhrase: 'might as well + 動詞',
    easyEnglish: '= let us just do it (no better option)',
    spatialImageJa: '他の選択肢と比べて「まあ同じくらい(as well)アリだよね＝いっそ〜しちゃおう」と軽く決める塊',
    examples: [
      'We might as well start now. （待っても仕方ないし、もう始めちゃおうか）',
      'I might as well walk home. （バスも来ないし、いっそ歩いて帰ろうかな）',
    ],
  },
  {
    pattern: /\bfigure(?:d|s|ing)?\s+(?:it\s+)?out\b/i,
    chunkPhrase: 'figure out',
    easyEnglish: '= find the answer / understand',
    spatialImageJa: '頭の中のモヤモヤした形(figure)を外(out)へ引っ張り出してハッキリさせる動き',
    examples: [
      'I will figure out how to fix it. （どうやって直すか考えて解決するよ）',
      'Did you figure out the problem? （何が原因か突き止められた？）',
    ],
  },
  {
    pattern: /\bend(?:ed|s|ing)?\s+up\b/i,
    chunkPhrase: 'end up + -ing',
    easyEnglish: '= finally do (after everything)',
    spatialImageJa: 'あれこれ動いた末に、最終地点(end)へポンと浮上(up)して行き着くイメージ',
    examples: [
      'We ended up taking a taxi. （結局タクシーに乗ることになった）',
      'I ended up buying both. （迷った末に結局どっちも買っちゃった）',
    ],
  },
  {
    pattern: /\b(?:run|ran|running)\s+out\s+of\b/i,
    chunkPhrase: 'run out of ~',
    easyEnglish: '= have no more ~ left',
    spatialImageJa: '容器の中から中身が外(out)へ走り去って空っぽになる空間イメージ',
    examples: [
      'We are running out of time. （だんだん残り時間がなくなってきた）',
      'My phone ran out of battery. （スマホの充電が切れてしまった）',
    ],
  },
  {
    pattern: /\bwrap(?:ped|s|ping)?\s+up\b/i,
    chunkPhrase: 'wrap up ~',
    easyEnglish: '= finish / bring to a close',
    spatialImageJa: '広げた荷物をパッと包み上げて(wrap up)綺麗に締めくくる動き',
    examples: [
      'Let us wrap up for today. （今日のところはこれで切り上げよう）',
      'I just wrapped up the report. （ちょうどレポートを仕上げたところです）',
    ],
  },
  {
    pattern: /\bcatch(?:ing|es|caught)?\s+up\b/i,
    chunkPhrase: 'catch up (on / over ~)',
    easyEnglish: '= get updated / finish pending things',
    spatialImageJa: '遅れていた距離を走って追いつき(catch up)、最新の位置に並ぶ感覚',
    examples: [
      'I need to catch up on sleep. （寝不足の分を寝溜めして取り戻さないと）',
      'Let us catch up over lunch soon. （近いうちランチしながら近況話そうよ）',
    ],
  },
  {
    pattern: /\bturn(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'turn down ~',
    easyEnglish: '= lower (volume) / say no politely',
    spatialImageJa: 'つまみや差し出された手を下向き(down)に回して(turn)下げる・丁重に断る動き',
    examples: [
      'Can you turn down the AC? （エアコンを少し弱めてくれる？）',
      'He turned down the invitation. （彼はその誘いを丁重に断った）',
    ],
  },
  {
    pattern: /\blook(?:ed|s|ing)?\s+forward\s+to\b/i,
    chunkPhrase: 'look forward to ~',
    easyEnglish: '= cannot wait for ~ / excited about',
    spatialImageJa: '首を前(forward)にぐっと乗り出して、その日(to ~)に視線を向けている姿勢',
    examples: [
      'I am looking forward to the trip. （旅行が本当に待ち遠しい！）',
      'I look forward to seeing you. （お会いできるのを楽しみにしています）',
    ],
  },
  {
    pattern: /\bsplit(?:ting|s)?\s+the\s+bill\b/i,
    chunkPhrase: 'split the bill',
    easyEnglish: '= each pay our own share',
    spatialImageJa: '1枚の伝票(bill)をスパッと半分に割る(split)イメージ',
    examples: [
      'Let us split the cost evenly. （費用は均等に割り勘にしよう）',
      'Do you mind if we split the bill? （お会計は別々［割り勘］でもいい？）',
    ],
  },
  {
    pattern: /\bkeep\s+(?:that|it|this)\s+in\s+mind\b/i,
    chunkPhrase: 'keep ~ in mind',
    easyEnglish: '= remember ~ / not forget',
    spatialImageJa: '心の箱(in mind)の中にそれを入れてキープ(keep)しておく感覚',
    examples: [
      'Please keep the deadline in mind. （締め切りを念頭に置いておいてね）',
      'I will keep your advice in mind. （あなたのアドバイスを心に留めておきます）',
    ],
  },
  {
    pattern: /\bsleep\s+on\s+it\b/i,
    chunkPhrase: 'sleep on it',
    easyEnglish: '= think about it until tomorrow',
    spatialImageJa: 'その問題を枕の下に敷いて(on it)一晩寝かせるイメージ',
    examples: [
      'Why do not you sleep on it first? （まずは一晩寝て考えてみたらどう？）',
      'I slept on it and made my decision. （一晩じっくり考えて決断しました）',
    ],
  },
  {
    pattern: /\bon\s+me\b/i,
    chunkPhrase: 'be on me',
    easyEnglish: '= I will pay for this',
    spatialImageJa: 'お会計の負担が自分の肩の上(on me)に乗っている＝「ここは私の奢り」',
    examples: [
      'Dinner is on me tonight. （今夜の夕食は私がおごるよ）',
      'The next round is on me! （次の1杯は私のおごりね！）',
    ],
  },
  {
    pattern: /\bout\s+of\s+order\b/i,
    chunkPhrase: 'out of order',
    easyEnglish: '= broken / not working',
    spatialImageJa: '正常な順序・状態(order)の枠から外(out)へ外れて動かない状態',
    examples: [
      'The elevator is out of order today. （今日はエレベーターが故障中だ）',
      'That ticket machine is out of order. （あの券売機は使用停止中だよ）',
    ],
  },
  {
    pattern: /\bout\s+of\s+stock\b/i,
    chunkPhrase: 'out of stock',
    easyEnglish: '= sold out / none left in store',
    spatialImageJa: '在庫の棚(stock)から外(out)へ出払って空になっている状態',
    examples: [
      'This item is temporarily out of stock. （この商品は一時的に在庫切れです）',
      'The black model went out of stock. （黒のモデルは売り切れてしまった）',
    ],
  },
  {
    pattern: /\bmake\s+it\b/i,
    chunkPhrase: 'make it (by / on time)',
    easyEnglish: '= arrive in time / succeed',
    spatialImageJa: '目指す場所・時間というゴール地点まで「状況を完成させる(make it)＝間に合う・行ける」',
    examples: [
      'Can you make it to the party? （パーティーには来られそう？）',
      'We made it just in time! （ギリギリ時間通りに間に合った！）',
    ],
  },
  {
    pattern: /\bget(?:ting|s|got)?\s+used\s+to\b/i,
    chunkPhrase: 'get used to ~',
    easyEnglish: '= become comfortable with ~',
    spatialImageJa: '最初は違和感がある状態から、馴染んだ状態(used)へ矢印(to)で移行(get)する動き',
    examples: [
      'I am getting used to my new job. （新しい仕事にだんだん慣れてきた）',
      'It took a week to get used to the schedule. （この予定に慣れるのに1週間かかった）',
    ],
  },
  {
    pattern: /\bup\s+to\s+speed\b/i,
    chunkPhrase: 'get ~ up to speed',
    easyEnglish: '= share the latest info with ~',
    spatialImageJa: '今みんなが走っている巡航速度(speed)の高さ(up to)まで引き上げるイメージ',
    examples: [
      'I am finally up to speed on this project. （ようやくこの案件の最新状況に追いついた）',
      'Can you bring me up to speed? （ここまでの最新経緯をざっと教えてくれる？）',
    ],
  },
  {
    pattern: /\btake\s+it\s+easy\b/i,
    chunkPhrase: 'take it easy',
    easyEnglish: '= relax / do not push too hard',
    spatialImageJa: '張り詰めた状況を気楽な状態(easy)で手に取る(take)＝「無理せずゆっくり休む」',
    examples: [
      'I am just going to take it easy this weekend. （今週末はのんびり過ごすよ）',
      'Take it easy, there is no rush. （焦らなくて大丈夫、ゆっくりいこう）',
    ],
  },
  {
    pattern: /\bon\s+my\s+way\b/i,
    chunkPhrase: 'on my way',
    easyEnglish: '= going there right now',
    spatialImageJa: 'すでに目的地へ続く道の上(on my way)に自分の足が乗って進んでいる感覚',
    examples: [
      'I am on my way to the station. （今ちょうど駅に向かっているところです）',
      'She is on her way home now. （彼女は今帰っている途中だよ）',
    ],
  },
  {
    pattern: /\babout\s+to\b/i,
    chunkPhrase: 'be about to + 動詞',
    easyEnglish: '= going to happen in a few seconds',
    spatialImageJa: 'アクションのすぐ周囲(about)に接していて、今まさに飛び出す寸前の状態',
    examples: [
      'I was just about to call you! （まさに今あなたに電話しようとしてたところ！）',
      'The movie is about to start. （映画がもうすぐ始まるよ）',
    ],
  },
  {
    pattern: /\bsupposed\s+to\b/i,
    chunkPhrase: 'be supposed to ~',
    easyEnglish: '= expected to ~ / scheduled to ~',
    spatialImageJa: '周りのみんなや予報から「〜するはずだ・予定だ」と決まっている路線',
    examples: [
      'I am supposed to meet him at six. （6時に彼と会う約束［予定］になっている）',
      'What am I supposed to do next? （次は何をすればいいことになってるの？）',
    ],
  },
  {
    pattern: /\bgrab\s+a\s+(?:quick\s+)?(?:bite|coffee|cup|table)\b/i,
    chunkPhrase: 'grab a ~',
    easyEnglish: '= quickly get / eat / take ~',
    spatialImageJa: '時間をかけず手でサッと掴み取る(grab)軽快なアクション',
    examples: [
      'Let us grab a taxi from here. （ここからサッとタクシーを拾おう）',
      'Do you want to grab a drink after work? （仕事終わりに軽く一杯どう？）',
    ],
  },
  {
    pattern: /\bbreak(?:ing|s|broke)?\s+up\b/i,
    chunkPhrase: 'break up (voice / call)',
    easyEnglish: '= sound cuts out / bad connection',
    spatialImageJa: '繋がっていた音声がバラバラの破片に砕け散る(break up)イメージ',
    examples: [
      'Sorry, you are breaking up a bit. （ごめん、ちょっと電波が悪くて声が途切れてる）',
      'The signal broke up in the tunnel. （トンネルの中で電波が途切れた）',
    ],
  },
  {
    pattern: /\btry\s+(?:this|that|it|[a-z]+\s+[a-z]+)\s+on\b/i,
    chunkPhrase: 'try ~ on',
    easyEnglish: '= wear ~ to check the size',
    spatialImageJa: '服や靴を自分の体の上に接触(on)させて試す(try)動き',
    examples: [
      'Can I try these shoes on? （この靴を試し履きしてもいいですか？）',
      'Try it on before you buy it. （買う前に一度試着してみなよ）',
    ],
  },
  {
    pattern: /\bget(?:ting|s|got)?\s+off\b/i,
    chunkPhrase: 'get off (at ~)',
    easyEnglish: '= leave the train / bus / work',
    spatialImageJa: '乗っていた車体や拘束から足を離して(off)外へ出る動き',
    examples: [
      'What time do you get off work today? （今日は何時に仕事が終わる［上がる］の？）',
      'Let us get off at Shibuya station. （渋谷駅で降りよう）',
    ],
  },
  {
    pattern: /\bpull(?:ed|s|ing)?\s+off\b/i,
    chunkPhrase: 'pull off ~',
    easyEnglish: '= succeed in doing something hard',
    spatialImageJa: '難しい状況から勝利や成功をグイッと引き抜いて(pull off)達成する感覚',
    examples: [
      'How did you pull off that deal? （どうやってあの難しい契約をまとめ上げたの？）',
      'We pulled off a last-minute win. （土壇場で逆転勝利をやってのけた）',
    ],
  },
  {
    pattern: /\b(?:come|came|coming)\s+up\s+with\b/i,
    chunkPhrase: 'come up with ~',
    easyEnglish: '= produce / create (an idea or play)',
    spatialImageJa: '水面下からアイデアやビッグプレーを携えて(with)浮上(come up)してくる動き',
    examples: [
      'She came up with a brilliant plan. （彼女が素晴らしい打開策を思いついた）',
      'We need to come up with a better solution. （もっと良い解決策をひねり出さないと）',
    ],
  },
  {
    pattern: /\bkeep\s+you\s+posted\b/i,
    chunkPhrase: 'keep you posted',
    easyEnglish: '= send you the latest updates',
    spatialImageJa: '掲示板(post)の最新情報に相手を常に触れさせ続ける(keep)イメージ',
    examples: [
      'Keep me posted on how it goes! （どうなったか随時教えてね！）',
      'I will keep the team posted. （チーム全員に進捗を共有し続けます）',
    ],
  },
  {
    pattern: /\b(?:take|taking|took)\s+over\b/i,
    chunkPhrase: 'take over ~',
    easyEnglish: '= take control of ~',
    spatialImageJa: '全体の上(over)に手を被せて主導権を自分の手に奪い取る(take)動き',
    examples: [
      'Can you take over driving for a while? （少し運転を代わって［引き継いで］くれる？）',
      'She took over the project last month. （先月から彼女がその案件を引き継いだ）',
    ],
  },
  {
    pattern: /\block(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'lock down ~',
    easyEnglish: '= completely block / finalize',
    spatialImageJa: '上からガチッと鍵をかけて(lock)動かないように固める(down)イメージ',
    examples: [
      'Let us lock down the schedule today. （今日中にスケジュールを確定させよう）',
      'Their defense locked down the perimeter. （彼らの守備が外周を完全に封じた）',
    ],
  },
  {
    pattern: /\bknock(?:ed|s|ing)?\s+down\b/i,
    chunkPhrase: 'knock down ~',
    easyEnglish: '= hit / finish off cleanly',
    spatialImageJa: 'ターゲットやタスクを上からスパッと撃ち抜いて片付ける(knock down)感覚',
    examples: [
      'He knocked down two threes in a row. （彼は2本連続でスリーを沈めた）',
      'Let us knock down these tasks before lunch. （昼前にこのタスクを片付けちゃおう）',
    ],
  },
  {
    pattern: /\b(?:hold|held)\s+up\b/i,
    chunkPhrase: 'get held up',
    easyEnglish: '= get delayed / stuck',
    spatialImageJa: '渋滞や急用にガシッと掴まれて(held)進行を止められている(up)状態',
    examples: [
      'Sorry, I got held up at a meeting. （ごめん、会議が長引いて捕まってました）',
      'The train was held up by signal trouble. （電車が信号トラブルで足止めされた）',
    ],
  },
  {
    pattern: /\btake\s+care\s+of\b/i,
    chunkPhrase: 'take care of ~',
    easyEnglish: '= handle / deal with ~',
    spatialImageJa: 'その案件を自分の手元に引き取って責任を持って処理する塊',
    examples: [
      'Do not worry, I will take care of the reservation. （心配しないで、予約は私がやっておくよ）',
      'Can you take care of this email? （このメールの対応をお願いできる？）',
    ],
  },
  {
    pattern: /\brun\s+this\s+idea\s+by\b/i,
    chunkPhrase: 'run ~ by you',
    easyEnglish: '= tell you ~ to get your opinion',
    spatialImageJa: '自分のアイデアを相手の目の前(by you)にサッと走らせて(run)反応を見る動き',
    examples: [
      'Let me run the numbers by my boss first. （まず上司にこの数字を通して確認してみるよ）',
      'I wanted to run a quick question by you. （ちょっと1つだけ相談［確認］したくて）',
    ],
  },
  {
    pattern: /\bhead(?:ing|ed|s)?\s+(?:back|out)\b/i,
    chunkPhrase: 'head back / head out',
    easyEnglish: '= return / leave now',
    spatialImageJa: '頭(head)の向きを帰り道(back)や外(out)へくるっと向けて歩き出す動き',
    examples: [
      'We should head back before it gets dark. （暗くなる前に戻ろう）',
      'I am heading out for lunch now. （今からランチに出てきます）',
    ],
  },
  {
    pattern: /\bmanaged\s+to\b/i,
    chunkPhrase: 'manage to + 動詞',
    easyEnglish: '= succeed in doing (even though it was close)',
    spatialImageJa: 'ギリギリ・苦労しながらも「なんとかやりくりして〜できた」を表す必須チャンク',
    examples: [
      'I managed to finish it before the deadline. （締め切り前になんとか終わらせられた）',
      'We managed to get the last table. （ギリギリ最後の1席を確保できた）',
    ],
  },
  {
    pattern: /\bdouble\s+check\b/i,
    chunkPhrase: 'double check ~',
    easyEnglish: '= check one more time to be sure',
    spatialImageJa: 'ミスがないように念のためもう一度重ねて確認するアクション',
    examples: [
      'Let me double check the room number. （部屋番号を念のためもう一度確認するね）',
      'Could you double check this document? （この書類を二重チェックしてもらえますか？）',
    ],
  },
];

/**
 * 英文に含まれる重要な慣用句・句動詞・コロケーションを検出し、
 * 「塊チャンク × 簡単な英語イコール（英英言い換え） × 空間コアイメージ × 応用例文」を返す
 */
export function spotIdiomAnchor(enText: string): IdiomAnchor | null {
  const cleaned = enText.trim();
  for (const rule of IDIOM_RULES) {
    if (rule.pattern.test(cleaned)) {
      return {
        chunkPhrase: rule.chunkPhrase,
        easyEnglish: rule.easyEnglish,
        spatialImageJa: rule.spatialImageJa,
        examples: rule.examples,
      };
    }
  }
  return null;
}
