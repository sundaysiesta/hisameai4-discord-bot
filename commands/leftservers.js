const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaveserver')
        .setDescription('指定したIDのサーバーからBotを脱退させます。(Bot管理者限定)')
        .addStringOption(option =>
            option.setName('server_id')
                .setDescription('脱退させたいサーバーのID')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.client.application.fetch();
        if (interaction.user.id !== interaction.client.application.owner.id) {
            return interaction.reply({ content: 'このコマンドを実行できるのはBotの所有者のみです。', flags: [MessageFlags.Ephemeral] });
        }
        
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const serverId = interaction.options.getString('server_id');
        const guild = interaction.client.guilds.cache.get(serverId);

        if (!guild) {
            return interaction.editReply(`ID「${serverId}」を持つサーバーが見つかりませんでした。Botが参加していない可能性があります。`);
        }

        try {
            await guild.leave();
            await interaction.editReply(`サーバー「${guild.name}」から正常に脱退しました。`);
        } catch (error) {
            console.error('サーバーからの脱退に失敗しました:', error);
            await interaction.editReply('サーバーからの脱退中にエラーが発生しました。');
        }
    },
};
