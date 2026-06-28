import { describe, it, expect } from "vitest";
import { parseDevices, parseFormats } from "../server/src/cameras.js";

const LIST_DEVICES = `HD Web Camera (usb-0000:00:14.0-1):
\t/dev/video6
\t/dev/video7
\t/dev/media4

GXI-IMX179: USB Camera (usb-0000:00:14.0-2):
\t/dev/video0
\t/dev/video1
`;

const LIST_FORMATS = `ioctl: VIDIOC_ENUM_FMT
\tType: Video Capture

\t[0]: 'MJPG' (Motion-JPEG, compressed)
\t\tSize: Discrete 1920x1080
\t\t\tInterval: Discrete 0.033s (30.000 fps)
\t\t\tInterval: Discrete 0.040s (25.000 fps)
\t\tSize: Discrete 1280x720
\t\t\tInterval: Discrete 0.033s (30.000 fps)
\t[1]: 'H264' (H.264, compressed)
\t\tSize: Discrete 1920x1080
\t\t\tInterval: Discrete 0.033s (30.000 fps)
\t[2]: 'YUYV' (YUYV 4:2:2)
\t\tSize: Discrete 640x480
\t\t\tInterval: Discrete 0.200s (5.000 fps)
`;

describe("parseDevices", () => {
  it("groups /dev/video* nodes under each device name, ignoring media nodes", () => {
    const out = parseDevices(LIST_DEVICES);
    expect(out).toEqual([
      { name: "HD Web Camera (usb-0000:00:14.0-1)", nodes: ["/dev/video6", "/dev/video7"] },
      { name: "GXI-IMX179: USB Camera (usb-0000:00:14.0-2)", nodes: ["/dev/video0", "/dev/video1"] },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseDevices("")).toEqual([]);
  });
});

describe("parseFormats", () => {
  it("parses formats, discrete sizes, and framerates", () => {
    const out = parseFormats(LIST_FORMATS);
    expect(out.map((f) => f.fourcc)).toEqual(["MJPG", "H264", "YUYV"]);

    const mjpg = out[0];
    expect(mjpg.normalized).toBe("mjpeg");
    expect(mjpg.sizes).toEqual([
      { w: 1920, h: 1080, fps: [30, 25] },
      { w: 1280, h: 720, fps: [30] },
    ]);

    expect(out[1].normalized).toBe("h264");
    expect(out[2].normalized).toBe("yuyv422");
    expect(out[2].sizes[0]).toEqual({ w: 640, h: 480, fps: [5] });
  });

  it("returns [] when no formats are present", () => {
    expect(parseFormats("ioctl: VIDIOC_ENUM_FMT\n\tType: Video Capture\n")).toEqual([]);
  });
});
