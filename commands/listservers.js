const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listservers')
        .setDescription('Botが参加しているサーバーの一覧を表示します。(Bot管理者限定)'),
    async execute(interaction) {
        // Botのアプリケーション情報を取得して、所有者IDを確認
        await interaction.client.application.fetch();
        if (interaction.user.id !== interaction.client.application.owner.id) {
            return interaction.reply({ content: 'このコマンドを実行できるのはBotの所有者のみです。', flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guilds = interaction.client.guilds.cache;
        const description = guilds.map(guild => `**${guild.name}**\nID: \`${guild.id}\``).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle(`参加中のサーバー一覧 (${guilds.size}件)`)
            .setDescription(description || '参加中のサーバーはありません。')
            .setColor(0x7289DA)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};

