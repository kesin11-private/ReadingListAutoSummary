# ReadingListAutoSummary

Chrome の Reading List を定期処理し、古い未読記事を既読化しながら本文を要約して Slack に送る拡張です。

## 主な機能

- 未読記事を一定日数経過後に自動で既読化
- 既読記事を一定日数経過後に自動削除（無効化も可）
- 記事本文を **ローカル HTML 取得 + `@mizchi/readability`** で優先抽出
- ローカル抽出が失敗した場合のみ、**Tavily Extract API** に任意でフォールバック
- OpenAI 互換 API で 3 文・約 600 文字の要約を生成
- Slack Webhook に要約または失敗内容を投稿

## 本文抽出の挙動

本文抽出はローカル優先です。

1. 拡張機能が対象 URL の HTML を直接取得します
2. `@mizchi/readability` で本文を Markdown 化します
3. ローカル取得・解析に失敗し、かつ Tavily API キーが設定されている場合のみ Tavily にフォールバックします
4. Tavily API キーが未設定なら、ローカル抽出のみで完結します

このため通常運用では追加の抽出プロバイダー設定は不要で、Tavily は失敗時の保険として使えます。

## Chrome 権限

ローカルで記事 HTML を取得するため、manifest では広めのホスト権限を使います。

- `https://*/*`
- `http://*/*`
- `https://hooks.slack.com/*`

通常の拡張権限は以下です。

- `storage`
- `readingList`
- `alarms`

## 設定項目

オプション画面では主に以下を設定します。

- 既読化までの日数
- 削除までの日数
- 1 回の実行で既読にする最大件数
- 実行間隔（分）
- LLM エンドポイント一覧（表示名 / OpenAI 互換 API エンドポイント / API キー）
- エンドポイントごとのモデル一覧
- 使用するエンドポイントとモデルの選択状態
- Slack Webhook URL
- Tavily API キー（任意）
- システムプロンプト

## 処理フロー

1. `chrome.readingList` から記事一覧を取得
2. 既読化対象の記事を古い順に処理
3. 記事本文をローカル抽出し、必要時のみ Tavily にフォールバック
4. 要約を生成して Slack に投稿
5. 削除対象の既読記事を削除

本文抽出や要約に失敗した場合は、失敗理由を含むメッセージを Slack に送ります。

## Standalone validation script

`@mizchi/readability` の抽出結果を実 URL で確認するための検証スクリプトがあります。

```bash
node scripts/validate-readability.mjs
```

URL を指定して実行することもできます。

```bash
node scripts/validate-readability.mjs https://example.com/article
```

このスクリプトは以下を確認します。

- HTML 取得成功/失敗
- アクセスブロックらしきレスポンス
- readability の抽出成功/失敗
- 抽出文字数、タイトル、抜粋

## 開発用コマンド

```bash
pnpm test
pnpm type-check
pnpm build
```

## 使用技術

- Chrome Extension (Manifest V3)
- `chrome.readingList`
- `@mizchi/readability`
- Tavily Extract API（任意フォールバック）
- OpenAI SDK
- Preact
- Slack Webhook
- `chrome.storage.local`

## LLM設定管理

- 複数の OpenAI 互換エンドポイントを保存できます。
- 各エンドポイントごとに複数のモデル名を保存できます。
- 要約時は「選択中のエンドポイント + 選択中のモデル」を利用します。
- 旧単一設定（`openaiEndpoint` / `openaiApiKey` / `openaiModel`）が保存されている場合、読み込み時に新しい構造へ自動移行されます。
- エンドポイントを削除すると、そのエンドポイントに紐づくモデルもまとめて削除されます。

## 注意事項

- Slack連携は Webhook URL のみ対応です。
- 動的コンテンツや構造次第では `@mizchi/readability` 単体で本文抽出に失敗する場合があります。
- 本拡張は Chrome Reading List API（`chrome.readingList`）が利用可能な環境が必要です。
