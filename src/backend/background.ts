interface Settings {
  daysUntilRead: number;
  daysUntilDelete: number;
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  slackWebhookUrl?: string;
}

// デフォルト設定
const DEFAULT_SETTINGS: Settings = {
  daysUntilRead: 30,
  daysUntilDelete: 60,
};

/**
 * chrome.storage.localから設定を取得
 */
export async function getSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get([
      "daysUntilRead",
      "daysUntilDelete",
      "openaiEndpoint",
      "openaiApiKey",
      "openaiModel",
      "slackWebhookUrl",
    ]);

    return {
      daysUntilRead: result.daysUntilRead ?? DEFAULT_SETTINGS.daysUntilRead,
      daysUntilDelete:
        result.daysUntilDelete ?? DEFAULT_SETTINGS.daysUntilDelete,
      openaiEndpoint: result.openaiEndpoint,
      openaiApiKey: result.openaiApiKey,
      openaiModel: result.openaiModel,
      slackWebhookUrl: result.slackWebhookUrl,
    };
  } catch (error) {
    console.error("設定取得エラー:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Chromeリーディングリストからエントリ一覧を取得
 */
export async function getReadingListEntries(): Promise<
  chrome.readingList.ReadingListEntry[]
> {
  try {
    const entries = await chrome.readingList.query({});
    console.log(`📊 取得件数: ${entries.length}件`);

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
