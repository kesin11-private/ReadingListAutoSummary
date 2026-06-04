import {
  appendSessionLogEvent,
  completeSessionLog,
  generateSessionId,
  pruneSessionLogs,
  type SessionLogEvent,
  type SessionLogStep,
  type SessionTrigger,
  startSessionLog,
} from "../common/chrome_storage";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionLogger {
  private constructor(private readonly sessionId: string | null) {}

  static async create(trigger: SessionTrigger): Promise<SessionLogger> {
    const sessionId = generateSessionId();

    try {
      await startSessionLog(sessionId, trigger);
      return new SessionLogger(sessionId);
    } catch (error) {
      console.error(`セッションログ開始エラー (trigger: ${trigger}):`, error);
      return new SessionLogger(null);
    }
  }

  static noop(): SessionLogger {
    return new SessionLogger(null);
  }

  private async appendEvent(event: SessionLogEvent): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      await appendSessionLogEvent(this.sessionId, event);
    } catch (error) {
      console.error(
        `セッションログ追記エラー (session: ${this.sessionId}, type: ${event.type}):`,
        error,
      );
    }
  }

  async logSuccess(
    entry: chrome.readingList.ReadingListEntry,
    step: SessionLogStep,
    message: string,
  ): Promise<void> {
    console.log(message);
    await this.appendEvent({
      type: "step-success",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
      step,
      detail: message,
    });
  }

  async logStepStart(
    entry: chrome.readingList.ReadingListEntry,
    step: SessionLogStep,
    message: string,
  ): Promise<void> {
    console.log(message);
    await this.appendEvent({
      type: "step-start",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
      step,
      detail: message,
    });
  }

  async logStepRetry(
    entry: chrome.readingList.ReadingListEntry,
    step: SessionLogStep,
    message: string,
  ): Promise<void> {
    console.warn(message);
    await this.appendEvent({
      type: "step-retry",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
      step,
      detail: message,
    });
  }

  async logFailure(
    entry: chrome.readingList.ReadingListEntry,
    step: SessionLogStep,
    message: string,
    error?: unknown,
  ): Promise<void> {
    console.error(message, error);

    await this.appendEvent({
      type: "step-failure",
      timestamp: Date.now(),
      entryUrl: entry.url,
      entryTitle: entry.title,
      step,
      detail: message,
    });
  }

  async logEntryStart(
    entry: chrome.readingList.ReadingListEntry,
  ): Promise<void> {
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
      console.error(
        `セッションログ完了エラー (session: ${this.sessionId}):`,
        error,
      );
    });
    await pruneSessionLogs(maxDebugSessionLogs).catch((error) => {
      console.error(
        `セッションログ削除エラー (session: ${this.sessionId}, max: ${maxDebugSessionLogs}):`,
        error,
      );
    });
  }

  async logError(
    message: string,
    error: unknown,
    entry?: chrome.readingList.ReadingListEntry,
  ): Promise<void> {
    console.error(message, error);
    await this.appendEvent({
      type: "session-error",
      timestamp: Date.now(),
      ...(entry
        ? {
            entryUrl: entry.url,
            entryTitle: entry.title,
          }
        : {}),
      detail: `${message}: ${getErrorMessage(error)}`,
    });
  }
}
