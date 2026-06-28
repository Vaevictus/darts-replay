import { useMemo } from "react";
import { buildBoardSvg } from "@shared/dartboard.js";
import type { Dart } from "@shared/types.js";

export function Dartboard({ darts, className }: { darts: Dart[]; className?: string }) {
  const svg = useMemo(() => buildBoardSvg(darts), [darts]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
