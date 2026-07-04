import { describe, it, expect } from "vitest";
import { captureArgs } from "../server/src/recorder/ring-buffer.js";
import { DEFAULT_CONFIG } from "../server/src/config.js";
import type { Config } from "@shared/types.js";

function cfg(over: Partial<Config["webcam"]>): Config {
  return { ...DEFAULT_CONFIG, webcam: { ...DEFAULT_CONFIG.webcam, ...over } };
}

function vfOf(args: string[]): string | undefined {
  const i = args.indexOf("-vf");
  return i === -1 ? undefined : args[i + 1];
}

describe("captureArgs", () => {
  it("emits a SINGLE -vf for vaapi with orientation before hwupload", () => {
    const args = captureArgs(cfg({ encoder: "vaapi", rotation: 90, flipH: true }));
    expect(args.filter((a) => a === "-vf").length).toBe(1); // regression: no duplicate -vf
    const vf = vfOf(args)!;
    expect(vf).toBe("transpose=1,hflip,format=nv12,hwupload");
    expect(vf.indexOf("transpose=1")).toBeLessThan(vf.indexOf("hwupload"));
    expect(args).toContain("h264_vaapi");
  });

  it("vaapi with no orientation still uploads (format,hwupload only)", () => {
    const args = captureArgs(cfg({ encoder: "vaapi", rotation: 0, flipH: false, flipV: false }));
    expect(vfOf(args)).toBe("format=nv12,hwupload");
  });

  it("x264 applies orientation as its own single -vf", () => {
    const args = captureArgs(cfg({ encoder: "x264", rotation: 270 }));
    expect(args.filter((a) => a === "-vf").length).toBe(1);
    expect(vfOf(args)).toBe("transpose=2");
    expect(args).toContain("libx264");
  });

  it("copy encoder has no -vf (raw packets can't be filtered)", () => {
    const args = captureArgs(cfg({ encoder: "copy", rotation: 90 }));
    expect(args).not.toContain("-vf");
    expect(args).toContain("copy");
  });
});
