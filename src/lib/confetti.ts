import confetti from 'canvas-confetti';

const colors = ['#3B82F6', '#1B2559', '#60A5FA', '#93C5FD', '#FBBF24', '#F59E0B', '#10B981', '#8B5CF6'];

// The default instance of canvas-confetti draws in a web worker that is made from a blob: address. The content security policy of the site does not allow that,
// so the confetti never showed and every use was reported to the administrators as an error. This instance draws on the page itself.
let cannon: ReturnType<typeof confetti.create> | null = null;
function getCannon() {
  if (!cannon) {
    cannon = confetti.create(null as unknown as HTMLCanvasElement, { resize: true, useWorker: false });
  }
  return cannon;
}

export function fireConfetti() {
  const fire = getCannon();
  const duration = 4500;
  const end = Date.now() + duration;

  // Big center burst
  fire({
    particleCount: 150,
    spread: 120,
    startVelocity: 45,
    origin: { y: 0.55 },
    colors,
    scalar: 1.2,
  });

  // Delayed secondary bursts from sides
  setTimeout(() => {
    fire({
      particleCount: 80,
      angle: 60,
      spread: 80,
      startVelocity: 55,
      origin: { x: 0, y: 0.65 },
      colors,
    });
    fire({
      particleCount: 80,
      angle: 120,
      spread: 80,
      startVelocity: 55,
      origin: { x: 1, y: 0.65 },
      colors,
    });
  }, 300);

  // Star-shaped burst from top
  setTimeout(() => {
    fire({
      particleCount: 60,
      spread: 360,
      startVelocity: 30,
      origin: { x: 0.5, y: 0.2 },
      colors,
      ticks: 200,
      gravity: 0.8,
    });
  }, 700);

  // Continuous streams from both sides
  const frame = () => {
    fire({
      particleCount: 4,
      angle: 60,
      spread: 60,
      startVelocity: 40,
      origin: { x: 0, y: 0.7 },
      colors,
      ticks: 150,
    });
    fire({
      particleCount: 4,
      angle: 120,
      spread: 60,
      startVelocity: 40,
      origin: { x: 1, y: 0.7 },
      colors,
      ticks: 150,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };

  frame();

  // Final big burst at the end
  setTimeout(() => {
    fire({
      particleCount: 100,
      spread: 160,
      startVelocity: 35,
      origin: { y: 0.7 },
      colors,
      scalar: 1.3,
    });
  }, duration - 800);
}
