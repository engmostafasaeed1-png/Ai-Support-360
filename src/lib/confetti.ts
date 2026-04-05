import confetti from 'canvas-confetti';

const colors = ['#3B82F6', '#1B2559', '#60A5FA', '#93C5FD', '#FBBF24', '#F59E0B', '#10B981', '#8B5CF6'];

export function fireConfetti() {
  const duration = 4500;
  const end = Date.now() + duration;

  // Big center burst
  confetti({
    particleCount: 150,
    spread: 120,
    startVelocity: 45,
    origin: { y: 0.55 },
    colors,
    scalar: 1.2,
  });

  // Delayed secondary bursts from sides
  setTimeout(() => {
    confetti({
      particleCount: 80,
      angle: 60,
      spread: 80,
      startVelocity: 55,
      origin: { x: 0, y: 0.65 },
      colors,
    });
    confetti({
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
    confetti({
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
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 60,
      startVelocity: 40,
      origin: { x: 0, y: 0.7 },
      colors,
      ticks: 150,
    });
    confetti({
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
    confetti({
      particleCount: 100,
      spread: 160,
      startVelocity: 35,
      origin: { y: 0.7 },
      colors,
      scalar: 1.3,
    });
  }, duration - 800);
}
