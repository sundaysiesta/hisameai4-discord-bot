const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
module.exports = {
    data: new SlashCommandBuilder().setName('resettrend').setDescription('トレンドランキングのデータをリセットします。(管理者限定)'),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '権限がありません。', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        await redis.del('trend_words');
        await interaction.editReply('トレンドデータをリセットしました。');
    },
};
