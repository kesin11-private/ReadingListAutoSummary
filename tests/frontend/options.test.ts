import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../../src/common/chrome_storage";
import { ContentExtractorTest } from "../../src/frontend/options/ContentExtractorTest";
import {
  addLlmEndpoint,
  addLlmModel,
  formatSettingsForUi,
  removeSelectedLlmEndpoint,
  removeSelectedLlmModel,
  selectLlmEndpoint,
  updateSelectedLlmEndpoint,
  updateSelectedLlmModel,
} from "../../src/frontend/options/options";

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

function createSettings(): Settings {
  return formatSettingsForUi({
    ...DEFAULT_SETTINGS,
    llmEndpoints: [
      {
        id: "endpoint-1",
        name: "OpenAI",
        endpoint: "https://api.openai.com/v1",
        apiKey: "sk-openai",
      },
      {
        id: "endpoint-2",
        name: "Azure OpenAI",
        endpoint: "https://azure.example.com/openai",
        apiKey: "azure-key",
      },
    ],
    llmModels: [
      {
        id: "model-1",
        endpointId: "endpoint-1",
        modelName: "gpt-4o-mini",
      },
      {
        id: "model-2",
        endpointId: "endpoint-2",
        modelName: "gpt-4.1",
      },
    ],
    selectedLlmEndpointId: "endpoint-1",
    selectedLlmModelId: "model-1",
  });
}

describe("options helpers", () => {
  it("新しいエンドポイントを追加すると自動選択される", () => {
    const result = addLlmEndpoint(createSettings());

    expect(result.llmEndpoints).toHaveLength(3);
    expect(result.selectedLlmEndpointId).toBe(
      result.llmEndpoints[result.llmEndpoints.length - 1]?.id,
    );
    expect(result.selectedLlmModelId).toBeNull();
  });

  it("エンドポイント切り替え時に対応するモデルへ追従する", () => {
    const result = selectLlmEndpoint(createSettings(), "endpoint-2");

    expect(result.selectedLlmEndpointId).toBe("endpoint-2");
    expect(result.selectedLlmModelId).toBe("model-2");
  });

  it("選択中のエンドポイント更新が反映される", () => {
    const result = updateSelectedLlmEndpoint(
      createSettings(),
      "name",
      "Primary OpenAI",
    );

    expect(result.llmEndpoints[0]?.name).toBe("Primary OpenAI");
  });

  it("空白だけのエンドポイント名はURL由来ラベルへフォールバックする", () => {
    const result = formatSettingsForUi({
      ...createSettings(),
      llmEndpoints: [
        {
          id: "endpoint-1",
          name: "   ",
          endpoint: "https://api.openai.com/v1",
          apiKey: "sk-openai",
        },
      ],
      llmModels: [
        {
          id: "model-1",
          endpointId: "endpoint-1",
          modelName: "gpt-4o-mini",
        },
      ],
      selectedLlmEndpointId: "endpoint-1",
      selectedLlmModelId: "model-1",
    });

    expect(result.llmEndpoints[0]?.name).toBe("api.openai.com");
  });

  it("モデル追加と更新が選択中エンドポイント配下に反映される", () => {
    const withNewModel = addLlmModel(createSettings());
    const updated = updateSelectedLlmModel(withNewModel, "gpt-5-mini");
    const selectedModel = updated.llmModels.find(
      (model) => model.id === updated.selectedLlmModelId,
    );

    expect(selectedModel?.endpointId).toBe("endpoint-1");
    expect(selectedModel?.modelName).toBe("gpt-5-mini");
  });

  it("選択中モデルを削除すると同一エンドポイントの次のモデルへ移る", () => {
    const settings = formatSettingsForUi({
      ...createSettings(),
      llmModels: [
        {
          id: "model-1",
          endpointId: "endpoint-1",
          modelName: "gpt-4o-mini",
        },
        {
          id: "model-3",
          endpointId: "endpoint-1",
          modelName: "gpt-4.1-mini",
        },
      ],
      selectedLlmModelId: "model-1",
    });

    const result = removeSelectedLlmModel(settings);

    expect(result.llmModels.map((model) => model.id)).toEqual(["model-3"]);
    expect(result.selectedLlmModelId).toBe("model-3");
  });

  it("エンドポイント削除時に配下モデルも削除する", () => {
    const result = removeSelectedLlmEndpoint(createSettings());

    expect(result.llmEndpoints.map((endpoint) => endpoint.id)).toEqual([
      "endpoint-2",
    ]);
    expect(result.llmModels.map((model) => model.id)).toEqual(["model-2"]);
    expect(result.selectedLlmEndpointId).toBe("endpoint-2");
    expect(result.selectedLlmModelId).toBe("model-2");
  });
});

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
    render(
      h(ContentExtractorTest, {
        provider: "local-with-tavily-fallback",
      }),
      container,
    );

    expect(container.textContent).toContain("コンテンツ抽出テスト");
    expect(container.textContent).toContain(
      "拡張機能内でHTMLを取得して本文を抽出し、失敗時のみ Tavily Extract API にフォールバックします。Tavily API キーは任意です。",
    );
  });

  it("Tavily モードではローカル抽出を行わない説明を表示する", () => {
    render(h(ContentExtractorTest, { provider: "tavily" }), container);

    expect(container.textContent).toContain(
      "ローカル抽出は行わず、最初から Tavily Extract API で本文を抽出します。Tavily API キーが必須です。",
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

    render(
      h(ContentExtractorTest, {
        provider: "local-with-tavily-fallback",
      }),
      container,
    );

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
    expect(container.textContent).toContain("✓ 本文抽出成功: ローカル");
    expect(container.textContent).toContain("✓ 要約成功");
  });

  it("抽出成功後に要約で例外が起きても抽出結果を失敗で上書きしない", async () => {
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
      .mockRejectedValueOnce(new Error("summarize failed"));

    render(
      h(ContentExtractorTest, {
        provider: "local-with-tavily-fallback",
      }),
      container,
    );

    const input = container.querySelector("input[type='url']");
    expect(input).toBeTruthy();

    (input as HTMLInputElement).value = "https://example.com/article";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const button = container.querySelector("button");
    expect(button).toBeTruthy();

    button?.click();
    await flushPromises();

    expect(container.textContent).toContain("✓ 本文抽出成功: ローカル");
    expect(container.textContent).toContain("✗ 要約失敗: summarize failed");
  });

  it("Tavilyキー未設定のローカル失敗では要約を実行しない", async () => {
    mockChromeRuntime.sendMessage.mockResolvedValueOnce({
      success: false,
      error: "ローカル本文取得に失敗しました: 403 Forbidden",
      outcome: "local-failed-no-fallback",
      attempts: [
        {
          source: "local",
          success: false,
          kind: "fetch-blocked",
          error: "ローカル本文取得に失敗しました: 403 Forbidden",
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

    render(
      h(ContentExtractorTest, {
        provider: "local-with-tavily-fallback",
      }),
      container,
    );

    const input = container.querySelector("input[type='url']");
    expect(input).toBeTruthy();

    (input as HTMLInputElement).value = "https://example.com/article";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const button = container.querySelector("button");
    expect(button).toBeTruthy();

    button?.click();
    await flushPromises();

    expect(mockChromeRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("✗ 本文抽出失敗: ローカル");
  });
});
