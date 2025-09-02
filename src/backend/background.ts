import { getSettings, type Settings } from "../common/chrome_storage";
import type { FrontendMessage } from "../types/messages";
import { type ExtractContentResult, extractContent } from "./content_extractor";
import {
  formatSlackErrorMessage,
  formatSlackMessage,
  type SummarizeResult,
  type SummarizerConfig,
  summarizeContent,
} from "./summarizer";
import "./alarm"; // アラーム処理の初期化

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
        sendResponse: (
          response: ExtractContentResult | SummarizeResult,
        ) => void,
      ) => {
        if (request.type === "EXTRACT_CONTENT") {
          handleExtractContentMessage(request.url)
            .then(sendResponse)
            .catch((error) => {
              sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return true; // Will respond asynchronously
        }

        if (request.type === "SUMMARIZE_TEST") {
          handleSummarizeTestMessage(
            request.title,
            request.url,
            request.content,
          )
            .then(sendResponse)
            .catch((error: unknown) => {
              sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return true; // Will respond asynchronously
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

    if (!settings.firecrawlApiKey) {
      return {
        success: false,
        error:
          "Firecrawl API キーが設定されていません。設定を保存してからお試しください。",
      };
    }

    return await extractContent(url, settings.firecrawlApiKey);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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

    if (
      !settings.openaiEndpoint ||
      !settings.openaiApiKey ||
      !settings.openaiModel
    ) {
      return {
        success: false,
        error:
          "OpenAI設定（エンドポイント、APIキー、モデル名）が不完全です。設定を保存してからお試しください。",
      };
    }

    const summarizerConfig: SummarizerConfig = {
      endpoint: settings.openaiEndpoint,
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
    };

    return await summarizeContent(title, url, content, summarizerConfig);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  if (!entry.hasBeenRead) {
    return false; // 未読の場合は削除対象外
  }

  const now = Date.now();
  const daysSinceUpdate = (now - entry.lastUpdateTime) / (1000 * 60 * 60 * 24);

  return daysSinceUpdate >= daysUntilDelete;
}

/**
 * Slackに投稿する
 */
async function postToSlack(webhookUrl: string, message: string): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: message,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log("Slack投稿成功");
  } catch (error) {
    console.error("Slack投稿失敗:", error);
    throw error;
  }
}

/**
 * 本文抽出とSlack投稿を処理するヘルパー関数
 */
async function processContentExtraction(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
): Promise<void> {
  if (!settings.firecrawlApiKey) {
    console.error(
      `Firecrawl API キーが未設定のため、本文抽出をスキップ: ${entry.title}`,
    );
    return;
  }

  const extractResult = await extractContent(
    entry.url,
    settings.firecrawlApiKey,
  );

  if (!extractResult.success || !extractResult.content) {
    console.error(`本文抽出失敗: ${entry.title} - ${extractResult.error}`);
    await notifyExtractionError(entry, settings, extractResult.error);
    return;
  }

  console.log(`本文抽出成功: ${entry.title}`);
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
  const { openaiEndpoint, openaiApiKey, openaiModel, slackWebhookUrl } =
    settings;

  if (!openaiEndpoint || !openaiApiKey || !openaiModel || !slackWebhookUrl) {
    console.warn(
      "OpenAI設定またはSlack設定が不完全のため、要約・Slack投稿をスキップ",
    );
    return;
  }

  const summarizerConfig: SummarizerConfig = {
    endpoint: openaiEndpoint,
    apiKey: openaiApiKey,
    model: openaiModel,
  };

  const summarizeResult = await summarizeContent(
    entry.title,
    entry.url,
    content,
    summarizerConfig,
  );

  const slackMessage =
    summarizeResult.success && summarizeResult.summary
      ? formatSlackMessage(
          entry.title,
          entry.url,
          openaiModel,
          summarizeResult.summary,
        )
      : formatSlackErrorMessage(
          entry.title,
          entry.url,
          openaiModel,
          summarizeResult.error || "不明なエラー",
        );

  await postToSlack(slackWebhookUrl, slackMessage);
}

/**
 * 抽出エラーをSlackに通知するヘルパー関数
 */
async function notifyExtractionError(
  entry: chrome.readingList.ReadingListEntry,
  settings: Settings,
  error?: string,
): Promise<void> {
  if (!settings.slackWebhookUrl || !settings.openaiModel) {
    return;
  }

  const errorMessage = formatSlackErrorMessage(
    entry.title,
    entry.url,
    settings.openaiModel,
    `本文抽出失敗: ${error}`,
  );
  await postToSlack(settings.slackWebhookUrl, errorMessage);
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
    console.log(
      `設定: 既読化まで${settings.daysUntilRead}日、削除まで${settings.daysUntilDelete}日`,
    );

    // エントリ一覧を取得
    const entries = await getReadingListEntries();

    // 既読化対象のエントリをフィルタリング
    const entriesToMarkAsRead = entries.filter((entry) =>
      shouldMarkAsRead(entry, settings.daysUntilRead),
    );

    // 削除対象のエントリをフィルタリング
    const entriesToDelete = entries.filter((entry) =>
      shouldDelete(entry, settings.daysUntilDelete),
    );

    console.log(
      `処理対象: 既読化${entriesToMarkAsRead.length}件、削除${entriesToDelete.length}件`,
    );

    // 既読化処理
    for (const entry of entriesToMarkAsRead) {
      try {
        await markAsReadAndNotify(entry, settings);
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
