// A small flutter of leaves when an entry is saved. Imperative DOM so it can
// outlive any re-render; removed after the animation completes.
const LEAVES = ['🍃', '🌿', '🍂'];

export function leafBurst() {
  try { navigator.vibrate?.(15); } catch {} // gentle haptic where supported
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.className = 'leaf-burst';
  for (let i = 0; i < 9; i++) {
    const leaf = document.createElement('span');
    leaf.textContent = LEAVES[i % 3];
    leaf.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 150}px`);
    leaf.style.setProperty('--dy', `${-(70 + Math.random() * 170)}px`);
    leaf.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 240}deg`);
    leaf.style.animationDelay = `${i * 28}ms`;
    host.appendChild(leaf);
  }
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 1500);
}
