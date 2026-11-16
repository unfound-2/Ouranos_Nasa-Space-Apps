import { Composition } from "remotion";
import { Ouranos } from "./Ouranos";
import { FPS, TOTAL } from "./timeline";

export const Root = () => (
  <Composition id="Ouranos" component={Ouranos} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
);
