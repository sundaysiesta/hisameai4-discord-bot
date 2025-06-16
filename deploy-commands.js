const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
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
                { name: 'ボイス', value: 'voice' },
                { name: 'ロメコイン', value: 'coin' }
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
            type: 3,
            description: '設定したい説明文 (リセットする場合は "none" と入力)',
            required: true,
        }],
    },
    {
        name: 'monthlyresult',
        description: '月間レベルランキングのリザルト画像を生成します。',
        options: [{
            name: 'month',
            type: 3,
            description: '対象の月をYYYY-MM形式で指定 (例: 2025-05)。未指定の場合は先月になります。',
            required: false,
        }],
    },
    { name: 'balance', description: '所持金と銀行残高を表示します', options: [{ name: 'user', type: 6, description: '確認したいユーザー（指定しない場合は自分）', required: false }] },
    { name: 'daily', description: '日課報酬を受け取ります' },
    { name: 'crime', description: '犯罪を犯してコインを稼ぎます' },
    { name: 'give', description: '他のユーザーにコインを送金します', options: [{ name: 'user', type: 6, description: '送金先のユーザー', required: true }, { name: 'amount', type: 4, description: '送金額', required: true }] },
    { name: 'deposit', description: '銀行にコインを預け入れます', options: [{ name: 'amount', type: 4, description: '預け入れる金額', required: true }] },
    { name: 'withdraw', description: '銀行からコインを引き出します', options: [{ name: 'amount', type: 4, description: '引き出す金額', required: true }] },
    { name: 'rob', description: '財務部から強盗を試みます' },
    { name: 'shop', description: 'ショップの管理コマンド', options: [
        { name: 'list', type: 1, description: '現在の商品一覧を表示します' },
        { name: 'add', type: 1, description: '新しい商品を追加します', options: [
            { name: 'name', type: 3, description: '商品名', required: true },
            { name: 'price', type: 4, description: '価格', required: true },
            { name: 'description', type: 3, description: '商品の説明', required: true },
            { name: 'role_id', type: 3, description: '付与するロールID', required: true }
        ]},
        { name: 'remove', type: 1, description: '商品を削除します', options: [
            { name: 'name', type: 3, description: '削除する商品名', required: true }
        ]},
        { name: 'edit', type: 1, description: '商品の情報を編集します', options: [
            { name: 'name', type: 3, description: '編集する商品名', required: true },
            { name: 'field', type: 3, description: '編集する項目', required: true, choices: [
                { name: '商品名', value: 'name' },
                { name: '価格', value: 'price' },
                { name: '説明', value: 'description' },
                { name: 'ロールID', value: 'role_id' }
            ]},
            { name: 'value', type: 3, description: '新しい値', required: true }
        ]}
    ]},
    { name: 'buy', description: 'ショップから商品を購入します', options: [{ name: 'name', type: 3, description: '購入する商品名', required: true }] },
    { name: 'economy', description: '経済システムの管理コマンド', options: [
        { name: 'reset', type: 1, description: 'ユーザーの所持金と銀行残高をリセットします', options: [
            { name: 'user', type: 6, description: 'リセットするユーザー（指定しない場合は全ユーザー）', required: false }
        ]},
        { name: 'set', type: 1, description: 'ユーザーの所持金または銀行残高を設定します', options: [
            { name: 'user', type: 6, description: '設定するユーザー', required: true },
            { name: 'type', type: 3, description: '設定する種類', required: true, choices: [
                { name: '所持金', value: 'balance' },
                { name: '銀行残高', value: 'bank' }
            ]},
            { name: 'amount', type: 4, description: '設定する金額', required: true }
        ]}
    ]},
    { name: 'syncleader', description: '全ユーザーの部長ロールIDをNotion人物DBに同期します（管理者限定）' },
].map(command => command);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        await rest.put(Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) { console.error(error); }
})();