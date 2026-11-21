// PCキーボード操作フック（1〜9：ブロック選択、Backspace：1つ戻す、Space：リプレイ）（要件7）

import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  enabled: boolean;
  onSelectNumber?: (indexZeroBased: number) => void;
  onBackspace?: () => void;
  onReplay?: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const { enabled, onSelectNumber, onBackspace, onReplay } = handlers;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // input / textarea フォーカス時はショートカットを無効化
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key >= '1' && event.key <= '9') {
        const idx = parseInt(event.key, 10) - 1;
        if (onSelectNumber) {
          event.preventDefault();
          onSelectNumber(idx);
        }
        return;
      }

      if (event.key === 'Backspace') {
        if (onBackspace) {
          event.preventDefault();
          onBackspace();
        }
        return;
      }

      if (event.key === ' ' || event.code === 'Space') {
        if (onReplay) {
          event.preventDefault();
          onReplay();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onSelectNumber, onBackspace, onReplay]);
}
