const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
    { name: 'help', description: '利用可能なコマンドの一覧を表示します。' },
    { name: 'status', description: 'Botのステータスメッセージを変更します。(管理者限定)', options: [{ name: '内容', type: 3, description: '表示するステータスの内容', required: true }] },
    { name: 'leader', description: '部活チャンネルに部長を手動で設定します。(管理者限定)', options: [{ name: '部活', type: 7, description: '対象の部活チャンネル', required: true }, { name: '部長', type: 3, description: 'Notionデータベース上の正確な名前（タイトル）', required: true }] },
    { name: 'club', description: '指定した部活の情報を表示します。', options: [{ name: 'channel', type: 7, description: '情報を表示する部活チャンネル', required: true }] },
    { name: 'sort', description: '部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)' },
    { name: 'profile', description: 'プロフィールを画像で表示します。ユーザー指定か名前検索、または自身のプロフを表示します。', options: [{ name: 'user', type: 6, description: 'プロフィールを表示したいユーザー', required: false }, { name: 'name', type: 3, description: 'Notionデータベースの名前で検索', required: false }] },
    { name: 'link', description: 'DiscordアカウントとNotionの名前を紐付けます。(管理者限定)', options: [{ name: 'user', type: 6, description: '紐付けたいDiscordユーザー', required: true }, { name: 'name', type: 3, description: 'Notionデータベース上の正確な名前（タイトル）', required: true }] },
        { name: 'wordcloud', description: 'このチャンネルの最近のメッセージからワードクラウド画像を生成します。' },
    { name: 'setprofilebg', description: 'あなたのプロフィールカードの背景画像を設定します。', options: [{ name: 'url', type: 3, description: '背景に設定したい画像のURL (リセットする場合は "none" と入力)', required: true }] },
    {
        name: 'settempdesc',
        description: 'あなたのプロフィールに表示する仮の説明文を設定します。',
        options: [{
            name: 'description',
            type: 3, // STRING
            description: '設定したい説明文 (リセットする場合は "none" と入力)',
            required: true,
        }],
    },

    { name: 'anonymous', description: '匿名でメッセージを投稿します。', options: [
        { name: '内容', type: 3, description: '投稿内容（改行禁止・144文字以内）', required: true },
        { name: '添付ファイル', type: 11, description: '画像や動画などの添付ファイル', required: false },
        { name: 'アイコン', type: 11, description: '表示用アイコン画像', required: false },
        { name: '名前', type: 3, description: '表示名（未入力の場合は「名無しのロメダ民」）', required: false }
    ] },
    { name: 'anonlookup', description: '匿名IDと日付から送信者を特定します。(管理者限定)', options: [
        { name: '匿名id', type: 3, description: '匿名ID（8文字）', required: true },
        { name: '日付', type: 3, description: '投稿日付（YYYY-MM-DD）', required: true }
    ] },
    { name: 'migrateleaders', description: '旧部長ロール方式から個別権限方式へ移行します。(管理者限定)' },
    { name: 'kotehan', description: '匿名投稿用のコテハン（固定ハンドルネーム）を設定します', options: [
        { name: 'action', type: 3, description: '実行する操作', required: true, choices: [
            { name: '設定', value: 'set' },
            { name: '確認', value: 'view' },
            { name: '削除', value: 'remove' }
        ]},
        { name: '名前', type: 3, description: '固定したいハンドルネーム（20文字以内）', required: false }
    ]},
    { name: 'koteicon', description: '匿名投稿用の固定アイコンを設定します', options: [
        { name: 'action', type: 3, description: '実行する操作', required: true, choices: [
            { name: '設定', value: 'set' },
            { name: '確認', value: 'view' },
            { name: '削除', value: 'remove' }
        ]},
        { name: 'アイコン', type: 11, description: '固定したいアイコン画像（最大10MB）', required: false }
    ]},
    { name: 'notionicon', description: 'DiscordアイコンをNotionに同期します（管理者限定）', options: [
        { name: 'action', type: 3, description: '実行する操作', required: true, choices: [
            { name: '一括同期', value: 'sync' },
            { name: '個別同期', value: 'syncuser' },
            { name: '状況確認', value: 'status' }
        ]},
        { name: 'ユーザー', type: 6, description: 'アイコンを同期したいユーザー（個別同期時のみ）', required: false }
    ]},
    { name: 'nameurl', description: '指定された名前リストからNotionデータベースのアイコンURLを取得してCSV形式で返します（管理者限定）', options: [
        { name: 'リスト', type: 3, description: '名前リスト（空白区切り）', required: true }
    ]},
].map(command => command);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        
        // アプリケーションIDの取得
        const applicationId = process.env.DISCORD_APPLICATION_ID;
        if (!applicationId) {
            throw new Error('DISCORD_APPLICATION_ID環境変数が設定されていません。');
        }
        
        await rest.put(Routes.applicationCommands(applicationId), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) { 
        console.error('スラッシュコマンドの登録に失敗しました:', error);
    }
})();