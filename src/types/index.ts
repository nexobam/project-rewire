// Project Rewire 共通型定義（要件6-1 + 承認済み補助フィールド）

export type Level = 0 | 1 | 2 | 3 | 4;
export type Rating = 'green' | 'yellow' | 'red';
export type ExerciseType =
  | 'picture_choice'
  | 'sound_change'
  | 'word_order'
  | 'speak'
  | 'chunk_building'
  | 'paraphrase'
  | 'listening_long';

// 状況ビジュアルカード用アイコンホワイトリスト（60種・lucide-react実在確認済み）
export const ICON_WHITELIST = [
  'Coffee',
  'Briefcase',
  'Trophy',
  'Flame',
  'Clock',
  'MapPin',
  'User',
  'Users',
  'MessageSquare',
  'Phone',
  'Mail',
  'Calendar',
  'ShoppingBag',
  'CreditCard',
  'Utensils',
  'Train',
  'Plane',
  'Car',
  'Home',
  'Building',
  'Laptop',
  'Smartphone',
  'Headphones',
  'Music',
  'Tv',
  'Camera',
  'BookOpen',
  'FileText',
  'PenTool',
  'Search',
  'Bell',
  'Heart',
  'Star',
  'ThumbsUp',
  'AlertCircle',
  'HelpCircle',
  'CheckCircle',
  'XCircle',
  'Zap',
  'Sun',
  'Moon',
  'CloudRain',
  'Wind',
  'Umbrella',
  'Thermometer',
  'Activity',
  'Award',
  'Target',
  'Flag',
  'Compass',
  'Navigation',
  'Key',
  'Lock',
  'Unlock',
  'Shield',
  'Gift',
  'Package',
  'Truck',
  'Wrench',
  'Settings',
] as const;

export type IconName = (typeof ICON_WHITELIST)[number];

export const DEFAULT_ICON: IconName = 'MessageSquare';

export interface Block {
  id: string;
  text: string;
}

export interface Chunk {
  id: string;
  level: Level;
  contentCategory: 'daily' | 'heat';
  sceneCategory: string;
  grammarPattern: string;
  enText: string;
  blocks: Block[];
  acceptableOrders: string[][];
  speakOnly: boolean;
  visual: {
    icons: [IconName, IconName];
    tags: [string, string, string];
  };
  coreImageJa: string;
  pronunciationTip: string;
  hasSoundChange: boolean;
  source: 'seed' | 'ai' | 'recomposed' | 'live';
  isCore: boolean;
  disabled: boolean;
  createdAt: string;
  // 補助フィールド（発話プロンプト・Lv.3 NGワード・音変化選択肢）
  promptAudioText?: string;
  ngWords?: string[];
  soundChangeChoices?: string[];
}

export interface ReviewState {
  chunkId: string;
  stage: 0 | 1 | 2 | 3 | 4;
  dueDate: string;
  graduated: boolean;
  spotCheckDate?: string;
  recentRatings: Rating[];
  // 昇格ゲート①用：語順ブロック形式（word_order）だけの評価履歴
  wordOrderRatings?: Rating[];
}

export interface Attempt {
  id: string;
  chunkId: string;
  sessionId: string;
  exerciseType: ExerciseType;
  studyDate: string;
  startedAt: number;
  reactionMs: number | null;
  completionMs: number | null;
  replayBeforeShown: number;
  replayAfterShown: number;
  rating: Rating;
  missType?: 'sound_change' | 'order_delay' | 'speech_block';
  inputMode: 'silent' | 'voice';
  selfJudged: boolean;
  sttTranscript?: string;
  sttMatch?: number;
  isSleepPriming?: boolean;
}

export type SessionMode =
  | 'silent'
  | 'speak'
  | 'live'
  | 'sleep'
  | 'boss'
  | 'diagnosis'
  | 'rehab';

export interface Session {
  id: string;
  mode: SessionMode;
  plannedMinutes: number;
  activeSeconds: number;
  studyDate: string;
  startedAt: number;
  endedAt?: number;
}

export interface LiveWeakItemDetail {
  enText: string;
  whatYouWantedToSay?: string;
  yourAttempt?: string;
  coreImageJa?: string;
  pronunciationTip?: string;
  sceneTags?: string[];
}

export interface LiveLogSummary {
  durationMinutes: number;
  overallReview: string;
  goodPoints: string[];
  badPoints: string[];
  fluencyScore: number;
  weakChunks: string[];
  topicsDiscussed?: string[];
  conversationHighlights?: string;
  weakItems?: LiveWeakItemDetail[];
}

export interface AiReport {
  id: string;
  sessionId: string;
  studyDate?: string;
  status: 'pending' | 'done' | 'failed';
  retryCount: number;
  analyst?: {
    bottleneck: string;
    growth: string;
  };
  teacher?: {
    coreImage: string;
    pronunciation: string;
    praise: string;
  }[];
  liveLog?: LiveLogSummary;
  createdAt: number;
}

export interface Settings {
  schemaVersion: number;
  level: Level;
  lv1Phase: 'picture' | 'blocks';
  perTapMs: number;
  geminiApiKey?: string;
  geminiModel: string;
  dailyApiCallLimit: number;
  ttsRate: number;
  clickSound: boolean;
  themePreference: 'auto' | 'light' | 'dark';
  lastBackupAt?: number;
  restTickets: number;
  // 運用管理用補助フィールド
  apiCallDate?: string;
  apiCallCount?: number;
  bossCooldownUntil?: number;
  lastTicketRefillWeek?: string;
  lastEvaluatedStudyDate?: string;
  allEnglishMode?: boolean;
  levelPromotedAt?: number;
  firstUsedAt?: number;
}

export interface CoachMessage {
  id: string;
  question: string;
  answer?: string;
  examples?: string[];
  status: 'pending_offline' | 'answered';
  createdAt: number;
}

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  level: 0,
  lv1Phase: 'picture',
  perTapMs: 500,
  geminiModel: 'gemini-2.5-flash',
  dailyApiCallLimit: 40,
  ttsRate: 1.0,
  clickSound: true,
  themePreference: 'auto',
  restTickets: 2,
  apiCallCount: 0,
  allEnglishMode: false,
};
