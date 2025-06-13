const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('部活アクティブランキングを表示します。'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        await interaction.guild.members.fetch();
        
        const guild = interaction.guild;
        const category = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
        if (!category) return interaction.editReply({ content: "部活カテゴリが見つかりません。" });

        const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
        let ranking = [];
        for (const channel of clubChannels.values()) {
            const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
            ranking.push({ id: channel.id, name: channel.name, count: Number(count), position: channel.position });
        }
        ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);

        const itemsPerPage = 10;
        const totalPages = Math.ceil(ranking.length / itemsPerPage) || 1;

        const generateEmbed = async (page) => {
            const start = (page - 1) * itemsPerPage;
            const pagedItems = ranking.slice(start, start + itemsPerPage);
            let description = '現在、活動中の部活はありません。';
            if (pagedItems.length > 0) {
                const descriptionPromises = pagedItems.map(async (club, i) => {
                    const rank = start + i + 1;
                    const leaderRoleId = await redis.get(`leader_roles:${club.id}`);
                    let leaderMention = '未設定';
                    if (leaderRoleId) {
                        const role = await guild.roles.fetch(leaderRoleId, { force: true }).catch(() => null);
                        if (role) {
                            if (role.members.size > 0) {
                                leaderMention = role.members.map(m => m.toString()).join(', ');
                            } else {
                                leaderMention = '不在';
                            }
                        }
                    }
                    return `**${rank}位:** <#${club.id}>  **部長:** ${leaderMention}`;
                });
                description = (await Promise.all(descriptionPromises)).join('\n');
            }
            return new EmbedBuilder().setTitle('部活アクティブランキング (週間)').setDescription(description).setColor(0x5865F2).setFooter({ text: `ページ ${page} / ${totalPages}` });
        };

        const embed = await generateEmbed(1);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('club_prev_page').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('club_next_page').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1)
        );
        
        const message = await interaction.editReply({ embeds: [embed], components: [row] });
        const collector = message.createMessageComponentCollector({ time: 120000 });
        let currentPage = 1;

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'コマンド実行者のみ操作できます。', ephemeral: true });
            await i.deferUpdate();
            if (i.customId === 'club_prev_page') currentPage--;
            if (i.customId === 'club_next_page') currentPage++;
            const newEmbed = await generateEmbed(currentPage);
            row.components[0].setDisabled(currentPage === 1);
            row.components[1].setDisabled(currentPage === totalPages);
            await i.editReply({ embeds: [newEmbed], components: [row] });
        });
        collector.on('end', () => message.edit({ components: [] }).catch(() => {}));
    },
};
