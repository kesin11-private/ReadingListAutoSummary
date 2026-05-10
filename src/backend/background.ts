import {
  appendSessionLogEvent,
  completeSessionLog,
  DEFAULT_SYSTEM_PROMPT,
  DELETION_DISABLED_VALUE,
  generateSessionId,
  getDailySummaryQuotaState,
  getSettings,
  incrementDailySummaryQuotaCount,
  pruneSessionLogs,
  type SessionLogEvent,
  type SessionLogStep,
  type SessionTrigger,
  type Settings,
  startSessionLog,
} from "../common/chrome_storage";
import {
  getSelectedLlmEndpoint,
  getSelectedLlmModel,
  type ResolvedLlmConfig,
  resolveSelectedLlmConfig,
} from "../common/llm_settings";
import type {
  FrontendMessage,
  ManualExecuteResult,
  SlackTestResult,
} from "../types/messages";
import {
  type ExtractContentConfig,
  type ExtractContentResult,
  extractContent,
  summarizeExtractionResult,
} from "./content_extractor";
import { postToSlack } from "./post";
import {
  formatSlackErrorMessage,
  formatSlackMessage,
  type SummarizeResult,
  type SummarizerConfig,
  summarizeContent,
} from "./summarizer";
import "./alarm"; // アラーム処理の初期化

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let activeReadingListProcessing: Promise<void> | null = null;

class SessionLogger {
  private constructor(private readonly sessionId: string | null) {}

  static async create(trigger: SessionTrigger): Promise<SessionLogger> {
    const sessionId = generateSessionId();

    try {
      await startSessionLog(sessionId, trigger);
      return new SessionLogger(sessionId);
    } catch (error) {
      console.error("セッションログ開始エラー:", error);
      return new SessionLogger(null);
    }
  }

  static noop(): SessionLogger {
    return new SessionLogger(null);
  }

  async appendEvent(event: SessionLogEvent): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      await appendSessionLogEvent(this.sessionId, event);
    } catch (error) {
      console.error("セッションログ追記エラー:", error);
    }
  }

  async appendStep(
    entry: chrome.readingList.ReadingListEntry,
    step: SessionLogStep,
    success: boolean,
    detail?: string,
  ): Promise<void> {
    await this.appendEvent({
      type: success ? "step-success" : "step-failure",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
      step,
      ...(detail ? { detail } : {}),
    });
  }

  async startEntry(entry: chrome.readingList.ReadingListEntry): Promise<void> {
    await this.appendEvent({
      type: "entry-start",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
    });
  }

  async complete(maxDebugSessionLogs: number): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    await completeSessionLog(this.sessionId).catch((error) => {
      console.error("セッションログ完了エラー:", error);
    });
    await pruneSessionLogs(maxDebugSessionLogs).catch((error) => {
      console.error("セッションログ削除エラー:", error);
    });
  }

  async sessionError(error: unknown): Promise<void> {
    await this.appendEvent({
      type: "session-error",
      timestamp: Date.now(),
      detail: getErrorMessage(error),
    });
  }
}

function createExtractFailureResult(error: unknown): ExtractContentResult {
  return {
    success: false,
    error: getErrorMessage(error),
    outcome: "local-failed-no-fallback",
    attempts: [],
  };
}

function createMessageFailureResult(error: unknown): ManualExecuteResult {
  return {
    success: false,
    error: getErrorMessage(error),
  };
}

type MessageResponse =
  | ExtractContentResult
  | SummarizeResult
  | SlackTestResult
  | ManualExecuteResult;

function sendAsyncMessageResponse(
  responsePromise: Promise<MessageResponse>,
  sendResponse: (response: MessageResponse) => void,
): true {
  responsePromise.then(sendResponse).catch((error: unknown) => {
    sendResponse(createMessageFailureResult(error));
  });

  return true;
}

function createSummarizerConfig(
  llmConfig: ResolvedLlmConfig,
): SummarizerConfig {
  return {
    endpoint: llmConfig.endpoint,
    apiKey: llmConfig.apiKey,
    model: llmConfig.modelName,
  };
}

function getSystemPrompt(settings: Settings): string {
  return settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

function getLlmDebugInfo(settings: Settings): Record<string, unknown> {
  const selectedEndpoint = getSelectedLlmEndpoint(settings);
  const selectedModel = getSelectedLlmModel(settings);

  return {
    selectedLlmEndpointId: settings.selectedLlmEndpointId,
    selectedLlmModelId: settings.selectedLlmModelId,
    selectedEndpoint: selectedEndpoint
      ? {
          id: selectedEndpoint.id,
          name: selectedEndpoint.name,
          endpoint: selectedEndpoint.endpoint,
          apiKeyConfigured: selectedEndpoint.apiKey.trim() !== "",
        }
      : null,
    selectedModel: selectedModel
      ? {
          id: selectedModel.id,
          endpointId: selectedModel.endpointId,
          modelName: selectedModel.modelName,
        }
      : null,
  };
}

function logLlmResolutionFailure(
  context: string,
  settings: Settings,
  error: string,
): void {
  console.error(`${context}: ${error}`, getLlmDebugInfo(settings));
}

/**
 * メッセージハンドラーの初期化
 */
function initializeMessageHandlers(): void {
  // Chrome extension runtime environment check
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener(
      (
        request: FrontendMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: MessageResponse) => void,
      ) => {
        if (request.type === "EXTRACT_CONTENT") {
          return sendAsyncMessageResponse(
            handleExtractContentMessage(request.url),
            sendResponse,
          );
        }

        if (request.type === "SUMMARIZE_TEST") {
          return sendAsyncMessageResponse(
            handleSummarizeTestMessage(
              request.title,
              request.url,
              request.content,
            ),
            sendResponse,
          );
        }

        if (request.type === "SLACK_TEST") {
          return sendAsyncMessageResponse(
            handleSlackTestMessage(
              request.title,
              request.url,
              request.modelName,
              request.summary,
            ),
            sendResponse,
          );
        }

        if (request.type === "MANUAL_EXECUTE") {
          return sendAsyncMessageResponse(
            handleManualExecuteMessage(),
            sendResponse,
          );
        }

        return false;
      },
    );
  }
}

/**
 * コンテンツ抽出メッセージハンドラー
 */
async function handleExtractContentMessage(
  url: string,
): Promise<ExtractContentResult> {
  try {
    const settings = await getSettings();
    return await extractContent(url, buildExtractorConfig(settings));
  } catch (error) {
    return createExtractFailureResult(error);
  }
}

/**
 * 要約テストメッセージハンドラー
 */
async function handleSummarizeTestMessage(
  title: string,
  url: string,
  content: string,
): Promise<SummarizeResult> {
  try {
    const settings = await getSettings();
    const { config: llmConfig, error } = resolveSelectedLlmConfig(settings);

    if (!llmConfig) {
      logLlmResolutionFailure(
        "要約テスト用LLM設定の解決に失敗",
        settings,
        error || "LLM設定の解決に失敗しました。",
      );
      return {
        success: false,
        error: error || "LLM設定の解決に失敗しました。",
      };
    }

    return await summarizeContent(
      title,
      url,
      content,
      createSummarizerConfig(llmConfig),
      getSystemPrompt(settings),
    );
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Slack投稿テストメッセージハンドラー
 */
async function handleSlackTestMessage(
  title: string,
  url: string,
  modelName: string,
  summary: string,
): Promise<SlackTestResult> {
  try {
    const settings = await getSettings();

    if (!settings.slackWebhookUrl) {
      return {
        success: false,
        error:
          "Slack Webhook URLが設定されていません。設定を保存してからお試しください。",
      };
    }

    const slackMessage = formatSlackMessage(title, url, modelName, summary);
    await postToSlack(settings.slackWebhookUrl, slackMessage);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * 手動実行メッセージハンドラー
 */
async function handleManualExecuteMessage(): Promise<ManualExecuteResult> {
  await processReadingListEntries("manual");
  return { success: true };
}

// Initialize message handlers
initializeMessageHandlers();

/**
 * Chromeリーディングリストからエントリ一覧を取得
 */
export async function getReadingListEntries(): Promise<
  chrome.readingList.ReadingListEntry[]
> {
  try {
    const entries = await chrome.readingList.query({});
    console.log(`取得件数: ${entries.length}件`);

    return entries;
  } catch (error) {
    console.error("リーディングリスト取得エラー:", error);
    return [];
  }
}

/**
 * 未読エントリが既読化の対象かどうかを判定
 */
export function shouldMarkAsRead(
  entry: chrome.readingList.ReadingListEntry,
  daysUntilRead: number,
): boolean {
  if (entry.hasBeenRead) {
    return false; // 既に既読の場合は対象外
  }

  const now = Date.now();
  const daysSinceCreation = (now - entry.creationTime) / (1000 * 60 * 60 * 24);

  return daysSinceCreation >= daysUntilRead;
}

/**
 * 既読エントリが削除の対象かどうかを判定
 */
export function shouldDelete(
  entry: chrome.readingList.ReadingListEntry,
  daysUntilDelete: number,
): boolean {
  if (daysUntilDelete === DELETION_DISABLED_VALUE) {
    return false; // 削除機能が無効の場合は削除対象外
  }

  if (!entry.hasBeenRead) {
    return false; // 未読の場合は削除対象外
  }

  const now = Date.now();
  const daysSinceUpdate = (now - entry.lastUpdateTime) / (1000 * 60 * 60 * 24);

  return daysSinceUpdate >= daysUntilDelete;
}

/**
 * 本文抽出とSlack投稿を処理するヘルパー関数
 */
async function processContentExtraction(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
  sessionLogger: SessionLogger,
): Promise<void> {
  const extractResult = await extractContent(
    entry.url,
    buildExtractorConfig(settings),
  ).catch((error: unknown) => createExtractFailureResult(error));
  const extractionSummary = summarizeExtractionResult(extractResult);

  if (!extractResult.success) {
    await sessionLogger.appendStep(
      entry,
      "extract",
      false,
      `${extractResult.error} (${extractionSummary})`,
    );
    console.error(
      `本文抽出失敗: ${entry.title} (${extractionSummary}) - ${extractResult.error}`,
    );
    await notifyExtractionError(
      entry,
      settings,
      `${extractResult.error} (${extractionSummary})`,
      sessionLogger,
    );
    return;
  }

  await sessionLogger.appendStep(
    entry,
    "extract",
    true,
    extractionSummary,
  );
  console.log(`本文抽出成功: ${entry.title} (${extractionSummary})`);
  await processSummarization(entry, extractResult.content, settings, sessionLogger);
}

/**
 * 要約処理とSlack投稿を行うヘルパー関数
 */
async function processSummarization(
  entry: chrome.readingList.ReadingListEntry,
  content: string,
  settings: Settings,
  sessionLogger: SessionLogger,
): Promise<void> {
  const { config: llmConfig, error } = resolveSelectedLlmConfig(settings);

  if (!llmConfig || !settings.slackWebhookUrl) {
    if (!llmConfig) {
      logLlmResolutionFailure(
        `既読化エントリの要約をスキップ: ${entry.title}`,
        settings,
        error || "LLM設定の解決に失敗しました。",
      );
    }
    console.warn(
      "LLM設定またはSlack設定が不完全のため、要約・Slack投稿をスキップ",
    );
    await sessionLogger.appendStep(
      entry,
      "summarize",
      false,
      error || "LLM設定またはSlack設定が不完全のためスキップしました。",
    );
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      false,
      "LLM設定またはSlack設定が不完全のためスキップしました。",
    );
    return;
  }

  const summarizeResult = await summarizeContent(
    entry.title,
    entry.url,
    content,
    createSummarizerConfig(llmConfig),
    getSystemPrompt(settings),
  ).catch((summarizeError: unknown) => ({
    success: false as const,
    error: getErrorMessage(summarizeError),
  }));

  await sessionLogger.appendStep(
    entry,
    "summarize",
    summarizeResult.success,
    summarizeResult.success
      ? `model=${llmConfig.modelName}`
      : summarizeResult.error || "不明なエラー",
  );

  const slackMessage =
    summarizeResult.success && summarizeResult.summary
      ? formatSlackMessage(
          entry.title,
          entry.url,
          llmConfig.modelName,
          summarizeResult.summary,
        )
      : formatSlackErrorMessage(
          entry.title,
          entry.url,
          llmConfig.modelName,
          summarizeResult.error || "不明なエラー",
        );

  try {
    await postToSlack(settings.slackWebhookUrl, slackMessage);
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      true,
      summarizeResult.success
        ? "要約を投稿しました"
        : "エラー通知を投稿しました",
    );
  } catch (error) {
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      false,
      getErrorMessage(error),
    );
    throw error;
  }
}

async function markEntryAsRead(
  entry: chrome.readingList.ReadingListEntry,
): Promise<void> {
  console.log(`既読化処理開始: ${entry.title} (${entry.url})`);

  await chrome.readingList.updateEntry({
    url: entry.url,
    hasBeenRead: true,
  });

  console.log(`既読化完了: ${entry.title}`);
}

export async function processEntryToMarkAsRead(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
  sessionLogger: SessionLogger = SessionLogger.noop(),
): Promise<boolean> {
  try {
    await processContentExtraction(entry, settings, sessionLogger);
  } catch (error) {
    console.error(`要約または通知処理失敗: ${entry.title}`, error);
    return false;
  }

  try {
    await incrementDailySummaryQuotaCount();
    await sessionLogger.appendStep(
      entry,
      "increment-quota",
      true,
      "日次クォータを加算しました",
    );
  } catch (error) {
    await sessionLogger.appendStep(
      entry,
      "increment-quota",
      false,
      getErrorMessage(error),
    );
    console.error(`クォータ更新失敗: ${entry.title}`, error);
    return false;
  }

  try {
    await markEntryAsRead(entry);
    await sessionLogger.appendStep(
      entry,
      "mark-as-read",
      true,
      "既読化しました",
    );
  } catch (error) {
    await sessionLogger.appendStep(
      entry,
      "mark-as-read",
      false,
      getErrorMessage(error),
    );
    console.error(`既読化処理失敗: ${entry.title}`, error);
    return false;
  }

  return true;
}

/**
 * 抽出エラーをSlackに通知するヘルパー関数
 */
async function notifyExtractionError(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
  error?: string,
  sessionLogger: SessionLogger = SessionLogger.noop(),
): Promise<void> {
  const selectedModel = getSelectedLlmModel(settings);

  if (!settings.slackWebhookUrl || !selectedModel?.modelName.trim()) {
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      false,
      "Slack設定またはモデル設定が不完全のためエラー通知をスキップしました。",
    );
    return;
  }

  const errorMessage = formatSlackErrorMessage(
    entry.title,
    entry.url,
    selectedModel.modelName,
    `本文抽出失敗: ${error}`,
  );
  try {
    await postToSlack(settings.slackWebhookUrl, errorMessage);
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      true,
      "本文抽出エラーを投稿しました",
    );
  } catch (postError) {
    await sessionLogger.appendStep(
      entry,
      "post-slack",
      false,
      getErrorMessage(postError),
    );
    throw postError;
  }
}

function buildExtractorConfig(settings: Settings): ExtractContentConfig {
  const config: ExtractContentConfig = {};
  if (settings.contentExtractorProvider) {
    config.mode = settings.contentExtractorProvider;
  }

  const tavilyApiKey = settings.tavilyApiKey?.trim();
  if (!tavilyApiKey) {
    return config;
  }

  config.tavily = {
    apiKey: tavilyApiKey,
  };
  return config;
}

/**
 * 既読エントリを削除
 */
export async function deleteEntry(
  entry: chrome.readingList.ReadingListEntry,
): Promise<void> {
  try {
    console.log(`削除処理開始: ${entry.title} (${entry.url})`);

    await chrome.readingList.removeEntry({
      url: entry.url,
    });

    console.log(`削除完了: ${entry.title}`);
  } catch (error) {
    console.error(`削除エラー: ${entry.title}`, error);
    throw error;
  }
}

/**
 * リーディングリストエントリの一括処理
 */
async function processReadingListEntriesInternal(
  trigger: SessionTrigger,
): Promise<void> {
  console.log("リーディングリスト処理開始");
  let settings: Settings | null = null;
  const sessionLogger = await SessionLogger.create(trigger);

  try {
    // 設定を取得
    settings = await getSettings();
    const resolvedSettings = settings;
    const maxEntriesPerDay = resolvedSettings.maxEntriesPerDay ?? 3;
    const dailySummaryQuotaState = await getDailySummaryQuotaState();
    const processedToday = dailySummaryQuotaState.count;
    const remainingDailySummaryQuota = Math.max(
      0,
      maxEntriesPerDay - processedToday,
    );
    console.log(
      `設定: 既読化まで${resolvedSettings.daysUntilRead}日、削除まで${resolvedSettings.daysUntilDelete}日、1日の要約上限${maxEntriesPerDay}件、今日の処理済み${processedToday}件`,
    );

    // エントリ一覧を取得
    const entries = await getReadingListEntries();

    // 既読化対象のエントリをフィルタリング
    const allEntriesToMarkAsRead = entries.filter((entry) =>
      shouldMarkAsRead(entry, resolvedSettings.daysUntilRead),
    );

    // 古い順にソートし、手動実行・定期実行の両方で共有する日次要約上限の残枠で制限
    const sortedEntriesToMarkAsRead = allEntriesToMarkAsRead.sort(
      (a, b) => a.creationTime - b.creationTime,
    );
    const entriesToMarkAsRead = sortedEntriesToMarkAsRead.slice(
      0,
      remainingDailySummaryQuota,
    );

    // 削除対象のエントリをフィルタリング
    const entriesToDelete = entries.filter((entry) =>
      shouldDelete(entry, resolvedSettings.daysUntilDelete),
    );

    console.log(
      `処理対象: 既読化${entriesToMarkAsRead.length}件（全体${allEntriesToMarkAsRead.length}件のうち、今日の残枠${remainingDailySummaryQuota}件）、削除${entriesToDelete.length}件`,
    );

    // 既読化処理
    for (const entry of entriesToMarkAsRead) {
      await sessionLogger.startEntry(entry);
      const didMarkAsRead = await processEntryToMarkAsRead(
        entry,
        resolvedSettings,
        sessionLogger,
      );
      if (!didMarkAsRead) {
        break;
      }
    }

    // 削除処理
    for (const entry of entriesToDelete) {
      try {
        await deleteEntry(entry);
      } catch (error) {
        console.error(`削除処理失敗: ${entry.title}`, error);
      }
    }

    await sessionLogger.complete(resolvedSettings.maxDebugSessionLogs ?? 10);
    console.log("リーディングリスト処理完了");
  } catch (error) {
    await sessionLogger.sessionError(error);
    console.error("リーディングリスト処理でエラーが発生:", error);
  }
}

export function processReadingListEntries(
  trigger: SessionTrigger = "scheduled",
): Promise<void> {
  if (activeReadingListProcessing) {
    console.log(
      "リーディングリスト処理は既に実行中のため、進行中の処理完了を待機します",
    );
    return activeReadingListProcessing;
  }

  activeReadingListProcessing = processReadingListEntriesInternal(
    trigger,
  ).finally(() => {
    activeReadingListProcessing = null;
  });
  return activeReadingListProcessing;
}
