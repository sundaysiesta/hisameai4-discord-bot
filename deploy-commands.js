const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
    { name: 'help', description: '利用可能なコマンドの一覧を表示します。' },
    { name: 'status', description: 'Botのステータスメッセージを変更します。(管理者限定)', options: [{ name: '内容', type: 3, description: '表示するステータスの内容', required: true }] },
    { name: 'leader', description: '部活チャンネルに部長ロールを手動で設定します。(管理者限定)', options: [{ name: '部活', type: 7, description: '対象の部活チャンネル', required: true }, { name: '部長', type: 8, description: '設定する部長ロール', required: true }] },
    { name: 'club', description: '部活アクティブランキングを表示します。' },
    { name: 'sort', description: '部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)' },
    { name: 'profile', description: 'プロフィールを画像で表示します。ユーザー指定か名前検索、または自身のプロフを表示します。', options: [{ name: 'user', type: 6, description: 'プロフィールを表示したいユーザー', required: false }, { name: 'name', type: 3, description: 'Notionデータベースの名前で検索', required: false }] },
    { name: 'link', description: 'DiscordアカウントとNotionの名前を紐付けます。(管理者限定)', options: [{ name: 'user', type: 6, description: '紐付けたいDiscordユーザー', required: true }, { name: 'name', type: 3, description: 'Notionデータベース上の正確な名前（タイトル）', required: true }] },
    { name: 'wordcloud', description: 'このチャンネルの最近のメッセージからワードクラウド画像を生成します。' },
    { name: 'rank', description: '現在のレベルと経験値を表示します。', options: [{ name: 'user', type: 6, description: '確認したいユーザー（指定しない場合は自分）', required: false }] },
    { name: 'top', description: 'レベルランキングを表示します。', options: [
        { 
            name: 'type', 
            type: 3, 
            description: 'ランキングの種類（未指定で両方表示）', 
            required: false, 
            choices: [
                { name: 'テキスト', value: 'text' }, 
                { name: 'ボイス', value: 'voice' }
            ]
        }, 
        { 
            name: 'duration', 
            type: 3, 
            description: '期間（指定しない場合は全期間）', 
            required: false, 
            choices: [
                { name: '日間', value: 'daily' }, 
                { name: '月間', value: 'monthly' }
            ]
        }, 
        { 
            name: 'date', 
            type: 3, 
            description: '日付 (YYYY-MM-DD形式)', 
            required: false 
        }, 
        { 
            name: 'month', 
            type: 3, 
            description: '月 (YYYY-MM形式)', 
            required: false 
        }
    ] },
    { name: 'xp', description: 'ユーザーのXPを操作します。(管理者限定)', options: [{ name: 'user', type: 6, description: '対象のユーザー', required: true }, { name: 'type', type: 3, description: '操作するXPの種類', required: true, choices: [{ name: 'テキスト', value: 'text' }, { name: 'ボイス', value: 'voice' }] }, { name: 'action', type: 3, description: '操作の種類', required: true, choices: [{ name: '追加', value: 'add' }, { name: '削除', value: 'remove' }, { name: '設定', value: 'set' }] }, { name: 'amount', type: 4, description: 'XPの量', required: true }] },
    { name: 'transferxp', description: 'BANされたアカウントのXPを新しいアカウントに引き継ぎます。(管理者限定)', options: [{ name: 'old_user_id', type: 3, description: '元のアカウントのユーザーID', required: true }, { name: 'new_user', type: 6, description: '引き継ぎ先の新しいアカウント', required: true }] },
    { name: 'linkmain', description: 'サブアカウントのXPをメインアカウントに合算します。(管理者限定)', options: [{ name: 'main_account', type: 6, description: 'XPの合算先となるメインアカウント', required: true }, { name: 'sub_account', type: 6, description: 'XPを合算するサブアカウント', required: true }] },
    { name: 'resettrend', description: 'トレンドランキングのデータをリセットします。(管理者限定)' },
    { name: 'clearxpdata', description: '破損した可能性のある月間・日間のXPデータをクリアします。(管理者限定・一度だけ使用)' },
    { name: 'migrateprobot', description: 'ProBotのランキングメッセージからXPを一括で引き継ぎます。(管理者限定)', options: [ { name: 'message_id', type: 3, description: 'ProBotのランキングが表示されているメッセージのID', required: true } ] },
    { name: 'setprofilebg', description: 'あなたのプロフィールカードの背景画像を設定します。', options: [{ name: 'url', type: 3, description: '背景に設定したい画像のURL (リセットする場合は "none" と入力)', required: true }] },
    { name: 'setrankbg', description: 'あなたのランクカードの背景画像を設定します。', options: [{ name: 'url', type: 3, description: '背景に設定したい画像のURL (リセットする場合は "reset" と入力)', required: true }] },
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
    {
        name: 'monthlyresult',
        description: '月間レベルランキングのリザルト画像を生成します。',
        options: [{
            name: 'month',
            type: 3, // STRING
            description: '対象の月をYYYY-MM形式で指定 (例: 2025-05)。未指定の場合は先月になります。',
            required: false,
        }],
    },
].map(command => command);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        await rest.put(Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) { console.error(error); }
})();