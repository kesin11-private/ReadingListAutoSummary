import { getSettings, validateSettings } from "../common/chrome_storage";
import { processReadingListEntries } from "./background";

// Chrome拡張のアラーム設定
const ALARM_NAME = "readingListAutoProcess";

/**
 * ランタイム環境の検出
 */
function isRuntimeEnvironment(): boolean {
  return (
    typeof globalThis !== "undefined" && !!globalThis.chrome && !!chrome.runtime
  );
}

/**
 * アラームを設定（拡張起動時・更新時）
 */
export async function setupAlarm(): Promise<void> {
  // 既存のアラームをクリア
  await chrome.alarms.clear(ALARM_NAME);

  // 設定から間隔を取得（不正値はデフォルトにフォールバック）
  let intervalMinutes: number;
  try {
    const settings = await getSettings();
    const partial: Partial<import("../common/chrome_storage").Settings> = {};
    if (settings.alarmIntervalMinutes !== undefined) {
      partial.alarmIntervalMinutes = settings.alarmIntervalMinutes;
    }
    const errors = validateSettings(partial);
    if (errors.length > 0 || !settings.alarmIntervalMinutes) {
      // バリデーションNGまたは未設定時はデフォルト使用
      intervalMinutes = 720;
    } else {
      intervalMinutes = settings.alarmIntervalMinutes;
    }
  } catch {
    intervalMinutes = 720;
  }

  // 新しいアラームを作成
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1, // 1分後に初回実行
    periodInMinutes: intervalMinutes,
  });

  console.log(`アラーム設定完了: ${intervalMinutes}分間隔`);
}

/**
 * アラームイベントハンドラーの初期化
 */
export function initializeAlarmHandlers(): void {
  if (!isRuntimeEnvironment()) {
    return;
  }

  // 拡張起動・更新時にアラームを設定
  chrome.runtime.onInstalled.addListener(() => {
    console.log("拡張がインストール/更新されました");
    setupAlarm();
  });

  chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome起動時に拡張が開始されました");
    setupAlarm();
  });

  // アラーム実行時のイベントリスナー
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.log("定期処理アラームが発火しました");
      processReadingListEntries();
    }
  });
}

// テスト環境でない場合のみランタイムイベントを設定
initializeAlarmHandlers();
