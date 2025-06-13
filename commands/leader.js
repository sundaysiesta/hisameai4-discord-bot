const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leader')
        .setDescription('部活チャンネルに部長ロールを手動で設定します。(管理者限定)')
        .addChannelOption(option =>
            option.setName('部活')
                .setDescription('対象の部活チャンネル')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('部長')
                .setDescription('設定する部長ロール')
                .setRequired(true)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ephemeral: true});
        const channel = interaction.options.getChannel('部活');
        const role = interaction.options.getRole('部長');
        try {
            await channel.permissionOverwrites.edit(role.id, { ManageChannels: true, ManageMessages: true });
            await redis.set(`leader_roles:${channel.id}`, role.id);
            await interaction.editReply({ content: `${channel.name} の部長を ${role.name} に設定し、権限を付与しました。` });
        } catch (error) {
            await interaction.editReply({ content: '権限の設定中にエラーが発生しました。' });
        }
    },
};
