// Build the ffmpeg `-vf` filter chain for camera orientation. Shared by the ring
// buffer (recording) and the live preview so the preview matches what's recorded.
//
// ffmpeg can only filter when it re-encodes — `-c copy` carries raw packets, so
// rotation/flip are impossible there (and `copy` is unusable on the box anyway:
// the camera emits no PTS, so segments mis-slice). For "copy" we return [].

import type { Config } from "@shared/types.js";

/** transpose=1 = 90° clockwise, transpose=2 = 90° counter-clockwise. */
function rotationFilters(rotation: Config["webcam"]["rotation"]): string[] {
  switch (rotation) {
    case 90:
      return ["transpose=1"];
    case 270:
      return ["transpose=2"];
    case 180:
      return ["hflip", "vflip"];
    default:
      return [];
  }
}

/** The raw filter names (e.g. ["transpose=1", "hflip"]) for the orientation,
 * regardless of encoder. Rotation is applied before flips. */
export function orientationChain(webcam: Config["webcam"]): string[] {
  const chain = [...rotationFilters(webcam.rotation)];
  if (webcam.flipH) chain.push("hflip");
  if (webcam.flipV) chain.push("vflip");
  return chain;
}

/** Wrap a filter chain as ffmpeg `-vf` args, or [] when there's nothing to apply. */
export function vfArgs(chain: string[]): string[] {
  return chain.length ? ["-vf", chain.join(",")] : [];
}

/**
 * Recording filter args: either [] (no orientation change, or encoder can't filter)
 * or ["-vf", "<comma-joined chain>"]. "copy" can't filter, so it gets [].
 */
export function videoFilters(webcam: Config["webcam"]): string[] {
  if (webcam.encoder === "copy") return [];
  return vfArgs(orientationChain(webcam));
}
