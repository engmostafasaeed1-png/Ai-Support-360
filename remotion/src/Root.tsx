import { Composition } from 'remotion';
import { MainVideo, FPS, DURATION_IN_FRAMES } from './MainVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="main"
      component={MainVideo}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={1024}
      height={1280}
    />
  );
};
