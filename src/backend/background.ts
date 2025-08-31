// Chrome Reading List API型定義
interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime: number;
  lastUpdateTime: number;
}

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
export async function getReadingListEntries(): Promise<ReadingListEntry[]> {
  try {
    console.log("📚 リーディングリスト取得開始");
    const entries = await chrome.readingList.query({});
    console.log(`📊 取得件数: ${entries.length}件`);

    // 各エントリの状態をデバッグログ出力
    for (const entry of entries) {
      const status = entry.hasBeenRead ? "既読" : "未読";
      const createdDate = new Date(entry.creationTime).toLocaleDateString(
        "ja-JP",
      );
      const updatedDate = new Date(entry.lastUpdateTime).toLocaleDateString(
        "ja-JP",
      );
      console.log(
        `🔍 [${status}] ${entry.title} (作成: ${createdDate}, 更新: ${updatedDate})`,
      );
    }

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
  entry: ReadingListEntry,
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
  entry: ReadingListEntry,
  daysUntilDelete: number,
): boolean {
  if (!entry.hasBeenRead) {
    return false; // 未読の場合は削除対象外
  }

  const now = Date.now();
  const daysSinceUpdate = (now - entry.lastUpdateTime) / (1000 * 60 * 60 * 24);

  return daysSinceUpdate >= daysUntilDelete;
}
