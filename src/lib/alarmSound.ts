export type AlarmHandle = { stop: () => void };

const SILENT: AlarmHandle = { stop: () => {} };

/**
 * A repeating three-tone beep made with the Web Audio API (no sound file). A browser plays sound only after the person has clicked or typed
 * on the page once; before that the beep stays silent and the visible alarm does the work. Call stop() to end it.
 */
export function startAlarm(): AlarmHandle {
  if (typeof window === 'undefined') return SILENT;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return SILENT;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return SILENT;
  }

  let stopped = false;
  const beep = (frequency: number, startAt: number, length: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.3, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + length + 0.02);
  };
  const play = () => {
    if (stopped) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.05;
    beep(880, t, 0.18);
    beep(660, t + 0.25, 0.18);
    beep(880, t + 0.5, 0.18);
  };

  play();
  const id = window.setInterval(play, 2000);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(id);
      void ctx.close().catch(() => {});
    },
  };
}
