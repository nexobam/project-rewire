// 双方向スクロール連動リビールコンポーネント（下スクロール・上スクロールの両方で画面内に入るたびに滑らかに表示）

import React, { useEffect, useRef, useState } from 'react';

export interface ScrollRevealProps {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
}

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  delayMs = 0,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(
    () => typeof IntersectionObserver === 'undefined'
  );
  const [enterFrom, setEnterFrom] = useState<'bottom' | 'top'>('bottom');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const target = containerRef.current;
    if (!target) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
          } else {
            // 画面高を大きく超える巨大要素が透明で取り残されるのを防ぎつつ、通常カードは上下双方向で再アニメーションさせる
            const viewportH =
              typeof window !== 'undefined' ? window.innerHeight : 800;
            if (entry.boundingClientRect.height < viewportH * 1.5) {
              const rectTop = entry.boundingClientRect.top;
              setEnterFrom(rectTop < 0 ? 'top' : 'bottom');
              setIsVisible(false);
            }
          }
        }
      },
      {
        threshold: 0.01,
        rootMargin: '0px 0px -10px 0px',
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const directionClass =
    enterFrom === 'top' ? 'reveal-from-top' : 'reveal-from-bottom';

  return (
    <div
      ref={containerRef}
      style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
      className={`reveal-item ${directionClass} ${isVisible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
};
