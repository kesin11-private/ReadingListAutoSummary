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
    console.log(`[DEBUG] 取得件数: ${entries.length}件`);

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
  _settings: Settings,
): Promise<void> {
  try {
    console.log(`[INFO] 既読化処理開始: ${entry.title} (${entry.url})`);

    // エントリを既読にマーク
    await chrome.readingList.updateEntry({
      url: entry.url,
      hasBeenRead: true,
    });

    console.log(`[INFO] 既読化完了: ${entry.title}`);

    // TODO: Firecrawl SDK での本文抽出と OpenAI API での要約、Slack 投稿処理を実装
    // 現在は要約・投稿機能をスキップして既読化のみ実行
    console.log("[INFO] 要約・Slack投稿機能は今後実装予定");
  } catch (error) {
    console.error(`[ERROR] 既読化エラー: ${entry.title}`, error);
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
    console.log(`[INFO] 削除処理開始: ${entry.title} (${entry.url})`);

    await chrome.readingList.removeEntry({
      url: entry.url,
    });

    console.log(`[INFO] 削除完了: ${entry.title}`);
  } catch (error) {
    console.error(`[ERROR] 削除エラー: ${entry.title}`, error);
    throw error;
  }
}

/**
 * リーディングリストエントリの一括処理
 */
export async function processReadingListEntries(): Promise<void> {
  console.log("[INFO] リーディングリスト自動処理開始");

  try {
    // 設定を取得
    const settings = await getSettings();
    console.log(
      `[DEBUG] 設定: 既読化まで${settings.daysUntilRead}日、削除まで${settings.daysUntilDelete}日`,
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
      `[DEBUG] 処理対象: 既読化${entriesToMarkAsRead.length}件、削除${entriesToDelete.length}件`,
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

    console.log("[INFO] リーディングリスト自動処理完了");
  } catch (error) {
    console.error("[ERROR] リーディングリスト自動処理でエラーが発生:", error);
  }
}

// Chrome拡張のアラーム設定
const ALARM_NAME = "readingListAutoProcess";
const ALARM_INTERVAL_MINUTES = 60; // 1時間ごと

/**
 * アラームを設定（拡張起動時・更新時）
 */
async function setupAlarm(): Promise<void> {
  // 既存のアラームをクリア
  await chrome.alarms.clear(ALARM_NAME);

  // 新しいアラームを作成
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1, // 1分後に初回実行
    periodInMinutes: ALARM_INTERVAL_MINUTES, // 以降1時間ごと
  });

  console.log(`[INFO] アラーム設定完了: ${ALARM_INTERVAL_MINUTES}分間隔`);
}

// テスト環境でない場合のみランタイムイベントを設定
if (typeof globalThis !== "undefined" && globalThis.chrome && chrome.runtime) {
  // 拡張起動・更新時にアラームを設定
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[INFO] 拡張がインストール/更新されました");
    setupAlarm();
  });

  chrome.runtime.onStartup.addListener(() => {
    console.log("[INFO] Chrome起動時に拡張が開始されました");
    setupAlarm();
  });

  // アラーム実行時のイベントリスナー
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.log("[INFO] 定期処理アラームが発火しました");
      processReadingListEntries();
    }
  });
}
