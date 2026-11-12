import { describe, expect, it } from "vitest";
import { describeDevice } from "@/lib/device-label";

describe("device label sent at sign-in (shown in the device list)", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
      "Chrome di Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari di iPhone",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0",
      "Edge di Windows",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox di Linux"],
    ["", "Perangkat baru"],
  ])("%s", (ua, label) => expect(describeDevice(ua)).toBe(label));
});
