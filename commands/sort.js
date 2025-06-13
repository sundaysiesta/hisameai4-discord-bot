const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { sortClubChannels } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sort')
        .setDescription('部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)'),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await sortClubChannels(redis, interaction.guild);
        await interaction.editReply('部活チャンネルを現在のアクティブ順に並び替えました。');
    },
};
