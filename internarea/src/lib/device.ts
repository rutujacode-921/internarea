// Identifies this browser to the server and collects the details the server
// uses for Login History (device model, Windows 11, laptop vs desktop).

const DEVICE_KEY = "internarea.deviceId";
let memoryDeviceId: string | null = null;

const randomId = (bytes = 18) => {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
};

// A random id kept in this browser's storage. A different browser, a private
// window or cleared site data gets a new id, and so counts as a new device.
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked: keep one id for as long as this tab is open.
    memoryDeviceId = memoryDeviceId || randomId();
    return memoryDeviceId;
  }
}

// One id per press of "Log in": the server treats a retry with the same id
// (double click, resend after a dropped connection) as the same request.
export const newRequestId = () => randomId(16);

interface UADataBrand {
  brand: string;
  version: string;
}
interface NavigatorUAData {
  brands?: UADataBrand[];
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}
interface BatteryManagerLike {
  charging: boolean;
  level: number;
  chargingTime: number;
  dischargingTime: number;
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

export interface ClientHints {
  deviceId: string;
  uaData?: Record<string, unknown>;
  battery?: { present: boolean; charging?: boolean; level?: number; chargingTime?: number | null };
  touchPoints?: number;
  brave?: boolean;
}

// Best-effort: every part is optional and the whole thing gives up after a moment.
export async function collectClientHints(): Promise<ClientHints> {
  const hints: ClientHints = { deviceId: getDeviceId() };
  if (typeof navigator === "undefined") return hints;
  const nav = navigator as Navigator & {
    userAgentData?: NavigatorUAData;
    getBattery?: () => Promise<BatteryManagerLike>;
    brave?: unknown;
  };
  hints.touchPoints = nav.maxTouchPoints || 0;
  hints.brave = Boolean(nav.brave);

  const uaData = nav.userAgentData;
  if (uaData) {
    hints.uaData = { brands: uaData.brands, mobile: uaData.mobile };
    if (uaData.getHighEntropyValues) {
      const high = await withTimeout(uaData.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]), 800);
      if (high) hints.uaData = { ...hints.uaData, ...high };
    }
  }

  if (nav.getBattery) {
    const battery = await withTimeout(nav.getBattery(), 800);
    hints.battery = battery
      ? {
          present: true,
          charging: battery.charging,
          level: battery.level,
          chargingTime: Number.isFinite(battery.chargingTime) ? battery.chargingTime : null,
        }
      : { present: false };
  }
  return hints;
}
