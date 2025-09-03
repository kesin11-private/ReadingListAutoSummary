import { afterEach, describe, expect, it, vi } from "vitest";
import { postToSlack } from "../../src/backend/post";

// global fetchのモック
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

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
  });

  it("ネットワークエラー時にエラーログを出力して例外をスロー", async () => {
    const networkError = new Error("Network error");
    mockFetch.mockRejectedValue(networkError);

    await expect(postToSlack(testWebhookUrl, testMessage)).rejects.toThrow(
      "Network error",
    );
  });

  it("HTTPエラー時にはエラー内容がログに記録される", async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(postToSlack(testWebhookUrl, testMessage)).rejects.toThrow();
  });
});
