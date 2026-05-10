import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  appendSessionLogEvent,
  completeSessionLog,
  generateSessionId,
  getDailySummaryQuotaState,
  getAllSessionLogs,
  getSettings,
  incrementDailySummaryQuotaCount,
  pruneSessionLogs,
  startSessionLog,
  type Settings,
  saveSettings,
  setDailySummaryQuotaState,
  type SessionLog,
  type ValidatedSettings,
  validateSettings,
} from "../../src/common/chrome_storage";

const mockChromeStorage = {
  local: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: mockChromeStorage,
  },
  writable: true,
});

const validLlmSettings = {
  llmEndpoints: [
    {
      id: "endpoint-1",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      apiKey: "sk-test123",
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
} satisfies Pick<
  Settings,
  "llmEndpoints" | "llmModels" | "selectedLlmEndpointId" | "selectedLlmModelId"
>;

describe("chrome_storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSettings", () => {
    it("設定が存在しない場合はデフォルト設定を返す", async () => {
      mockChromeStorage.local.get.mockResolvedValue({});

      const result = await getSettings();

      expect(result).toEqual(DEFAULT_SETTINGS);
      expect(mockChromeStorage.local.get).toHaveBeenCalledWith([
        "daysUntilRead",
        "daysUntilDelete",
        "maxEntriesPerDay",
        "maxDebugSessionLogs",
        "maxEntriesPerRun",
        "alarmIntervalMinutes",
        "llmEndpoints",
        "llmModels",
        "selectedLlmEndpointId",
        "selectedLlmModelId",
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
        "slackWebhookUrl",
        "contentExtractorProvider",
        "tavilyApiKey",
        "systemPrompt",
      ]);
    });

    it("保存された複数LLM設定がある場合はそのまま返す", async () => {
      const storedSettings = {
        daysUntilRead: 45,
        daysUntilDelete: 90,
        maxEntriesPerDay: 5,
        maxDebugSessionLogs: 12,
        alarmIntervalMinutes: 120,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "local-with-tavily-fallback" as const,
        tavilyApiKey: "tv-test123",
      };
      mockChromeStorage.local.get.mockResolvedValue(storedSettings);

      const result = await getSettings();

      expect(result).toEqual(storedSettings);
    });

    it("旧 maxEntriesPerRun 設定を maxEntriesPerDay に移行する", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        maxEntriesPerRun: 4,
        ...validLlmSettings,
      });

      const result = await getSettings();

      expect(result.maxEntriesPerDay).toBe(4);
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        maxEntriesPerDay: 4,
      });
      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith([
        "maxEntriesPerRun",
      ]);
    });

    it("旧単一LLM設定を新構造へ移行する", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        openaiEndpoint: "https://api.openai.com/v1",
        openaiApiKey: "sk-legacy",
        openaiModel: "gpt-4o",
      });

      const result = await getSettings();

      expect(result.llmEndpoints).toEqual([
        {
          id: "legacy-endpoint",
          name: "Migrated endpoint",
          endpoint: "https://api.openai.com/v1",
          apiKey: "sk-legacy",
        },
      ]);
      expect(result.llmModels).toEqual([
        {
          id: "legacy-model",
          endpointId: "legacy-endpoint",
          modelName: "gpt-4o",
        },
      ]);
      expect(result.selectedLlmEndpointId).toBe("legacy-endpoint");
      expect(result.selectedLlmModelId).toBe("legacy-model");
    });

    it("未対応の旧モード文字列でも既定モードへ寄せる", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        ...validLlmSettings,
        contentExtractorProvider: "legacy-removed-mode",
      });

      const result = await getSettings();

      expect(result.contentExtractorProvider).toBe(
        "local-with-tavily-fallback",
      );
    });
  });

  describe("saveSettings", () => {
    it("新しいLLM構造を保存して旧キーを削除する", async () => {
      const settings: ValidatedSettings = {
        ...DEFAULT_SETTINGS,
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerDay: 7,
        maxDebugSessionLogs: 8,
        alarmIntervalMinutes: 15,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "local-with-tavily-fallback",
        tavilyApiKey: "tv-test123",
        systemPrompt: "カスタムプロンプト",
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith([
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
        "maxEntriesPerRun",
      ]);
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        daysUntilRead: 20,
        daysUntilDelete: 40,
        maxEntriesPerDay: 7,
        maxDebugSessionLogs: 8,
        alarmIntervalMinutes: 15,
        ...validLlmSettings,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        contentExtractorProvider: "local-with-tavily-fallback",
        tavilyApiKey: "tv-test123",
        systemPrompt: "カスタムプロンプト",
      });
    });

    it("空文字のオプション設定を保存した場合は旧値をクリアする", async () => {
      const settings: ValidatedSettings = {
        ...DEFAULT_SETTINGS,
        ...validLlmSettings,
        slackWebhookUrl: "",
        tavilyApiKey: "",
        systemPrompt: "",
        validated: true,
      };

      await saveSettings(settings);

      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith([
        "openaiEndpoint",
        "openaiApiKey",
        "openaiModel",
        "maxEntriesPerRun",
        "slackWebhookUrl",
        "tavilyApiKey",
        "systemPrompt",
      ]);
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          slackWebhookUrl: "",
          tavilyApiKey: "",
          systemPrompt: "",
        }),
      );
    });
  });

  describe("validateSettings", () => {
    const baseSettings: Settings = {
      ...DEFAULT_SETTINGS,
      daysUntilRead: 30,
      daysUntilDelete: 60,
      maxEntriesPerDay: 5,
      maxDebugSessionLogs: 10,
      alarmIntervalMinutes: 720,
      contentExtractorProvider: "local-with-tavily-fallback",
      tavilyApiKey: "tv-test",
      ...validLlmSettings,
    };

    it("有効な設定の場合はvalidatedSettingsを返す", () => {
      const result = validateSettings(baseSettings);

      expect(result.errors).toEqual([]);
      expect(result.validatedSettings?.validated).toBe(true);
    });

    it("不正なLLMエンドポイントURLの場合はエラーを返す", () => {
      const selectedEndpoint = baseSettings.llmEndpoints[0];
      if (!selectedEndpoint) {
        throw new Error("テスト用エンドポイントがありません");
      }

      const { errors } = validateSettings({
        ...baseSettings,
        llmEndpoints: [
          {
            ...selectedEndpoint,
            endpoint: "invalid-url",
          },
        ],
      });

      expect(errors).toContain(
        "LLM APIエンドポイントは有効なURLで入力してください",
      );
    });

    it("不正なコンテンツ抽出プロバイダー値の場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        // @ts-expect-error テスト用に不正な値を渡す
        contentExtractorProvider: "invalid",
      });

      expect(errors).toContain("コンテンツ抽出プロバイダーの選択が不正です");
    });

    it("無効なSlack Webhook URLの場合はエラーを返す", () => {
      const { errors } = validateSettings({
        ...baseSettings,
        slackWebhookUrl: "https://example.com/webhook",
      });

      expect(errors).toContain(
        "Slack Webhook URLはSlackの正しいURLで入力してください",
      );
    });

    it("既読化日数の境界値を検証する", () => {
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilRead: 0,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilRead: 366,
        }).errors,
      ).toContain("既読化までの日数は1-365の整数で入力してください");
    });

    it("削除日数の境界値を検証する", () => {
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilDelete: 0,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          daysUntilDelete: 366,
        }).errors,
      ).toContain("削除までの日数は-1または1-365の整数で入力してください");
    });

    it("最大エントリ数と実行間隔の境界値を検証する", () => {
      expect(
        validateSettings({
          ...baseSettings,
          maxEntriesPerDay: 0,
        }).errors,
      ).toContain("1日に要約する最大エントリ数は1-100の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          maxDebugSessionLogs: 0,
        }).errors,
      ).toContain("保持するデバッグログ数は1-100の整数で入力してください");
      expect(
        validateSettings({
          ...baseSettings,
          alarmIntervalMinutes: 0,
        }).errors,
      ).toContain("実行間隔（分）は1以上の整数で入力してください");
    });

    it("Tavily モードではAPIキー必須、ローカルモードでは任意", () => {
      expect(
        validateSettings({
          ...baseSettings,
          contentExtractorProvider: "local-with-tavily-fallback",
          tavilyApiKey: "",
        }).errors,
      ).toEqual([]);
      expect(
        validateSettings({
          ...baseSettings,
          contentExtractorProvider: "tavily",
          tavilyApiKey: "",
        }).errors,
      ).toContain("Tavily APIキーを入力してください");
    });

    it("選択中のLLM endpoint/modelの不整合を検証する", () => {
      expect(
        validateSettings({
          ...baseSettings,
          selectedLlmEndpointId: "missing-endpoint",
        }).errors,
      ).toContain("選択中のLLMエンドポイントが存在しません");
      expect(
        validateSettings({
          ...baseSettings,
          selectedLlmModelId: "missing-model",
        }).errors,
      ).toContain("選択中のLLMモデルが存在しません");
      expect(
        validateSettings({
          ...baseSettings,
          llmEndpoints: [
            ...baseSettings.llmEndpoints,
            {
              id: "endpoint-2",
              name: "Azure OpenAI",
              endpoint: "https://azure.example.com/openai",
              apiKey: "azure-key",
            },
          ],
          llmModels: [
            ...baseSettings.llmModels,
            {
              id: "model-2",
              endpointId: "endpoint-2",
              modelName: "gpt-4.1",
            },
          ],
          selectedLlmModelId: "model-2",
        }).errors,
      ).toContain(
        "選択中のLLMモデルが選択中のエンドポイントに紐付いていません",
      );
    });
  });

  describe("daily summary quota state", () => {
    it("今日の日付と一致しない保存値は0件にリセットして返す", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        dailySummaryQuotaDate: "2026-04-23",
        dailySummaryQuotaCount: 5,
      });

      const result = await getDailySummaryQuotaState("2026-04-24");

      expect(result).toEqual({
        date: "2026-04-24",
        count: 0,
      });
    });

    it("日次要約クォータを保存して増加できる", async () => {
      mockChromeStorage.local.get.mockResolvedValue({
        dailySummaryQuotaDate: "2026-04-24",
        dailySummaryQuotaCount: 1,
      });

      await setDailySummaryQuotaState({
        date: "2026-04-24",
        count: 1,
      });
      const result = await incrementDailySummaryQuotaCount("2026-04-24");

      expect(mockChromeStorage.local.set).toHaveBeenNthCalledWith(1, {
        dailySummaryQuotaDate: "2026-04-24",
        dailySummaryQuotaCount: 1,
      });
      expect(mockChromeStorage.local.set).toHaveBeenNthCalledWith(2, {
        dailySummaryQuotaDate: "2026-04-24",
        dailySummaryQuotaCount: 2,
      });
      expect(result).toEqual({
        date: "2026-04-24",
        count: 2,
      });
    });
  });

  describe("session logs", () => {
    function setupSessionLogStorage(
      initialValues: Record<string, unknown> = {},
    ): Record<string, unknown> {
      const storedValues: Record<string, unknown> = {
        ...initialValues,
      };

      mockChromeStorage.local.get.mockImplementation(async (keys?: string[]) => {
        if (!Array.isArray(keys)) {
          return storedValues;
        }

        return Object.fromEntries(
          keys.flatMap((key) =>
            storedValues[key] === undefined ? [] : [[key, storedValues[key]]],
          ),
        );
      });
      mockChromeStorage.local.set.mockImplementation(
        async (values: Record<string, unknown>) => {
          Object.assign(storedValues, values);
        },
      );
      mockChromeStorage.local.remove.mockImplementation(async (keys: string[]) => {
        for (const key of keys) {
          delete storedValues[key];
        }
      });

      return storedValues;
    }

    it("generateSessionId は YYYYMMdd-HHmmss 形式で返す", () => {
      expect(generateSessionId(new Date("2026-05-10T14:30:22"))).toBe(
        "20260510-143022",
      );
    });

    it("start -> append -> complete でセッションログを記録できる", async () => {
      const storedValues = setupSessionLogStorage();

      const log = await startSessionLog("20260510-143022", "manual");
      await appendSessionLogEvent("20260510-143022", {
        type: "entry-start",
        timestamp: 2,
        entryUrl: "https://example.com",
        entryTitle: "Example",
      });
      await completeSessionLog("20260510-143022");

      expect(log.sessionId).toBe("20260510-143022");
      expect(storedValues.sessionLogIndex).toEqual(["20260510-143022"]);
      const sessionLog = storedValues["sessionLog:20260510-143022"] as SessionLog;
      expect(sessionLog.trigger).toBe("manual");
      expect(sessionLog.completedAt).toBeTypeOf("number");
      expect(sessionLog.events.map((event) => event.type)).toEqual([
        "session-start",
        "entry-start",
        "session-complete",
      ]);
    });

    it("pruneSessionLogs は保持件数を超えた古いログを削除する", async () => {
      const storedValues = setupSessionLogStorage({
        sessionLogIndex: ["1", "2", "3"],
        "sessionLog:1": { sessionId: "1", trigger: "scheduled", startedAt: 1, events: [] },
        "sessionLog:2": { sessionId: "2", trigger: "scheduled", startedAt: 2, events: [] },
        "sessionLog:3": { sessionId: "3", trigger: "scheduled", startedAt: 3, events: [] },
      });

      await pruneSessionLogs(2);

      expect(storedValues.sessionLogIndex).toEqual(["2", "3"]);
      expect(storedValues["sessionLog:1"]).toBeUndefined();
      expect(storedValues["sessionLog:2"]).toBeDefined();
      expect(storedValues["sessionLog:3"]).toBeDefined();
    });

    it("getAllSessionLogs はインデックス順ですべて返す", async () => {
      setupSessionLogStorage({
        sessionLogIndex: ["old", "new"],
        "sessionLog:old": {
          sessionId: "old",
          trigger: "scheduled",
          startedAt: 1,
          events: [],
        },
        "sessionLog:new": {
          sessionId: "new",
          trigger: "manual",
          startedAt: 2,
          events: [],
        },
      });

      const logs = await getAllSessionLogs();

      expect(logs.map((log) => log.sessionId)).toEqual(["old", "new"]);
    });
  });
});
