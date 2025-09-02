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
 * Union type for all frontend messages
 */
export type FrontendMessage = ExtractContentMessage | SummarizeTestMessage;
