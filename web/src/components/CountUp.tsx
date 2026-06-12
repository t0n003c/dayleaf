import { useEffect, useRef, useState } from 'react';

// Numbers tick up to their value with an ease-out curve. Instant under
// prefers-reduced-motion.
export default function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(() => (reduced ? value : 0));
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(frame);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{shown}</>;
}
