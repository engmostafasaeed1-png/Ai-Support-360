import confetti from 'canvas-confetti';

export function fireConfetti() {
  const duration = 2500;
  const end = Date.now() + duration;

  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: ['#3B82F6', '#1B2559', '#60A5FA', '#93C5FD', '#FBBF24'],
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: ['#3B82F6', '#1B2559', '#60A5FA', '#93C5FD', '#FBBF24'],
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };

  // Initial burst
  confetti({
    particleCount: 80,
    spread: 100,
    origin: { y: 0.6 },
    colors: ['#3B82F6', '#1B2559', '#60A5FA', '#93C5FD', '#FBBF24'],
  });

  frame();
}
