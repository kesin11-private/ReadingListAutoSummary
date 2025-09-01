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
