# Bot移行チェックリスト

## 移行前の準備

### 1. Discord Bot設定
- [ ] 新しいDiscord Applicationを作成（または既存のBotを使用）
- [ ] Botトークンを取得
- [ ] Application IDを取得
- [ ] 必要なIntentを有効化
  - [ ] Server Members Intent（GUILD_MEMBERS）
  - [ ] Message Content Intent（MESSAGE_CONTENT）

### 2. 新サーバー準備
- [ ] メインチャンネル作成
- [ ] 匿名チャンネル作成
- [ ] 部室カテゴリー（2つ）作成
- [ ] 廃部候補カテゴリー作成
- [ ] 人気部活カテゴリー作成
- [ ] アーカイブカテゴリー作成
- [ ] アーカイブオーバーフローカテゴリー作成
- [ ] 部活パネルチャンネル作成
- [ ] 再起動通知チャンネル作成
- [ ] ワードクラウド除外カテゴリー作成
- [ ] 除外チャンネルリストを準備

### 3. カテゴリー・チャンネルID収集
- [ ] 各チャンネルのIDを取得
- [ ] 各カテゴリーのIDを取得
- [ ] ロールIDを取得
- [ ] 除外チャンネルIDを取得

### 4. 外部サービス
- [ ] Upstash Redisを新規作成
  - [ ] REST URLを取得
  - [ ] REST トークンを取得
- [ ] Notionデータベース準備
  - [ ] APIキーを取得
  - [ ] データベースIDを取得

### 5. Webhook設定
- [ ] 匿名チャンネルのWebhook URLを取得

### 6. 環境変数設定
```bash
# 必須
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NOTION_API_KEY=
NOTION_DATABASE_ID=
ANONYMOUS_WEBHOOK_URL=

# オプション
ADMIN_LOG_CHANNEL_ID=
ANONYMOUS_SALT=
```

## 移行作業

### 1. コードの準備
- [ ] リポジトリをクローンまたはファイルをコピー
- [ ] `config.js`を開く

### 2. config.jsの更新
- [ ] ANONYMOUS_CHANNEL_IDを更新
- [ ] CLUB_CATEGORY_IDを更新
- [ ] CLUB_CATEGORY_ID_2を更新
- [ ] INACTIVE_CLUB_CATEGORY_IDを更新
- [ ] POPULAR_CLUB_CATEGORY_IDを更新
- [ ] ARCHIVE_CATEGORY_IDを更新
- [ ] ARCHIVE_OVERFLOW_CATEGORY_IDを更新
- [ ] CLUB_PANEL_CHANNEL_IDを更新
- [ ] EXCLUDED_CHANNELS配列を更新
- [ ] ROLE_TO_REMOVE_ON_CREATEを更新
- [ ] RESTART_NOTIFICATION_CHANNEL_IDを更新
- [ ] MAIN_CHANNEL_IDを更新
- [ ] WORDCLOUD_EXCLUDED_CATEGORY_IDを更新

### 3. 環境設定
- [ ] `.env`ファイルを作成
- [ ] 全ての環境変数を設定
- [ ] 環境変数ファイルが`.gitignore`に含まれていることを確認

### 4. Botのデプロイ
- [ ] `npm install`で依存関係をインストール
- [ ] 開発環境でテスト実行
- [ ] 本番環境にデプロイ（Fly.io使用時は`flyctl deploy`）

### 5. 動作確認
- [ ] Botがサーバーにオンライン表示される
- [ ] `/help`コマンドで全コマンドが表示される
- [ ] 匿名機能が動作する
- [ ] 部活作成機能が動作する
- [ ] Notion連携が動作する
- [ ] ワードクラウド機能が動作する
- [ ] その他の機能が正常に動作する

## トラブルシューティング

### Botがオンラインにならない
- [ ] DISCORD_BOT_TOKENが正しいか確認
- [ ] Botがサーバーに招待されているか確認
- [ ] ログを確認してエラーを特定

### コマンドが表示されない
- [ ] Botに適切な権限が付与されているか確認
- [ ] コマンドが登録されたか確認（ログを確認）
- [ ] 手動で`node deploy-commands.js`を実行

### チャンネル作成が失敗する
- [ ] Botにチャンネル作成権限があるか確認
- [ ] Botに権限管理権限があるか確認
- [ ] カテゴリーのIDが正しいか確認

### Redis接続エラー
- [ ] UPSTASH_REDIS_REST_URLが正しいか確認
- [ ] UPSTASH_REDIS_REST_TOKENが正しいか確認
- [ ] Upstash Redisが作成されているか確認

### Notion接続エラー
- [ ] NOTION_API_KEYが正しいか確認
- [ ] NOTION_DATABASE_IDが正しいか確認
- [ ] Notionデータベースの権限を確認

## 移行完了後の作業

- [ ] 古いBotを無効化
- [ ] 移行が成功したことをユーザーに通知
- [ ] ログを監視して問題がないか確認
- [ ] 定期的なバックアップを設定

## 重要な注意事項

⚠️ **データは移行されません**
- Redisのデータは新規作成が必要
- Notionデータベースは手動で移行する必要がある
- 部活ランキングは再計算されます

⚠️ **Botの権限は完全に付与する必要があります**
- 権限が不足していると機能が正常に動作しません

⚠️ **config.jsのIDは必ず更新してください**
- 旧サーバーのIDをそのまま使用すると機能しません

