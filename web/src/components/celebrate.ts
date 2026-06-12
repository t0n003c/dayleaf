// A small flutter of leaves when an entry is saved — and a bigger one for
// streak milestones. Imperative DOM so it can outlive any re-render.
const LEAVES = ['🍃', '🌿', '🍂'];

export function leafBurst(opts: { count?: number; center?: boolean } = {}) {
  try { navigator.vibrate?.(opts.center ? [30, 60, 30] : 15); } catch {} // gentle haptic where supported
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.className = 'leaf-burst' + (opts.center ? ' center' : '');
  const count = opts.count ?? 9;
  const spread = opts.center ? 230 : 150;
  for (let i = 0; i < count; i++) {
    const leaf = document.createElement('span');
    leaf.textContent = LEAVES[i % 3];
    leaf.style.setProperty('--dx', `${(Math.random() * 2 - 1) * spread}px`);
    leaf.style.setProperty('--dy', `${(opts.center ? (Math.random() * 2 - 1) * 200 : -(70 + Math.random() * 170))}px`);
    leaf.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 240}deg`);
    leaf.style.animationDelay = `${i * 24}ms`;
    host.appendChild(leaf);
  }
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 1600);
}

export function milestoneMoment() {
  leafBurst({ count: 20, center: true });
}
