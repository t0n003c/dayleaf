import { useEffect, useState } from 'react';

// A growth ring for the journaling streak: the ring fills toward the next
// milestone, and the leaf in the centre matures with the streak —
// sprout -> herb -> leaf -> tree. The fill sweeps in on mount.

export const MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365];

function tierEmoji(streak: number): string {
  if (streak >= 60) return '🌳';
  if (streak >= 14) return '🍃';
  if (streak >= 3) return '🌿';
  return '🌱';
}

export default function StreakRing({ streak }: { streak: number }) {
  const next = MILESTONES.find((m) => m > streak) ?? streak;
  const prev = [...MILESTONES].reverse().find((m) => m <= streak) ?? 0;
  const progress = next === streak ? 1 : Math.max(0.04, (streak - prev) / (next - prev));
  const atMilestone = prev !== 0 && streak === prev;

  const R = 19;
  const C = 2 * Math.PI * R;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`streak-ring ${atMilestone ? 'milestone' : ''}`}
      title={
        atMilestone
          ? `${streak}-day streak — milestone reached! 🎉`
          : `${streak}-day streak — next leaf at ${next} days`
      }
    >
      <svg viewBox="0 0 46 46" width="46" height="46" aria-hidden="true">
        <defs>
          <linearGradient id="streakGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-strong)" />
          </linearGradient>
        </defs>
        <circle cx="23" cy="23" r={R} fill="none" stroke="var(--border)" strokeWidth="3.5" />
        <circle
          className="ring-fg"
          cx="23" cy="23" r={R}
          fill="none"
          stroke="url(#streakGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={armed ? C * (1 - progress) : C}
          transform="rotate(-90 23 23)"
        />
      </svg>
      <div className="ring-center">
        <span className="ring-emoji">{tierEmoji(streak)}</span>
        <span className="ring-num">{streak}</span>
      </div>
    </div>
  );
}
