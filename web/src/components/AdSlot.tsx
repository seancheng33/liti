import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * Google AdSense 广告位。
 * 脚本加载器在 index.html 里全局引入一次（与主站「三的小角落」同一个广告账号），
 * 这个组件只负责渲染 <ins> 并在挂载后 push 一次。
 *
 * push 包 try/catch：访客到不了 Google（脚本没加载）或者广告位已被填充时，
 * AdSense 会抛错——不能让一个广告把页面搞崩。
 */
export default function AdSlot({
  slot,
  format = 'auto',
  style,
}: {
  slot: string;
  format?: string;
  style?: React.CSSProperties;
}) {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    const timer = setTimeout(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // 广告脚本没就绪就算了，页面照常
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block', ...style }}
      data-ad-client="ca-pub-8510698019640343"
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
