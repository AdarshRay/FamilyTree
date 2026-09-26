import { useMemo } from "react";

/** Ambient drifting arc-reactor motes for the obsidian backdrop. */
export function Particles() {
  const items = useMemo(
    () =>
      Array.from({ length: 26 }, () => ({
        left: Math.random() * 100,
        dur: 14 + Math.random() * 22,
        delay: -Math.random() * 30,
        size: 1 + Math.random() * 2.5,
        op: 0.25 + Math.random() * 0.5,
      })),
    [],
  );

  return (
    <div className="bg-layer">
      {items.map((p, i) => (
        <span
          key={i}
          className="particle"
          style={{
            left: `${p.left}%`,
            bottom: "-10px",
            width: p.size,
            height: p.size,
            opacity: p.op,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
