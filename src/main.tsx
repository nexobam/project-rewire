// エントリーポイント（英語フォント Inter 400/600/700 バンドル読み込み・要件7）

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import { App } from './App';

// PWA Service Worker 更新検知（初回インストール時の強制リロード防止＆学習セッション中の中断防止）
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    const win = window as unknown as {
      __rewireSessionActive?: boolean;
      __rewirePendingReload?: boolean;
    };
    if (win.__rewireSessionActive) {
      win.__rewirePendingReload = true;
      return;
    }
    refreshing = true;
    window.location.reload();
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
