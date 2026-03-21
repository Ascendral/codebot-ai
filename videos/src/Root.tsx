import { Composition } from "remotion";
import { CodeBotPromo } from "./CodeBotPromo";

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
    </>
  );
};
