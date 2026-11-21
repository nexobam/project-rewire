// 初期同梱シードデータの集約ローダー（src/data/seed/*.json から読み込み）

import type { Chunk } from '../../types';
import lv0Data from './lv0_diagnosis.json';
import lv1Data from './lv1_core.json';
import lv2Data from './lv2_sample.json';
import lv3Data from './lv3_sample.json';
import lv4Data from './lv4_sample.json';

export const LV0_DIAGNOSIS_CHUNKS: Chunk[] = lv0Data as unknown as Chunk[];
export const LV1_CORE_CHUNKS: Chunk[] = lv1Data as unknown as Chunk[];
export const LV2_SAMPLE_CHUNKS: Chunk[] = lv2Data as unknown as Chunk[];
export const LV3_SAMPLE_CHUNKS: Chunk[] = lv3Data as unknown as Chunk[];
export const LV4_SAMPLE_CHUNKS: Chunk[] = lv4Data as unknown as Chunk[];

export const ALL_SEED_CHUNKS: Chunk[] = [
  ...LV0_DIAGNOSIS_CHUNKS,
  ...LV1_CORE_CHUNKS,
  ...LV2_SAMPLE_CHUNKS,
  ...LV3_SAMPLE_CHUNKS,
  ...LV4_SAMPLE_CHUNKS,
];
