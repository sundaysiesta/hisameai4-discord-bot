const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { getAllKeys } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearxpdata')
        .setDescription('破損した可能性のある月間・日間のXPデータをクリアします。(管理者限定・一度だけ使用)'),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        
        await interaction.deferReply({ ephemeral: true });

        try {
            const monthlyTextKeys = await getAllKeys(redis, 'monthly_xp:text:*');
            const dailyTextKeys = await getAllKeys(redis, 'daily_xp:text:*');
            const monthlyVoiceKeys = await getAllKeys(redis, 'monthly_xp:voice:*');
            const dailyVoiceKeys = await getAllKeys(redis, 'daily_xp:voice:*');

            const allKeys = [...monthlyTextKeys, ...dailyTextKeys, ...monthlyVoiceKeys, ...dailyVoiceKeys];

            if (allKeys.length > 0) {
                await redis.del(allKeys);
                await interaction.editReply(`破損した可能性のあるXPデータキーを ${allKeys.length} 件削除しました。これ以降、XPは正常に記録されます。`);
            } else {
                await interaction.editReply('削除対象のデータキーは見つかりませんでした。');
            }
        } catch (error) {
            console.error('XPデータのクリア中にエラー:', error);
            await interaction.editReply('XPデータのクリア中にエラーが発生しました。');
        }
    },
};