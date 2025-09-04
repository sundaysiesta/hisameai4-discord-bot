const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
    { name: 'help', description: '利用可能なコマンドの一覧を表示します。' },
    { name: 'status', description: 'Botのステータスメッセージを変更します。(管理者限定)', options: [{ name: '内容', type: 3, description: '表示するステータスの内容', required: true }] },
    { name: 'leader', description: '部活チャンネルに部長ロールを手動で設定します。(管理者限定)', options: [{ name: '部活', type: 7, description: '対象の部活チャンネル', required: true }, { name: '部長', type: 8, description: '設定する部長ロール', required: true }] },
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
    { name: 'migrateleaders', description: '旧部長ロール方式から個別権限方式へ移行します。(管理者限定)' },
].map(command => command);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        await rest.put(Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) { console.error(error); }
})();