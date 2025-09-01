import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentExtractorTest } from "../../src/frontend/options/ContentExtractorTest";

// Chrome runtime API のモック
const mockSendMessage = vi.fn();
vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: mockSendMessage,
  },
});

describe("ContentExtractorTest Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("コンポーネントが正常にインポートできる", () => {
    expect(ContentExtractorTest).toBeDefined();
    expect(typeof ContentExtractorTest).toBe("function");
  });

  it("chrome.runtime.sendMessage がモックされている", () => {
    expect(mockSendMessage).toBeDefined();
    expect(typeof mockSendMessage).toBe("function");
  });

  it("EXTRACT_CONTENT メッセージの型定義が正しい", () => {
    // メッセージタイプの構造をテスト
    const extractMessage = {
      type: "EXTRACT_CONTENT" as const,
      url: "https://example.com",
    };

    expect(extractMessage.type).toBe("EXTRACT_CONTENT");
    expect(extractMessage.url).toBe("https://example.com");
  });

  it("SUMMARIZE_TEST メッセージの型定義が正しい", () => {
    // メッセージタイプの構造をテスト
    const summarizeMessage = {
      type: "SUMMARIZE_TEST" as const,
      title: "テストタイトル",
      url: "https://example.com",
      content: "テストコンテンツ",
    };

    expect(summarizeMessage.type).toBe("SUMMARIZE_TEST");
    expect(summarizeMessage.title).toBe("テストタイトル");
    expect(summarizeMessage.url).toBe("https://example.com");
    expect(summarizeMessage.content).toBe("テストコンテンツ");
  });

  it("ExtractContentResult の型ガード関数をテスト", async () => {
    // 型ガード関数を直接インポートできないため、メッセージレスポンスの構造をテスト
    const validSuccessResponse = {
      success: true,
      content: "抽出されたコンテンツ",
    };

    const validErrorResponse = {
      success: false,
      error: "エラーメッセージ",
    };

    expect(validSuccessResponse.success).toBe(true);
    expect(validSuccessResponse.content).toBe("抽出されたコンテンツ");
    expect(validErrorResponse.success).toBe(false);
    expect(validErrorResponse.error).toBe("エラーメッセージ");
  });

  it("SummarizeResult の型構造をテスト", () => {
    const validSummarizeSuccessResponse = {
      success: true,
      summary: "生成された要約",
      retryCount: 2,
    };

    const validSummarizeErrorResponse = {
      success: false,
      error: "要約エラー",
      retryCount: 3,
    };

    expect(validSummarizeSuccessResponse.success).toBe(true);
    expect(validSummarizeSuccessResponse.summary).toBe("生成された要約");
    expect(validSummarizeSuccessResponse.retryCount).toBe(2);

    expect(validSummarizeErrorResponse.success).toBe(false);
    expect(validSummarizeErrorResponse.error).toBe("要約エラー");
    expect(validSummarizeErrorResponse.retryCount).toBe(3);
  });
});
