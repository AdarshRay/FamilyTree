export function hashStr(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function initialsOf(label: string): string {
  return (
    label
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** Deterministic on-theme hue for an avatar chip, seeded off a stable identifier (usually email). */
export function hueFor(seed: string): number {
  return 190 + (hashStr(seed) % 44) - 22;
}
