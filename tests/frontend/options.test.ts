import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentExtractorTest } from "../../src/frontend/options/ContentExtractorTest";

const mockChromeStorage = {
  local: {
    get: vi.fn(),
  },
};

const mockChromeRuntime = {
  sendMessage: vi.fn(),
};

Object.assign(globalThis, {
  chrome: {
    storage: mockChromeStorage,
    runtime: mockChromeRuntime,
  },
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ContentExtractorTest", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it("ローカル抽出優先とTavilyフォールバックの説明を表示する", () => {
    render(h(ContentExtractorTest, { provider: "tavily" }), container);

    expect(container.textContent).toContain("コンテンツ抽出テスト");
    expect(container.textContent).toContain(
      "まず拡張機能内でHTMLを取得して本文を抽出し、失敗時のみTavily APIキーが設定されていればフォールバックします。",
    );
  });

  it("ローカル抽出成功後に要約を実行する", async () => {
    mockChromeRuntime.sendMessage
      .mockResolvedValueOnce({
        success: true,
        content: "# Local Title\n\n本文",
        title: "Local Title",
        source: "local",
        outcome: "local-success",
        attempts: [
          {
            source: "local",
            success: true,
            kind: "local-success",
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        summary: "要約1\n\n要約2\n\n要約3",
        modelName: "gpt-4o-mini",
      });

    render(h(ContentExtractorTest, { provider: "tavily" }), container);

    const input = container.querySelector("input[type='url']");

    expect(input).toBeTruthy();

    (input as HTMLInputElement).value = "https://example.com/article";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const button = container.querySelector("button");

    expect(button).toBeTruthy();

    button?.click();
    await flushPromises();

    expect(mockChromeRuntime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: "EXTRACT_CONTENT",
      url: "https://example.com/article",
    });
    expect(mockChromeRuntime.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "SUMMARIZE_TEST",
      title: "example.com",
      url: "https://example.com/article",
      content: "# Local Title\n\n本文",
    });
    expect(container.textContent).toContain("✓ ローカル抽出成功");
    expect(container.textContent).toContain("✓ 要約成功");
  });

  it("Tavilyキー未設定のローカル失敗では要約を実行しない", async () => {
    mockChromeRuntime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: "ローカルHTML取得に失敗しました: 403 Forbidden",
      outcome: "local-failed-no-fallback",
      attempts: [
        {
          source: "local",
          success: false,
          kind: "fetch-blocked",
          error: "ローカルHTML取得に失敗しました: 403 Forbidden",
          status: 403,
        },
        {
          source: "tavily",
          success: false,
          kind: "fallback-unavailable",
          error: "Tavily API キーが未設定のためフォールバックできません。",
        },
      ],
    });

    render(h(ContentExtractorTest, { provider: "tavily" }), container);

    const input = container.querySelector("input[type='url']");

    (input as HTMLInputElement).value = "https://example.com/article";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const button = container.querySelector("button");

    expect(button).toBeTruthy();

    button?.click();
    await flushPromises();

    expect(mockChromeRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("✗ ローカル抽出失敗");
  });
});
