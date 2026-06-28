import { describe, it, expect } from "vitest";
import { orientationChain, videoFilters } from "../server/src/recorder/filters.js";
import { DEFAULT_CONFIG } from "../server/src/config.js";
import type { Config } from "../shared/types.js";

const webcam = (over: Partial<Config["webcam"]>): Config["webcam"] => ({ ...DEFAULT_CONFIG.webcam, ...over });

describe("orientationChain", () => {
  it("is empty with no rotation or flip", () => {
    expect(orientationChain(webcam({}))).toEqual([]);
  });

  it("maps quarter-turns to transpose filters", () => {
    expect(orientationChain(webcam({ rotation: 90 }))).toEqual(["transpose=1"]);
    expect(orientationChain(webcam({ rotation: 270 }))).toEqual(["transpose=2"]);
    expect(orientationChain(webcam({ rotation: 180 }))).toEqual(["hflip", "vflip"]);
  });

  it("appends flips after rotation", () => {
    expect(orientationChain(webcam({ rotation: 90, flipH: true }))).toEqual(["transpose=1", "hflip"]);
    expect(orientationChain(webcam({ flipH: true, flipV: true }))).toEqual(["hflip", "vflip"]);
  });
});

describe("videoFilters", () => {
  it("wraps the chain in a -vf arg pair", () => {
    expect(videoFilters(webcam({ rotation: 90 }))).toEqual(["-vf", "transpose=1"]);
    expect(videoFilters(webcam({ rotation: 90, flipV: true }))).toEqual(["-vf", "transpose=1,vflip"]);
  });

  it("returns [] when there's nothing to do", () => {
    expect(videoFilters(webcam({}))).toEqual([]);
  });

  it("returns [] for the copy encoder, which can't filter", () => {
    expect(videoFilters(webcam({ rotation: 90, encoder: "copy" }))).toEqual([]);
  });
});
