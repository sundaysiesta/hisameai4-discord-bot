// ================================================================
// ファイルパス: deploy-commands.js (変更なし)
// ================================================================
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
    { name: 'status', description: 'Botのステータスメッセージを変更します。(管理者限定)', options: [{ name: '内容', type: 3, description: '表示するステータスの内容', required: true }] },
    { name: 'leader', description: '部活チャンネルに部長ロールを手動で設定します。(管理者限定)', options: [{ name: '部活', type: 7, description: '対象の部活チャンネル', required: true }, { name: '部長', type: 8, description: '設定する部長ロール', required: true }] },
    { name: 'club', description: '部活アクティブランキングを表示します。' },
    { name: 'sort', description: '部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)' },
    { name: 'profile', description: 'プロフィールを表示します。ユーザー指定か名前検索、または自身のプロフを表示します。', options: [{ name: 'user', type: 6, description: 'プロフィールを表示したいユーザー', required: false }, { name: 'name', type: 3, description: 'Notionデータベースの名前で検索', required: false }] },
    { name: 'link', description: 'DiscordアカウントとNotionの名前を紐付けます。(管理者限定)', options: [{ name: 'user', type: 6, description: '紐付けたいDiscordユーザー', required: true }, { name: 'name', type: 3, description: 'Notionデータベース上の正確な名前（タイトル）', required: true }] },
    { name: 'wordcloud', description: 'このチャンネルの最近のメッセージからワードクラウド画像を生成します。' },
    { name: 'rank', description: '現在のレベルと経験値を表示します。', options: [{ name: 'user', type: 6, description: '確認したいユーザー（指定しない場合は自分）', required: false }] },
    { name: 'top', description: 'レベルランキングを表示します。', options: [{ name: 'type', type: 3, description: 'ランキングの種類（未指定で両方表示）', required: false, choices: [{ name: 'テキスト', value: 'text' }, { name: 'ボイス', value: 'voice' }] }, { name: 'duration', type: 3, description: '期間（指定しない場合は全期間）', required: false, choices: [{ name: '日間', value: 'daily' }, { name: '月間', value: 'monthly' }] }, { name: 'date', type: 3, description: '日付 (YYYY-MM-DD形式)', required: false }, { name: 'month', type: 3, description: '月 (YYYY-MM形式)', required: false }] },
    { name: 'xp', description: 'ユーザーのXPを操作します。(管理者限定)', options: [{ name: 'user', type: 6, description: '対象のユーザー', required: true }, { name: 'type', type: 3, description: '操作するXPの種類', required: true, choices: [{ name: 'テキスト', value: 'text' }, { name: 'ボイス', value: 'voice' }] }, { name: 'action', type: 3, description: '操作の種類', required: true, choices: [{ name: '追加', value: 'add' }, { name: '削除', value: 'remove' }, { name: '設定', value: 'set' }] }, { name: 'amount', type: 4, description: 'XPの量', required: true }] },
    { name: 'transferxp', description: 'BANされたアカウントのXPを新しいアカウントに引き継ぎます。(管理者限定)', options: [{ name: 'old_user_id', type: 3, description: '元のアカウントのユーザーID', required: true }, { name: 'new_user', type: 6, description: '引き継ぎ先の新しいアカウント', required: true }] },
    { name: 'linkmain', description: 'このアカウントをメインアカウントに指定し、XPを合算します。', options: [{ name: 'sub_account', type: 6, description: 'サブアカウントとして指定するユーザー', required: true }] },
    { name: 'resettrend', description: 'トレンドランキングのデータをリセットします。(管理者限定)' },
    { name: 'clearxpdata', description: '破損した可能性のある月間・日間のXPデータをクリアします。(管理者限定・一度だけ使用)' },
    {
        name: 'migrateprobot',
        description: 'ProBotのランキングメッセージからXPを一括で引き継ぎます。(管理者限定)',
        options: [
            {
                name: 'message_id',
                type: 3, // STRING
                description: 'ProBotのランキングが表示されているメッセージのID',
                required: true,
            },
        ],
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

// ================================================================
// ファイルパス: commands/migrateprobot.js (このファイルの内容を置き換えてください)
// ================================================================
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('migrateprobot')
        .setDescription('ProBotのランキングメッセージからXPを一括で引き継ぎます。(管理者限定)')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('ProBotのランキングが表示されているメッセージのID')
                .setRequired(true)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        const messageId = interaction.options.getString('message_id');

        try {
            const targetMessage = await interaction.channel.messages.fetch(messageId);
            
            if (!targetMessage || !targetMessage.embeds || targetMessage.embeds.length === 0) {
                return interaction.editReply('指定されたIDのメッセージが見つからないか、Embedが含まれていません。');
            }

            const embed = targetMessage.embeds[0];
            const description = embed.description;

            // 【最重要修正】バッククォート(`)に対応した正規表現
            const regex = /#\d+\s*.*?<@!?(\d+)> XP: `(\d+)`/g;
            let match;
            const usersToUpdate = [];

            while ((match = regex.exec(description)) !== null) {
                const userId = match[1];
                const xp = parseInt(match[2], 10);
                if (userId && !isNaN(xp)) {
                    usersToUpdate.push({ userId, xp });
                }
            }
            
            if (usersToUpdate.length === 0) {
                return interaction.editReply('メッセージから有効なユーザーデータが見つかりませんでした。テキスト形式が想定と異なる可能性があります。');
            }
            
            const redisPipeline = redis.pipeline();
            for (const user of usersToUpdate) {
                redisPipeline.hset(`user:${user.userId}`, { textXp: user.xp });
            }
            await redisPipeline.exec();
            
            await interaction.editReply(
                `成功！ ${usersToUpdate.length} 人のユーザーのテキストXPをProBotの値に設定しました。\n` +
                `（反映には時間がかかる場合があります）`
            );

        } catch (error) {
            console.error('ProBot XP migration error:', error);
            await interaction.editReply('XPの引き継ぎ中にエラーが発生しました。メッセージIDが正しいか、Botがこのチャンネルを閲覧できるか確認してください。');
        }
    },
};
