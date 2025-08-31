import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReadingListEntries,
  getSettings,
  shouldDelete,
  shouldMarkAsRead,
} from "../../src/backend/background";

// Chrome API のモック設定
const mockChromeStorageLocal = {
  get: vi.fn(),
};

const mockChromeReadingList = {
  query: vi.fn(),
};

// グローバルchrome オブジェクトのモック
beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
    readingList: mockChromeReadingList,
  });

  // コンソールログのモック（テスト時の出力を制御）
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("getSettings", () => {
  it("デフォルト設定を返す（ストレージが空の場合）", async () => {
    mockChromeStorageLocal.get.mockResolvedValue({});

    const settings = await getSettings();

    expect(settings).toEqual({
      daysUntilRead: 30,
      daysUntilDelete: 60,
      openaiEndpoint: undefined,
      openaiApiKey: undefined,
      openaiModel: undefined,
      slackWebhookUrl: undefined,
    });
    expect(mockChromeStorageLocal.get).toHaveBeenCalledWith([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
    ]);
  });

  it("ストレージから設定を正常取得", async () => {
    const storedSettings = {
      daysUntilRead: 14,
      daysUntilDelete: 30,
      openaiEndpoint: "https://api.openai.com/v1",
      openaiApiKey: "test-key",
      openaiModel: "gpt-3.5-turbo",
      slackWebhookUrl: "https://hooks.slack.com/test",
    };
    mockChromeStorageLocal.get.mockResolvedValue(storedSettings);

    const settings = await getSettings();

    expect(settings).toEqual(storedSettings);
  });

  it("ストレージエラー時にデフォルト設定を返す", async () => {
    mockChromeStorageLocal.get.mockRejectedValue(new Error("Storage error"));

    const settings = await getSettings();

    expect(settings).toEqual({
      daysUntilRead: 30,
      daysUntilDelete: 60,
    });
    expect(console.error).toHaveBeenCalledWith(
      "設定取得エラー:",
      expect.any(Error),
    );
  });
});

describe("getReadingListEntries", () => {
  it("リーディングリストエントリを正常取得", async () => {
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "テスト記事1",
        hasBeenRead: false,
        creationTime: Date.now() - 25 * 24 * 60 * 60 * 1000, // 25日前
        lastUpdateTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/2",
        title: "テスト記事2",
        hasBeenRead: true,
        creationTime: Date.now() - 40 * 24 * 60 * 60 * 1000, // 40日前
        lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35日前に既読化
      },
    ];
    mockChromeReadingList.query.mockResolvedValue(mockEntries);

    const entries = await getReadingListEntries();

    expect(entries).toEqual(mockEntries);
    expect(mockChromeReadingList.query).toHaveBeenCalledWith({});
    expect(console.log).toHaveBeenCalledWith("📚 リーディングリスト取得開始");
    expect(console.log).toHaveBeenCalledWith("📊 取得件数: 2件");
  });

  it("リーディングリストAPIエラー時に空配列を返す", async () => {
    mockChromeReadingList.query.mockRejectedValue(new Error("API error"));

    const entries = await getReadingListEntries();

    expect(entries).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      "リーディングリスト取得エラー:",
      expect.any(Error),
    );
  });
});

describe("shouldMarkAsRead", () => {
  it("未読エントリが期間経過で既読化対象になる", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35日前
      lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    };

    const result = shouldMarkAsRead(entry, 30);

    expect(result).toBe(true);
  });

  it("未読エントリが期間未経過で既読化対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 25 * 24 * 60 * 60 * 1000, // 25日前
      lastUpdateTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
    };

    const result = shouldMarkAsRead(entry, 30);

    expect(result).toBe(false);
  });

  it("既読エントリは既読化対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35日前
      lastUpdateTime: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10日前に既読化
    };

    const result = shouldMarkAsRead(entry, 30);

    expect(result).toBe(false);
  });

  it("境界値テスト：ちょうど30日で既読化対象", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // ちょうど30日前
      lastUpdateTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };

    const result = shouldMarkAsRead(entry, 30);

    expect(result).toBe(true);
  });
});

describe("shouldDelete", () => {
  it("既読エントリが期間経過で削除対象になる", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000, // 80日前作成
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000, // 65日前に既読化
    };

    const result = shouldDelete(entry, 60);

    expect(result).toBe(true);
  });

  it("既読エントリが期間未経過で削除対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 50 * 24 * 60 * 60 * 1000, // 50日前作成
      lastUpdateTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30日前に既読化
    };

    const result = shouldDelete(entry, 60);

    expect(result).toBe(false);
  });

  it("未読エントリは削除対象外", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000, // 80日前
      lastUpdateTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
    };

    const result = shouldDelete(entry, 60);

    expect(result).toBe(false);
  });

  it("境界値テスト：ちょうど60日で削除対象", () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90日前作成
      lastUpdateTime: Date.now() - 60 * 24 * 60 * 60 * 1000, // ちょうど60日前に既読化
    };

    const result = shouldDelete(entry, 60);

    expect(result).toBe(true);
  });
});
