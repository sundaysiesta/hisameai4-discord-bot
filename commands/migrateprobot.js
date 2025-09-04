// ================================================================
// commands/migrateprobot.js
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
