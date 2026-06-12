// Ambient falling leaves for the auth screens. Pure CSS animation; hidden
// from assistive tech and disabled by prefers-reduced-motion in styles.css.
const LEAVES = ['🍃', '🌿', '🍂'];

export default function LeafRain({ count = 10 }: { count?: number }) {
  return (
    <div className="leaf-rain" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="leaf-flake"
          style={{
            ['--left' as any]: `${(i * 97) % 100}%`,
            ['--dur' as any]: `${9 + (i % 5) * 1.8}s`,
            ['--delay' as any]: `${-(i * 1.9)}s`,
            fontSize: `${12 + (i % 4) * 3}px`,
          }}
        >
          {LEAVES[i % 3]}
        </span>
      ))}
    </div>
  );
}
