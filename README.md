# ReadingListAutoSummary
Automatically mark old entries as read in Chrome’s Reading List and generate AI-powered summaries before archiving.

## 概要

ReadingListAutoSummaryは、Chromeの標準リーディングリスト機能（`chrome.readingList` API）を活用し、一定期間経過したエントリを自動既読化・自動削除します。  
さらに、既読化のタイミングでエントリ本文を要約し、Slackへ自動投稿します。

## 主な特徴・機能

- **Chromeリーディングリスト連携**  
  Chrome標準APIによるリーディングリストの自動管理（既読化・削除）

- **既読化・削除の自動化**  
  - 未読エントリは「既読化までの日数」（デフォルト：30日）経過で自動既読化
  - 既読エントリは「削除までの日数」（デフォルト：60日）経過で自動削除
  - 期間はオプション画面で設定可能

- **要約生成・Slack投稿**  
  - 既読化のタイミングで、エントリの「タイトル」「URL」「本文」を要約
  - 本文はFirecrawl（[公式JS SDK](https://docs.firecrawl.dev/sdks/node)）で抽出
  - LLM（OpenAI SDK/OpenAI互換API）で3文・600文字以内に要約
  - 要約結果をSlack Webhook URL経由で自動投稿

- **設定管理**  
  - オプション画面で下記項目を設定・保存（`chrome.storage.local`利用）
    - 既読化までの日数（デフォルト：30日）
    - 削除までの日数（デフォルト：60日）
    - OpenAI互換APIエンドポイント
    - APIキー
    - モデル名
    - Slack Webhook URL
    - Firecrawl Base URL（デフォルト: https://api.firecrawl.dev）

- **ユーザーインターフェース**  
  - 基本的にUIは不要
  - 設定のためのオプション画面のみ
  - 実行履歴やエラーはChrome拡張のコンソールへデバッグログ出力

## 処理フロー

1. **定期処理（バックグラウンドスクリプト）**
    - Chromeリーディングリストからエントリ取得
    - 未読エントリの登録日時をチェックし、規定日数経過で既読化
    - 既読化時に本文をFirecrawl SDKで抽出
    - 本文・タイトル・URLをOpenAI互換APIで要約（3文・600文字以内）
    - Slack Webhookへ指定フォーマットで投稿
    - 既読エントリの既読化日時をチェックし、規定日数経過で自動削除

2. **本文抽出・要約失敗時の挙動**
    - 本文抽出やLLM要約が失敗した場合、指数バックオフ（exponential backoff）で最大3回までリトライ
    - リトライしても失敗した場合、Slack投稿時に「タイトル」「URL」とともに、本文には要約失敗理由を記載

## Slack投稿フォーマット

```
{title}
{url}

{model_name}による要約

{本文section1}

{本文section2}

{本文section3}
```
- 通常は要約結果を3分割してsection1〜3に表示
- 失敗時はsection1に失敗理由を記載し、section2・3は空欄

## 使用技術

- Chrome拡張（Manifest V3）
- chrome.readingList API
- Firecrawl JS SDK（本文抽出）
- OpenAI SDK（OpenAI互換API対応）
- Slack Webhook
- chrome.storage.local（設定保存）

## Firecrawlの利用

- 既定のBase URLは `https://api.firecrawl.dev` です。オプション画面で Base URL を変更すれば、`http://localhost:3002` などセルフホストした Firecrawl サーバーにも接続できます。
- セルフホスト環境では `Authorization` ヘッダーの値に任意の文字列を指定できますが、フォームには空でない値を入力してください。

## 今後の拡張予定

- Firecrawlによる本文抽出の自前実装への切り替え

## 注意事項

- Slack連携はWebhook URLのみ対応
- LLMモデルはユーザー自身がAPI設定画面でモデル名を指定
- 本拡張はChromeリーディングリストAPI（`chrome.readingList`）が利用可能な環境が必要です
