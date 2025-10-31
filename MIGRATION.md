# Bot移行ガイド

このドキュメントは、HisameAI Mark.4を別サーバーに移行する際に必要な情報をまとめたものです。

## 必要な情報一覧

### 1. 環境変数（シークレット情報）

以下の環境変数を新サーバーで設定する必要があります：

```bash
# Discord Bot関連
DISCORD_BOT_TOKEN=<Botのトークン>
DISCORD_APPLICATION_ID=<BotのアプリケーションID>

# Redis（Upstash）関連
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST トークン>

# Notion関連
NOTION_API_KEY=<Notion API キー>
NOTION_DATABASE_ID=<Notion データベースID>

# Webhook URL
ANONYMOUS_WEBHOOK_URL=<匿名チャンネルのWebhook URL>

# 管理ログチャンネル（オプション）
ADMIN_LOG_CHANNEL_ID=<管理者ログチャンネルID>

# 匿名機能用ソルト
ANONYMOUS_SALT=<ハッシュ用ソルト文字列>
```

### 2. Discordサーバー設定

#### 2.1 必要なチャンネルID

新サーバーで以下のチャンネルを作成し、config.jsのIDを更新してください：

| 設定名 | 現在のID | 説明 |
|--------|---------|------|
| ANONYMOUS_CHANNEL_ID | '1377834239206096948' | 匿名チャンネル |
| CLUB_CATEGORY_ID | '1369627451801604106' | 部室カテゴリー1 |
| CLUB_CATEGORY_ID_2 | '1396724037048078470' | 部室カテゴリー2 |
| INACTIVE_CLUB_CATEGORY_ID | '1415923694630469732' | 廃部候補カテゴリ |
| POPULAR_CLUB_CATEGORY_ID | '1417350444619010110' | 人気部活カテゴリ |
| ARCHIVE_CATEGORY_ID | '1421443763087085659' | アーカイブカテゴリ |
| ARCHIVE_OVERFLOW_CATEGORY_ID | '1422186096196063252' | アーカイブオーバーフローカテゴリ |
| CLUB_PANEL_CHANNEL_ID | '1370290635101175879' | 部活パネルチャンネル |
| RESTART_NOTIFICATION_CHANNEL_ID | '1369660410008965203' | 再起動通知チャンネル |
| MAIN_CHANNEL_ID | '1369627467991486605' | メインチャンネル |
| WORDCLOUD_EXCLUDED_CATEGORY_ID | '1370683406345699369' | ワードクラウド除外カテゴリ |

#### 2.2 除外チャンネル

以下は除外リストに入っているチャンネルです：

```javascript
EXCLUDED_CHANNELS: [
    '1373300449788297217',
    '1370290635101175879',
    '1369660410008965203'
]
```

#### 2.3 ロールID

```javascript
ROLE_TO_REMOVE_ON_CREATE: '1373302892823580762'  // 部活作成時に削除するロール
```

### 3. Botの権限設定

Discord Developer Portal（https://discord.com/developers/applications）で以下の権限を設定：

#### 必要な権限
- **Bot権限スコープ**
  - `bot` - Bot権限
  
- **一般権限**
  - Send Messages（メッセージを送信）
  - Read Message History（メッセージ履歴を読む）
  - View Channels（チャンネルの閲覧）
  - Manage Channels（チャンネルの管理）
  - Manage Guild（サーバーの管理）
  - Manage Roles（ロールの管理）
  - Add Reactions（リアクションの追加）
  - Attach Files（ファイルの添付）
  - Embed Links（埋め込みリンク）
  - Use External Emojis（外部絵文字の使用）
  - Manage Messages（メッセージの管理）
  - Read Messages/View Channels（メッセージの読み取り/チャンネルの閲覧）

#### 必要なIntent
- Server Members Intent（GUILD_MEMBERS）
- Message Content Intent（MESSAGE_CONTENT）
- Server Presence Intent（GUILD_PRESENCES）

### 4. 依存サービス

#### 4.1 Upstash Redis
- Upstashアカウントが必要
- データは移行されないため、新規作成が必要です

#### 4.2 Notion
- Notion APIキーとデータベースIDが必要
- データベースは既存のものを使用するか、新規作成が必要です

### 5. ファイル構成

移行時に必要なファイル：

```
commands/       - 全コマンドファイル
events/         - 全イベントファイル
utils/          - ユーティリティファイル
config.js       - 設定ファイル（ID更新が必要）
index.js        - メインエントリーポイント
package.json    - 依存関係
Dockerfile      - Docker設定（Fly.io使用時）
fly.toml        - Fly.io設定
.gitignore      - Git除外設定
deploy-commands.js - コマンドデプロイスクリプト
cleanup-commands.js - コマンドクリーンアップスクリプト
```

### 6. 移行手順

1. **新しいDiscordサーバーを準備**
   - 必要なチャンネルを作成
   - 必要なカテゴリーを作成
   - Botを招待（必要な権限を付与）

2. **config.jsの更新**
   - 新サーバーのチャンネルID、カテゴリID、ロールIDに更新
   - 環境変数は`.env`ファイルで設定

3. **環境変数の設定**
   - 新しいサーバー用の環境変数を設定
   - Upstash Redisを新規作成
   - Notionデータベースを準備

4. **Botの再デプロイ**
   ```bash
   npm install
   node index.js  # 開発環境
   # または
   flyctl deploy  # Fly.io環境
   ```

5. **コマンドの登録確認**
   - Botが起動したら、コマンドが自動登録されます
   - `/help`コマンドで動作確認

### 7. 注意事項

- **データの永続化**: Redisのデータは移行されません（再生成されます）
- **カテゴリー順序**: 部活のランキングは新サーバーで再計算されます
- **Webhook URL**: 匿名チャンネルにはWebhookが設定されている必要があります
- **環境変数**: 本番環境では環境変数で管理し、config.jsには直接書き込まないこと

### 8. Botが必要な権限

Botは以下を管理するため、適切な権限が必要です：
- チャンネルの作成・削除（部活チャンネル）
- ロールの管理（部活ロール）
- メッセージの送信・削除
- ファイルのアップロード
- カテゴリー内でのチャンネルソート

### 9. トラブルシューティング

- **コマンドが表示されない**: Botがサーバーに正しく招待され、権限が付与されているか確認
- **チャンネルが作成されない**: Botにチャンネル作成権限があるか確認
- **Redis接続エラー**: Upstash RedisのURLとトークンが正しいか確認
- **Notion接続エラー**: Notion APIキーとデータベースIDが正しいか確認

