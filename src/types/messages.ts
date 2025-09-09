/**
 * Chrome extension message types
 */

/**
 * Base message interface for Chrome runtime messaging
 */
export interface BaseMessage {
  type: string;
  payload?: { [key: string]: unknown };
}

/**
 * Message for content extraction requests
 */
export interface ExtractContentMessage extends BaseMessage {
  type: "EXTRACT_CONTENT";
  url: string;
}

/**
 * Message for summarization test requests
 */
export interface SummarizeTestMessage extends BaseMessage {
  type: "SUMMARIZE_TEST";
  title: string;
  url: string;
  content: string;
}

/**
 * Message for Slack posting test requests
 */
export interface SlackTestMessage extends BaseMessage {
  type: "SLACK_TEST";
  title: string;
  url: string;
  modelName: string;
  summary: string;
}

/**
 * Result for Slack posting test
 */
export interface SlackTestResult {
  success: boolean;
  error?: string;
}

/**
 * Message for manual execution trigger from options page
 */
export interface ManualExecuteMessage extends BaseMessage {
  type: "MANUAL_EXECUTE";
}

/**
 * Result for manual execution
 */
export interface ManualExecuteResult {
  success: boolean;
  error?: string;
}

/**
 * Union type for all frontend messages
 */
export type FrontendMessage =
  | ExtractContentMessage
  | SummarizeTestMessage
  | SlackTestMessage
  | ManualExecuteMessage;
