import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../../src/common/chrome_storage";
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
