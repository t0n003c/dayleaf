import { useEffect, useState } from 'react';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 699px)').matches);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 699px)');
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    q.addEventListener('change', fn);
    return () => q.removeEventListener('change', fn);
  }, []);
  return mobile;
}
