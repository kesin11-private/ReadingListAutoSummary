import {
  DEFAULT_SYSTEM_PROMPT,
  DELETION_DISABLED_VALUE,
  getDailySummaryQuotaState,
  getSettings,
  incrementDailySummaryQuotaCount,
  type Settings,
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
  await processReadingListEntries();
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
): Promise<void> {
  const extractResult = await extractContent(
    entry.url,
    buildExtractorConfig(settings),
  );
  const extractionSummary = summarizeExtractionResult(extractResult);

  if (!extractResult.success) {
    console.error(
      `本文抽出失敗: ${entry.title} (${extractionSummary}) - ${extractResult.error}`,
    );
    await notifyExtractionError(
      entry,
      settings,
      `${extractResult.error} (${extractionSummary})`,
    );
    return;
  }

  console.log(`本文抽出成功: ${entry.title} (${extractionSummary})`);
  await processSummarization(entry, extractResult.content, settings);
}

/**
 * 要約処理とSlack投稿を行うヘルパー関数
 */
async function processSummarization(
  entry: chrome.readingList.ReadingListEntry,
  content: string,
  settings: Settings,
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
    return;
  }

  const summarizeResult = await summarizeContent(
    entry.title,
    entry.url,
    content,
    createSummarizerConfig(llmConfig),
    getSystemPrompt(settings),
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

  await postToSlack(settings.slackWebhookUrl, slackMessage);
}

/**
 * 抽出エラーをSlackに通知するヘルパー関数
 */
async function notifyExtractionError(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
  error?: string,
): Promise<void> {
  const selectedModel = getSelectedLlmModel(settings);

  if (!settings.slackWebhookUrl || !selectedModel?.modelName.trim()) {
    return;
  }

  const errorMessage = formatSlackErrorMessage(
    entry.title,
    entry.url,
    selectedModel.modelName,
    `本文抽出失敗: ${error}`,
  );
  await postToSlack(settings.slackWebhookUrl, errorMessage);
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
 * 未読エントリを既読化し、要約をSlackへ投稿
 */
export async function markAsReadAndNotify(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
): Promise<void> {
  try {
    console.log(`既読化処理開始: ${entry.title} (${entry.url})`);

    // エントリを既読にマーク
    await chrome.readingList.updateEntry({
      url: entry.url,
      hasBeenRead: true,
    });

    console.log(`既読化完了: ${entry.title}`);

    // 本文抽出とSlack投稿処理
    await processContentExtraction(entry, settings);
  } catch (error) {
    console.error(`既読化エラー: ${entry.title}`, error);
    throw error;
  }
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
export async function processReadingListEntries(): Promise<void> {
  console.log("リーディングリスト自動処理開始");

  try {
    // 設定を取得
    const settings = await getSettings();
    const maxEntriesPerDay = settings.maxEntriesPerDay ?? 3;
    const dailySummaryQuotaState = await getDailySummaryQuotaState();
    const processedToday = dailySummaryQuotaState.count;
    const remainingDailySummaryQuota = Math.max(
      0,
      maxEntriesPerDay - processedToday,
    );
    console.log(
      `設定: 既読化まで${settings.daysUntilRead}日、削除まで${settings.daysUntilDelete}日、1日の要約上限${maxEntriesPerDay}件、今日の処理済み${processedToday}件`,
    );

    // エントリ一覧を取得
    const entries = await getReadingListEntries();

    // 既読化対象のエントリをフィルタリング
    const allEntriesToMarkAsRead = entries.filter((entry) =>
      shouldMarkAsRead(entry, settings.daysUntilRead),
    );

    // 古い順にソートし、自動実行時は日次要約上限の残枠で制限
    const sortedEntriesToMarkAsRead = allEntriesToMarkAsRead.sort(
      (a, b) => a.creationTime - b.creationTime,
    );
    const entriesToMarkAsRead = sortedEntriesToMarkAsRead.slice(
      0,
      remainingDailySummaryQuota,
    );

    // 削除対象のエントリをフィルタリング
    const entriesToDelete = entries.filter((entry) =>
      shouldDelete(entry, settings.daysUntilDelete),
    );

    console.log(
      `処理対象: 既読化${entriesToMarkAsRead.length}件（全体${allEntriesToMarkAsRead.length}件のうち、今日の残枠${remainingDailySummaryQuota}件）、削除${entriesToDelete.length}件`,
    );

    // 既読化処理
    for (const entry of entriesToMarkAsRead) {
      try {
        await markAsReadAndNotify(entry, settings);
        await incrementDailySummaryQuotaCount();
      } catch (error) {
        console.error(`既読化処理失敗: ${entry.title}`, error);
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

    console.log("リーディングリスト自動処理完了");
  } catch (error) {
    console.error("リーディングリスト自動処理でエラーが発生:", error);
  }
}
