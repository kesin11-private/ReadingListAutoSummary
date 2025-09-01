import { getSettings, type Settings } from "../common/chrome_storage";
import type { ExtractContentMessage } from "../types/messages";
import { type ExtractContentResult, extractContent } from "./content_extractor";
import "./alarm"; // アラーム処理の初期化

/**
 * メッセージハンドラーの初期化
 */
function initializeMessageHandlers(): void {
  // Chrome extension runtime environment check
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener(
      (
        request: ExtractContentMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: ExtractContentResult) => void,
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

    // Firecrawl SDK で本文抽出
    if (settings.firecrawlApiKey) {
      const extractResult = await extractContent(
        entry.url,
        settings.firecrawlApiKey,
      );

      if (extractResult.success) {
        console.log(`本文抽出成功: ${entry.title}`);
        // TODO: OpenAI API での要約、Slack 投稿処理を実装
        console.log("要約・Slack投稿機能は今後実装予定");
      } else {
        console.error(`本文抽出失敗: ${entry.title} - ${extractResult.error}`);
        // TODO: 抽出失敗をSlackに通知する処理を実装
      }
    } else {
      console.error(
        `Firecrawl API キーが未設定のため、本文抽出をスキップ: ${entry.title}`,
      );
    }
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
