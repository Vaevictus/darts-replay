import { memo, useMemo } from "react";
import { buildBoardSvg, type BoardOptions } from "@shared/dartboard.js";
import type { Dart } from "@shared/types.js";

export const Dartboard = memo(function Dartboard({
  darts,
  className,
  options,
}: {
  darts: Dart[];
  className?: string;
  options?: BoardOptions;
}) {
  const svg = useMemo(() => buildBoardSvg(darts, options), [darts, options]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
});
