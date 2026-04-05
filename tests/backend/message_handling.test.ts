import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractContentResult } from "../../src/backend/content_extractor";
import type { ManualExecuteResult } from "../../src/types/messages";

// ExtractContent モックの設定
const mockExtractContent = vi.fn();

// モジュールのモック
vi.mock("../../src/backend/content_extractor", () => ({
  extractContent: mockExtractContent,
  summarizeExtractionResult: vi.fn(
    (result: ExtractContentResult) =>
      `outcome=${result.outcome}; attempts=${result.attempts
        .map((attempt) => `${attempt.source}:${attempt.kind}`)
        .join(" -> ")}`,
  ),
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

function createExtractSuccessResult(): ExtractContentResult {
  return {
    success: true,
    content: "テストコンテンツ",
    title: "テスト記事",
    source: "local",
    outcome: "local-success",
    attempts: [
      {
        source: "local",
        success: true,
        kind: "local-success",
      },
    ],
  };
}

function getMessageListener(): MessageListener {
  if (messageListener === null) {
    throw new Error("Message listener is not registered");
  }

  return messageListener;
}

// グローバルchrome オブジェクトのモック
beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: {
      local: mockChromeStorageLocal,
    },
    runtime: mockChromeRuntime,
  });

  mockChromeRuntime.onMessage.addListener.mockImplementation((listener) => {
    messageListener = listener;
  });

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
    await import("../../src/backend/background");
  });

  it("メッセージリスナーが登録される", () => {
    expect(mockChromeRuntime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(messageListener).toBeTruthy();
  });

  it("EXTRACT_CONTENT メッセージでローカル抽出を実行する", async () => {
    vi.useFakeTimers();
    mockChromeStorageLocal.get.mockResolvedValue({});

    const mockResult = createExtractSuccessResult();
    mockExtractContent.mockResolvedValue(mockResult);

    const sendResponse = vi.fn();
    const request = {
      type: "EXTRACT_CONTENT",
      url: "https://example.com",
    };

    const listener = getMessageListener();
    const result = listener(
      request,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(result).toBe(true);
    await vi.runAllTimersAsync();

    expect(mockExtractContent).toHaveBeenCalledWith("https://example.com", {
      mode: "local-with-tavily-fallback",
    });
    expect(sendResponse).toHaveBeenCalledWith(mockResult);

    vi.useRealTimers();
  });

  it("Tavily API キーがあれば既定モード付きで抽出を実行する", async () => {
    vi.useFakeTimers();
    mockChromeStorageLocal.get.mockResolvedValue({
      tavilyApiKey: "tv-test-key",
    });

    const mockResult = createExtractSuccessResult();
    mockExtractContent.mockResolvedValue(mockResult);

    const sendResponse = vi.fn();
    const listener = getMessageListener();

    listener(
      { type: "EXTRACT_CONTENT", url: "https://example.com" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.runAllTimersAsync();

    expect(mockExtractContent).toHaveBeenCalledWith("https://example.com", {
      mode: "local-with-tavily-fallback",
      tavily: {
        apiKey: "tv-test-key",
      },
    });
    expect(sendResponse).toHaveBeenCalledWith(mockResult);

    vi.useRealTimers();
  });

  it("Tavily モードが選択されていればそのモードで抽出を実行する", async () => {
    vi.useFakeTimers();
    mockChromeStorageLocal.get.mockResolvedValue({
      contentExtractorProvider: "tavily",
      tavilyApiKey: "tv-test-key",
    });

    const mockResult = createExtractSuccessResult();
    mockExtractContent.mockResolvedValue(mockResult);

    const sendResponse = vi.fn();
    const listener = getMessageListener();

    listener(
      { type: "EXTRACT_CONTENT", url: "https://example.com" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.runAllTimersAsync();

    expect(mockExtractContent).toHaveBeenCalledWith("https://example.com", {
      mode: "tavily",
      tavily: {
        apiKey: "tv-test-key",
      },
    });
    expect(sendResponse).toHaveBeenCalledWith(mockResult);

    vi.useRealTimers();
  });

  it("extractContent が失敗結果を返した場合はそのまま返す", async () => {
    vi.useFakeTimers();
    mockChromeStorageLocal.get.mockResolvedValue({});

    const mockError: ExtractContentResult = {
      success: false,
      error: "抽出に失敗しました",
      outcome: "local-failed-no-fallback",
      attempts: [
        {
          source: "local",
          success: false,
          kind: "fetch-blocked",
          error: "ローカルHTML取得に失敗しました: Failed to fetch",
        },
        {
          source: "tavily",
          success: false,
          kind: "fallback-unavailable",
          error: "Tavily API キーが未設定のためフォールバックできません。",
        },
      ],
    };
    mockExtractContent.mockResolvedValue(mockError);

    const sendResponse = vi.fn();
    const listener = getMessageListener();

    listener(
      { type: "EXTRACT_CONTENT", url: "https://example.com" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.runAllTimersAsync();

    expect(sendResponse).toHaveBeenCalledWith(mockError);

    vi.useRealTimers();
  });

  it("不明なメッセージタイプは無視する", () => {
    const sendResponse = vi.fn();
    const request = {
      type: "UNKNOWN_MESSAGE",
      url: "https://example.com",
    };

    const listener = getMessageListener();
    const result = listener(
      request,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("MANUAL_EXECUTE メッセージで成功レスポンスを返す", async () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn();
    const request = { type: "MANUAL_EXECUTE" };

    const listener = getMessageListener();
    const result = listener(
      request,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(result).toBe(true);
    await vi.runAllTimersAsync();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });

    vi.useRealTimers();
  });
});
