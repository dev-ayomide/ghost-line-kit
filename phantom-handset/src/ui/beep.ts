/**
 * A tiny WebAudio beep for new messages. No audio asset. The AudioContext is created
 * only inside a user gesture (`unlock`), so nothing plays before the user interacts.
 */
export interface Beeper {
  /** Call from a click or key handler. Creates or resumes the audio context. */
  unlock(): void;
  /** Plays a short tone. Does nothing until `unlock` has run, or without WebAudio. */
  beep(): void;
}
export function createBeeper(): Beeper {
  let ctx: AudioContext | undefined;
  return {
    unlock() {
      if (typeof AudioContext === 'undefined') return;
      try {
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
      } catch {
        ctx = undefined;
      }
    },
    beep() {
      if (!ctx || ctx.state !== 'running') return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime;
        osc.type = 'square';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      } catch {
        // Sound is optional. Ignore audio failures.
      }
    },
  };
}
