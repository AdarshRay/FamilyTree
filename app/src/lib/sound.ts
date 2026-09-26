/**
 * Synthesized UI sound effects (Web Audio API — no audio files needed).
 * Tuned for a JARVIS/HUD feel rather than a flat arcade "beep": each tone
 * is filtered (low-pass, for a glassy/holographic timbre) and layered with
 * a quiet octave harmonic for a bit of shimmer, and the click sound is a
 * two-note ascending "confirm" chime rather than a single blip.
 *
 * All failures are swallowed silently: sound is a nice-to-have, and
 * browsers block audio until a user gesture anyway (so the very first
 * hover before any click may be silent — expected).
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  /** Seconds from "now" to start this tone — lets a caller stack notes into a chime. */
  start?: number;
  from: number;
  to?: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  /** Low-pass cutoff — lower = softer/more "muffled-glass", higher = brighter. */
  filterFreq?: number;
  /** Quiet overtone at `from * harmonic` for a bit of holographic shimmer. Omit for none. */
  harmonic?: number;
}

function playTone(c: AudioContext, opts: ToneOpts) {
  try {
    const { start = 0, from, to, duration, type = "sine", volume = 0.05, filterFreq = 3200, harmonic } = opts;
    const t0 = c.currentTime + start;
    const tEnd = t0 + duration;

    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.Q.value = 0.7;

    const master = c.createGain();
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(volume, t0 + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    filter.connect(master);
    master.connect(c.destination);

    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, tEnd);
    osc.connect(filter);
    osc.start(t0);
    osc.stop(tEnd + 0.05);

    if (harmonic) {
      const shimmer = c.createOscillator();
      shimmer.type = "sine";
      const shimmerGain = c.createGain();
      shimmerGain.gain.value = 0.3; // quieter than the fundamental
      shimmer.frequency.setValueAtTime(from * harmonic, t0);
      if (to) shimmer.frequency.exponentialRampToValueAtTime(to * harmonic, tEnd);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(filter);
      shimmer.start(t0);
      shimmer.stop(tEnd + 0.05);
    }
  } catch {
    /* ignore — sound is cosmetic */
  }
}

/** Soft, filtered tick with a touch of shimmer — fires once per NEW hovered card, never spammy. */
export function playHoverSound() {
  const c = getCtx();
  if (!c) return;
  playTone(c, { from: 1600, to: 1950, duration: 0.05, type: "sine", volume: 0.016, filterFreq: 3400, harmonic: 2 });
}

/** Two-note ascending "confirm" chime (a filtered, layered rising fifth) for a deliberate click/tap. */
export function playClickSound() {
  const c = getCtx();
  if (!c) return;
  playTone(c, { from: 740, to: 760, duration: 0.06, type: "triangle", volume: 0.05, filterFreq: 2600, harmonic: 2 });
  playTone(c, {
    start: 0.045,
    from: 1108,
    to: 1130,
    duration: 0.1,
    type: "triangle",
    volume: 0.045,
    filterFreq: 3600,
    harmonic: 2,
  });
}
