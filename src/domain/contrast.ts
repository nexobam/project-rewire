// カラートークン定義およびWCAG AA（4.5:1以上）コントラスト比検証ロジック

export interface ThemePalette {
  background: string;
  card: string;
  border: string;
  text: string;
  greenText?: string;
  amberText?: string;
  amberSurface?: string;
  amberSurfaceText?: string;
  crimsonText?: string;
}

export const THEME_PALETTES: Record<'light' | 'dark' | 'sleep', ThemePalette> = {
  light: {
    background: '#F7F6F2',
    card: '#FFFFFF',
    border: '#E5E3DC',
    text: '#1C1917',
    greenText: '#15803D',
    amberText: '#B45309',
    amberSurface: '#D97706',
    amberSurfaceText: '#1C1917',
    crimsonText: '#BE123C',
  },
  dark: {
    background: '#141416',
    card: '#1E1E22',
    border: '#2E2E34',
    text: '#E7E5E4',
    greenText: '#4D9E6E',
    amberText: '#D4A04A',
    amberSurface: '#D4A04A',
    amberSurfaceText: '#1C1917',
    crimsonText: '#D9546E',
  },
  sleep: {
    background: '#140F0A',
    card: '#1C150E',
    border: '#2A2016',
    text: '#D97706',
  },
};

/**
 * 16進カラーコード（#RRGGBB）をRGB（0〜255）に変換
 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * WCAG 2.1 相対輝度（Relative Luminance）を計算する
 */
export function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 2つの16進カラーコード間のコントラスト比（1.0〜21.0）を計算する
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * 文字色と背景色の組み合わせが WCAG AA（4.5:1以上）を満たすか判定する
 */
export function meetsWcagAA(foregroundHex: string, backgroundHex: string): boolean {
  return getContrastRatio(foregroundHex, backgroundHex) >= 4.5;
}
