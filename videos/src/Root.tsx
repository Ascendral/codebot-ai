import { Composition } from 'remotion';
import { CodeBotPromo } from './CodeBotPromo';
import { HashChainShort } from './HashChainShort';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CodeBotPromo"
        component={CodeBotPromo}
        durationInFrames={30 * 45}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="HashChainShort"
        component={HashChainShort}
        durationInFrames={1170}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
