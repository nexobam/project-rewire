// スクロール連動リビールコンポーネント（フェイルセーフ付き・一度表示後は消さずチラつきを防止）

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
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof IntersectionObserver === 'undefined') return true;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (isVisible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const target = containerRef.current;
    if (!target) {
      setIsVisible(true);
      return;
    }

    // 巨大コンテナやiOS Safari環境でも絶対に透明のまま固まらないようフェイルセーフを設ける
    const failsafeId = window.setTimeout(() => {
      setIsVisible(true);
    }, 350 + delayMs);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(entry.target);
            window.clearTimeout(failsafeId);
          }
        }
      },
      {
        threshold: 0,
        rootMargin: '80px 0px 80px 0px',
      }
    );

    observer.observe(target);
    return () => {
      window.clearTimeout(failsafeId);
      observer.disconnect();
    };
  }, [delayMs, isVisible]);

  return (
    <div
      ref={containerRef}
      style={{ transitionDelay: isVisible ? `${delayMs}ms` : '0ms' }}
      className={`reveal-item reveal-from-bottom ${isVisible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
};
