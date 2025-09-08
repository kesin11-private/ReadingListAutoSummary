import { beforeEach, describe, expect, it, vi } from "vitest";

describe("alarm.setupAlarm", () => {
  const mockChromeAlarms = {
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      alarms: mockChromeAlarms,
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome);
  });

  it("保存された実行間隔を使用してアラームを設定する", async () => {
    // getSettings をモック
    vi.doMock("../../src/common/chrome_storage", () => ({
      getSettings: async () => ({
        alarmIntervalMinutes: 15,
        daysUntilRead: 30,
        daysUntilDelete: -1,
      }),
      validateSettings: (_s: unknown) => [],
      DEFAULT_INTERVAL_MINUTES: 720,
    }));

    // 再インポートしてモック反映
    const { setupAlarm: setup } = await import("../../src/backend/alarm");

    await setup();

    expect(mockChromeAlarms.clear).toHaveBeenCalledWith(
      "readingListAutoProcess",
    );
    expect(mockChromeAlarms.create).toHaveBeenCalledWith(
      "readingListAutoProcess",
      {
        delayInMinutes: 1,
        periodInMinutes: 15,
      },
    );
  });

  it("不正な間隔や取得失敗時はデフォルト720分を使用する", async () => {
    vi.doMock("../../src/common/chrome_storage", () => ({
      getSettings: async () => ({
        alarmIntervalMinutes: 0,
        daysUntilRead: 30,
        daysUntilDelete: -1,
      }),
      validateSettings: (_s: unknown) => ["invalid"],
      DEFAULT_INTERVAL_MINUTES: 720,
    }));

    const { setupAlarm: setup } = await import("../../src/backend/alarm");

    await setup();

    expect(mockChromeAlarms.create).toHaveBeenCalledWith(
      "readingListAutoProcess",
      {
        delayInMinutes: 1,
        periodInMinutes: 720,
      },
    );
  });
});
