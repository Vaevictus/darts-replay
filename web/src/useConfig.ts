import { useEffect, useState } from "react";

/** Fetch the capture fps once (for frame-accurate stepping). Defaults to 30. */
export function useFps(): number {
  const [fps, setFps] = useState(30);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        const f = c?.webcam?.fps;
        if (typeof f === "number" && f > 0) setFps(f);
      })
      .catch(() => {});
  }, []);
  return fps;
}
