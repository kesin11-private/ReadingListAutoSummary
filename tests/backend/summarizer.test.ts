import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSlackErrorMessage,
  formatSlackMessage,
  type SummarizerConfig,
  summarizeContent,
} from "../../src/backend/summarizer";

// OpenAI SDKのモック
const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// globalのconsoleをモック
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => {});

describe("summarizer", () => {
  const config: SummarizerConfig = {
    endpoint: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-4",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("summarizeContent", () => {
    it("正常な要約生成", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "要約文1。\n要約文2。\n要約文3。",
            },
          },
        ],
      };
      mockCreate.mockResolvedValue(mockResponse);

      const result = await summarizeContent(
        "テストタイトル",
        "https://example.com",
        "テストコンテンツ",
        config,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("要約文1。\n要約文2。\n要約文3。");
      expect(result.retryCount).toBe(1);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "要約開始 (試行 1/3): テストタイトル",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "要約生成成功 (試行 1): テストタイトル",
      );
    });

    it("空の要約結果の場合エラーを返す", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "",
            },
          },
        ],
      };
      mockCreate.mockResolvedValue(mockResponse);

      const resultPromise = summarizeContent(
        "テストタイトル",
        "https://example.com",
        "テストコンテンツ",
        config,
      );

      // タイマーを進めてリトライを実行
      vi.advanceTimersByTime(1000); // 1回目のリトライ
      await vi.runOnlyPendingTimersAsync();
      vi.advanceTimersByTime(2000); // 2回目のリトライ
      await vi.runOnlyPendingTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("要約結果が空です");
      expect(result.retryCount).toBe(3);
    });

    it("APIエラー時にリトライして最終的に失敗", async () => {
      const apiError = new Error("API Error");
      mockCreate.mockRejectedValue(apiError);

      const resultPromise = summarizeContent(
        "テストタイトル",
        "https://example.com",
        "テストコンテンツ",
        config,
      );

      // タイマーを進めてリトライを実行
      vi.advanceTimersByTime(1000); // 1回目のリトライ
      await vi.runOnlyPendingTimersAsync();
      vi.advanceTimersByTime(2000); // 2回目のリトライ
      await vi.runOnlyPendingTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("API Error");
      expect(result.retryCount).toBe(3);
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(mockConsoleError).toHaveBeenCalledWith(
        "要約生成失敗 (全3回試行): テストタイトル",
      );
    });

    it("2回目のリトライで成功", async () => {
      const apiError = new Error("API Error");
      const mockResponse = {
        choices: [
          {
            message: {
              content: "成功した要約文。",
            },
          },
        ],
      };

      mockCreate
        .mockRejectedValueOnce(apiError)
        .mockResolvedValueOnce(mockResponse);

      const resultPromise = summarizeContent(
        "テストタイトル",
        "https://example.com",
        "テストコンテンツ",
        config,
      );

      // 1回目のリトライまでタイマーを進める
      vi.advanceTimersByTime(1000);
      await vi.runOnlyPendingTimersAsync();

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.summary).toBe("成功した要約文。");
      expect(result.retryCount).toBe(2);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("OpenAI APIに正しいパラメータを渡す", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "テスト要約",
            },
          },
        ],
      };
      mockCreate.mockResolvedValue(mockResponse);

      await summarizeContent(
        "テストタイトル",
        "https://example.com",
        "テストコンテンツ",
        config,
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: expect.stringContaining(
              "テキストから本文を抜き出し、日本語で要約してください",
            ),
          },
          {
            role: "user",
            content: expect.stringContaining("テストタイトル"),
          },
        ],
        stream: false,
      });
    });
  });

  describe("formatSlackMessage", () => {
    it("正常なSlack投稿フォーマットを生成", () => {
      const result = formatSlackMessage(
        "テストタイトル",
        "https://example.com",
        "gpt-4",
        "要約文1。\n要約文2。\n要約文3。",
      );

      expect(result).toBe(
        "テストタイトル\n" +
          "https://example.com\n" +
          "\n" +
          "gpt-4による要約\n" +
          "\n" +
          "要約文1。\n" +
          "\n" +
          "要約文2。\n" +
          "\n" +
          "要約文3。",
      );
    });

    it("要約が3文未満の場合でも正常にフォーマット", () => {
      const result = formatSlackMessage(
        "テストタイトル",
        "https://example.com",
        "gpt-4",
        "要約文1のみ。",
      );

      expect(result).toBe(
        "テストタイトル\n" +
          "https://example.com\n" +
          "\n" +
          "gpt-4による要約\n" +
          "\n" +
          "要約文1のみ。\n" +
          "\n" +
          "\n" +
          "\n",
      );
    });
  });

  describe("formatSlackErrorMessage", () => {
    it("エラー時のSlack投稿フォーマットを生成", () => {
      const result = formatSlackErrorMessage(
        "テストタイトル",
        "https://example.com",
        "gpt-4",
        "API接続エラー",
      );

      expect(result).toBe(
        "テストタイトル\n" +
          "https://example.com\n" +
          "\n" +
          "gpt-4による要約\n" +
          "\n" +
          "要約生成に失敗しました: API接続エラー\n" +
          "\n" +
          "\n",
      );
    });
  });
});
