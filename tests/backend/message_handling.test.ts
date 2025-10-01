import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractContentResult } from "../../src/backend/content_extractor";
import { DEFAULT_FIRECRAWL_BASE_URL } from "../../src/common/constants";
import type { ManualExecuteResult } from "../../src/types/messages";

// ExtractContent モックの設定
const mockExtractContent = vi.fn();

// モジュールのモック
vi.mock("../../src/backend/content_extractor", () => ({
  extractContent: mockExtractContent,
}));

vi.mock("../../src/backend/alarm", () => ({}));

// Chrome API のモック設定
const mockChromeStorageLocal = {
  get: vi.fn(),
};

const mockChromeRuntime = {
  onMessage: {
    addListener: vi.fn(),
  },
  sendMessage: vi.fn(),
};

// Type alias for complex message listener function type
type MessageListener = (
  request: { type: string; url?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtractContentResult | ManualExecuteResult) => void,
) => boolean | undefined;

let messageListener: MessageListener | null = null;

// グローバルchrome オブジェクトのモック
beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
    runtime: mockChromeRuntime,
  });

  // onMessage.addListener の呼び出しをキャプチャ
  mockChromeRuntime.onMessage.addListener.mockImplementation((listener) => {
    messageListener = listener;
  });

  // モジュールを動的にインポートしてメッセージハンドラーを初期化
  vi.doMock("../../src/backend/background");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/backend/background");
  messageListener = null;
});

describe("Message handling", () => {
  beforeEach(async () => {
    // モジュールを再インポートしてメッセージハンドラーを初期化
    await import("../../src/backend/background");
  });

  it("メッセージリスナーが登録される", () => {
    expect(mockChromeRuntime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(messageListener).toBeTruthy();
  });

  it("EXTRACT_CONTENT メッセージでコンテンツ抽出を実行する", async () => {
    vi.useFakeTimers();
    // 設定のモック
    mockChromeStorageLocal.get.mockResolvedValue({
      contentExtractorProvider: "firecrawl" as const,
      firecrawlApiKey: "fc-test-key",
      firecrawlBaseUrl: "http://localhost:3002",
    });

    // extractContent のモック
    const mockResult = {
      success: true,
      content: "テストコンテンツ",
    };
    mockExtractContent.mockResolvedValue(mockResult);

    const sendResponse = vi.fn();
    const request = {
      type: "EXTRACT_CONTENT",
      url: "https://example.com",
    };

    // メッセージハンドラーが登録されていることを確認
    expect(messageListener).toBeTruthy();

    if (messageListener) {
      // メッセージハンドラーを呼び出し
      const result = messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      // 非同期処理を示すためtrueを返すことを確認
      expect(result).toBe(true);

      // 非同期処理の完了を待つ
      await vi.runAllTimersAsync();

      // extractContent が正しい引数で呼ばれることを確認
      expect(mockExtractContent).toHaveBeenCalledWith("https://example.com", {
        provider: "firecrawl",
        firecrawl: {
          apiKey: "fc-test-key",
          baseUrl: "http://localhost:3002",
        },
      });

      // sendResponse が正しい結果で呼ばれることを確認
      expect(sendResponse).toHaveBeenCalledWith(mockResult);
    }
    vi.useRealTimers();
  });

  it("Firecrawl API キーが未設定の場合はエラーを返す", async () => {
    vi.useFakeTimers();
    // 設定のモック（Firecrawl選択だがAPI キーなし）
    mockChromeStorageLocal.get.mockResolvedValue({
      contentExtractorProvider: "firecrawl" as const,
      firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    });

    const sendResponse = vi.fn();
    const request = {
      type: "EXTRACT_CONTENT",
      url: "https://example.com",
    };

    if (messageListener) {
      messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      // 非同期処理の完了を待つ
      await vi.runAllTimersAsync();

      // extractContent は呼ばれない
      expect(mockExtractContent).not.toHaveBeenCalled();

      // エラーレスポンスが返される
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error:
          "Firecrawl API キーが設定されていません。設定を保存してからお試しください。",
      });
    }
    vi.useRealTimers();
  });

  it("Tavily API キーが未設定の場合はエラーを返す", async () => {
    vi.useFakeTimers();
    mockChromeStorageLocal.get.mockResolvedValue({});

    const sendResponse = vi.fn();
    const request = {
      type: "EXTRACT_CONTENT",
      url: "https://example.com",
    };

    if (messageListener) {
      messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      await vi.runAllTimersAsync();

      expect(mockExtractContent).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error:
          "Tavily API キーが設定されていません。設定を保存してからお試しください。",
      });
    }
    vi.useRealTimers();
  });

  it("extractContent でエラーが発生した場合はエラーを返す", async () => {
    vi.useFakeTimers();
    // 設定のモック
    mockChromeStorageLocal.get.mockResolvedValue({
      contentExtractorProvider: "firecrawl" as const,
      firecrawlApiKey: "fc-test-key",
      firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    });

    // extractContent のエラーモック
    const mockError = {
      success: false,
      error: "抽出に失敗しました",
    };
    mockExtractContent.mockResolvedValue(mockError);

    const sendResponse = vi.fn();
    const request = {
      type: "EXTRACT_CONTENT",
      url: "https://example.com",
    };

    if (messageListener) {
      messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      // 非同期処理の完了を待つ
      await vi.runAllTimersAsync();

      // エラーレスポンスが返される
      expect(sendResponse).toHaveBeenCalledWith(mockError);
    }
    vi.useRealTimers();
  });

  it("不明なメッセージタイプは無視する", () => {
    const sendResponse = vi.fn();
    const request = {
      type: "UNKNOWN_MESSAGE",
      url: "https://example.com",
    };

    if (messageListener) {
      const result = messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      // falseを返す（非同期処理なし）
      expect(result).toBe(false);

      // sendResponse は呼ばれない
      expect(sendResponse).not.toHaveBeenCalled();
    }
  });

  it("MANUAL_EXECUTE メッセージで成功レスポンスを返す", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn();
    const request = { type: "MANUAL_EXECUTE" };

    expect(messageListener).toBeTruthy();
    if (messageListener) {
      const result = messageListener(
        request,
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );
      expect(result).toBe(true);
      await vi.runAllTimersAsync();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    }
    vi.useRealTimers();
  });
});
