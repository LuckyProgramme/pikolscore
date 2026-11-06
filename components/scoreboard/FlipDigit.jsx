'use client';

import { memo, useRef, useEffect, useLayoutEffect } from 'react';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export const FlipDigit = memo(function FlipDigit({ value, dimmed = false, className = '' }) {
  const elRef = useRef(null);
  const prevRef = useRef(undefined);
  const strVal = String(value ?? '0');

  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const sp = el.querySelectorAll('span');
    const h = el.querySelectorAll('.ps-h');
    const old = prevRef.current;

    if (old === strVal) return;
    prevRef.current = strVal;

    if (typeof el.getAnimations === 'function') {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    }

    h[2].style.visibility = 'hidden';
    h[3].style.visibility = 'hidden';

    const calm =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (old === undefined || calm || typeof h[2].animate !== 'function') {
      sp.forEach((node) => {
        node.textContent = strVal;
      });
      return;
    }

    sp[0].textContent = strVal;
    sp[1].textContent = old;
    sp[2].textContent = old;
    sp[3].textContent = strVal;

    h[2].style.visibility = 'visible';
    const foldDown = h[2].animate(
      [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
      { duration: 190, easing: 'ease-in' }
    );

    foldDown.onfinish = () => {
      h[2].style.visibility = 'hidden';
      h[3].style.visibility = 'visible';
      const unfoldBottom = h[3].animate(
        [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
        { duration: 190, easing: 'ease-out' }
      );
      unfoldBottom.onfinish = () => {
        sp[1].textContent = strVal;
        h[3].style.visibility = 'hidden';
      };
    };
  }, [strVal]);

  const spanClass = dimmed ? 'ps-digit-dimmed opacity-30' : '';

  return (
    <div
      ref={elRef}
      className={`ps-fd ${className}`.trim()}
      data-v={strVal}
      data-dimmed={dimmed ? 'true' : 'false'}
    >
      <div className="ps-h ps-t">
        <span className={spanClass}>{strVal}</span>
      </div>
      <div className="ps-h ps-b">
        <span className={spanClass}>{strVal}</span>
      </div>
      <div className="ps-h ps-ft">
        <span className={spanClass}>{strVal}</span>
      </div>
      <div className="ps-h ps-fb">
        <span className={spanClass}>{strVal}</span>
      </div>
    </div>
  );
});

export default FlipDigit;
