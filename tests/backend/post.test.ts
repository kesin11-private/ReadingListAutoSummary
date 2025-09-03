import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postToSlack } from "../../src/backend/post";

// global fetchのモック
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// console.logとconsole.errorのスパイ
const mockConsoleLog = vi.spyOn(console, "log");
const mockConsoleError = vi.spyOn(console, "error");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("postToSlack", () => {
  const testWebhookUrl = "https://hooks.slack.com/services/TEST/TEST/TEST";
  const testMessage = "テストメッセージ";

  it("正常にSlackに投稿できる", async () => {
    // 成功レスポンスをモック
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200, statusText: "OK" }),
    );

    await postToSlack(testWebhookUrl, testMessage);

    // 正しいパラメータでfetchが呼ばれているか確認
    expect(mockFetch).toHaveBeenCalledWith(testWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: testMessage,
      }),
    });

    // デバッグログが出力されているか確認
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿開始", {
      webhookUrl: testWebhookUrl,
      messageLength: testMessage.length,
    });
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿内容", {
      payload: { text: testMessage },
    });
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿成功");
  });

  it("HTTPエラー時にエラーログを出力して例外をスロー", async () => {
    const errorResponse = new Response(null, {
      status: 400,
      statusText: "Bad Request",
    });
    mockFetch.mockResolvedValue(errorResponse);

    await expect(postToSlack(testWebhookUrl, testMessage)).rejects.toThrow(
      "HTTP 400: Bad Request",
    );

    // エラーログが出力されているか確認
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Slack投稿失敗:",
      "HTTP 400: Bad Request",
    );
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Slack投稿失敗:",
      expect.any(Error),
    );
  });

  it("ネットワークエラー時にエラーログを出力して例外をスロー", async () => {
    const networkError = new Error("Network error");
    mockFetch.mockRejectedValue(networkError);

    await expect(postToSlack(testWebhookUrl, testMessage)).rejects.toThrow(
      "Network error",
    );

    // エラーログが出力されているか確認
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Slack投稿失敗:",
      networkError,
    );
  });

  it("デバッグログで投稿開始・内容・結果が記録される", async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200, statusText: "OK" }),
    );

    const longMessage = "A".repeat(1000);
    await postToSlack(testWebhookUrl, longMessage);

    // 投稿開始ログ
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿開始", {
      webhookUrl: testWebhookUrl,
      messageLength: 1000,
    });

    // 投稿内容ログ
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿内容", {
      payload: { text: longMessage },
    });

    // 成功ログ
    expect(mockConsoleLog).toHaveBeenCalledWith("Slack投稿成功");
  });

  it("HTTPエラー時にはエラー内容がログに記録される", async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(postToSlack(testWebhookUrl, testMessage)).rejects.toThrow();

    // エラー内容がログに記録されているか確認
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Slack投稿失敗:",
      "HTTP 500: Internal Server Error",
    );
  });
});
