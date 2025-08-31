import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteEntry,
  getReadingListEntries,
  markAsReadAndNotify,
  processReadingListEntries,
  shouldDelete,
  shouldMarkAsRead,
} from "../../src/backend/background";
import { getSettings } from "../../src/common/chrome_storage";

// Chrome API のモック設定
const mockChromeStorageLocal = {
  get: vi.fn(),
};

const mockChromeReadingList = {
  query: vi.fn(),
  updateEntry: vi.fn(),
  removeEntry: vi.fn(),
};

// グローバルchrome オブジェクトのモック
beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
    readingList: mockChromeReadingList,
  });
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
  });

  it("リーディングリストAPIエラー時に空配列を返す", async () => {
    mockChromeReadingList.query.mockRejectedValue(new Error("API error"));

    const entries = await getReadingListEntries();

    expect(entries).toEqual([]);
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

describe("markAsReadAndNotify", () => {
  const mockSettings = {
    daysUntilRead: 30,
    daysUntilDelete: 60,
    openaiEndpoint: "https://api.openai.com/v1",
    openaiApiKey: "test-key",
    openaiModel: "gpt-4o-mini",
    slackWebhookUrl: "https://hooks.slack.com/test",
  };

  it("エントリを正常に既読化", async () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    };

    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);

    await markAsReadAndNotify(entry, mockSettings);

    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledWith({
      url: entry.url,
      hasBeenRead: true,
    });
  });

  it("既読化APIエラー時に例外をスロー", async () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: false,
      creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
    };

    mockChromeReadingList.updateEntry.mockRejectedValue(
      new Error("Update failed"),
    );

    await expect(markAsReadAndNotify(entry, mockSettings)).rejects.toThrow(
      "Update failed",
    );
  });
});

describe("deleteEntry", () => {
  it("エントリを正常に削除", async () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000,
    };

    mockChromeReadingList.removeEntry.mockResolvedValue(undefined);

    await deleteEntry(entry);

    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledWith({
      url: entry.url,
    });
  });

  it("削除APIエラー時に例外をスロー", async () => {
    const entry = {
      url: "https://example.com",
      title: "テスト記事",
      hasBeenRead: true,
      creationTime: Date.now() - 80 * 24 * 60 * 60 * 1000,
      lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000,
    };

    mockChromeReadingList.removeEntry.mockRejectedValue(
      new Error("Delete failed"),
    );

    await expect(deleteEntry(entry)).rejects.toThrow("Delete failed");
  });
});

describe("processReadingListEntries", () => {
  const mockSettings = {
    daysUntilRead: 30,
    daysUntilDelete: 60,
  };

  it("統合処理：設定取得、エントリ取得、フィルタリング、処理実行", async () => {
    // モックデータ準備
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "古い未読記事",
        hasBeenRead: false,
        creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35日前（既読化対象）
        lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/2",
        title: "新しい未読記事",
        hasBeenRead: false,
        creationTime: Date.now() - 25 * 24 * 60 * 60 * 1000, // 25日前（対象外）
        lastUpdateTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/3",
        title: "古い既読記事",
        hasBeenRead: true,
        creationTime: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100日前作成
        lastUpdateTime: Date.now() - 65 * 24 * 60 * 60 * 1000, // 65日前既読化（削除対象）
      },
      {
        url: "https://example.com/4",
        title: "新しい既読記事",
        hasBeenRead: true,
        creationTime: Date.now() - 50 * 24 * 60 * 60 * 1000, // 50日前作成
        lastUpdateTime: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30日前既読化（対象外）
      },
    ];

    // モック設定
    mockChromeStorageLocal.get.mockResolvedValue(mockSettings);
    mockChromeReadingList.query.mockResolvedValue(mockEntries);
    mockChromeReadingList.updateEntry.mockResolvedValue(undefined);
    mockChromeReadingList.removeEntry.mockResolvedValue(undefined);

    // 処理実行
    await processReadingListEntries();

    // 既読化処理の検証
    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(1);
    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledWith({
      url: "https://example.com/1",
      hasBeenRead: true,
    });

    // 削除処理の検証
    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledTimes(1);
    expect(mockChromeReadingList.removeEntry).toHaveBeenCalledWith({
      url: "https://example.com/3",
    });
  });

  it("エラーが発生しても処理が継続される", async () => {
    const mockEntries = [
      {
        url: "https://example.com/1",
        title: "エラーを起こす記事",
        hasBeenRead: false,
        creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      },
      {
        url: "https://example.com/2",
        title: "正常な記事",
        hasBeenRead: false,
        creationTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
        lastUpdateTime: Date.now() - 35 * 24 * 60 * 60 * 1000,
      },
    ];

    mockChromeStorageLocal.get.mockResolvedValue(mockSettings);
    mockChromeReadingList.query.mockResolvedValue(mockEntries);
    mockChromeReadingList.updateEntry
      .mockRejectedValueOnce(new Error("First entry failed"))
      .mockResolvedValueOnce(undefined);

    // エラーが発生しても例外は投げられない
    await expect(processReadingListEntries()).resolves.not.toThrow();

    // 両方の記事に対して処理が試行されることを確認
    expect(mockChromeReadingList.updateEntry).toHaveBeenCalledTimes(2);
  });
});
