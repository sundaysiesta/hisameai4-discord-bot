const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { updatePermanentRankings } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updaterankings')
        .setDescription('常駐ランキングを手動で更新します。(管理者限定)'),
    async execute(interaction, redis, notion) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await updatePermanentRankings(interaction.guild, redis, notion);
            await interaction.editReply('常駐ランキングを更新しました。');
        } catch (error) {
            console.error('ランキング更新エラー:', error);
            await interaction.editReply('ランキングの更新中にエラーが発生しました。');
        }
    },
}; 