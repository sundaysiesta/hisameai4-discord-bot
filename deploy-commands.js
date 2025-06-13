const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
    {
        name: 'status',
        description: 'Botのステータスメッセージを変更します。(管理者限定)',
        options: [{ name: '内容', type: 3, description: '表示するステータスの内容', required: true }],
    },
    {
        name: 'leader',
        description: '部活チャンネルに部長ロールを手動で設定します。(管理者限定)',
        options: [
            { name: '部活', type: 7, description: '対象の部活チャンネル', required: true },
            { name: '部長', type: 8, description: '設定する部長ロール', required: true },
        ],
    },
    {
        name: 'club',
        description: '部活アクティブランキングを表示します。',
    },
    {
        name: 'sort',
        description: '部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)',
    },
    {
        name: 'profile',
        description: 'プロフィールを表示します。ユーザー指定か名前検索、または自身のプロフを表示します。',
        options: [
            { name: 'user', type: 6, description: 'プロフィールを表示したいユーザー', required: false },
            { name: 'name', type: 3, description: 'Notionデータベースの名前で検索', required: false },
        ],
    },
    {
        name: 'link',
        description: 'DiscordアカウントとNotionの名前を紐付けます。(管理者限定)',
        options: [
            { name: 'user', type: 6, description: '紐付けたいDiscordユーザー', required: true },
            { name: 'name', type: 3, description: 'Notionデータベース上の正確な名前（タイトル）', required: true },
        ],
    },
    // 【追加】
    {
        name: 'wordcloud',
        description: 'サーバーの最近のメッセージからワードクラウド画像を生成します。',
    }
].map(command => command);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        await rest.put(Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) { console.error(error); }
})();
