const { SlashCommandBuilder, PermissionsBitField, ActivityType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Botのステータスメッセージを変更します。(管理者限定)')
        .addStringOption(option => 
            option.setName('内容')
                .setDescription('表示するステータスの内容')
                .setRequired(true)),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ephemeral: true});
        const statusText = interaction.options.getString('内容');
        interaction.client.user.setActivity(statusText, { type: ActivityType.Playing });
        await interaction.editReply({ content: `Botのステータスを「${statusText}」に変更しました。` });
    },
};
