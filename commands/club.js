const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('指定した部活の情報を表示します。')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('情報を表示する部活チャンネル')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        await interaction.guild.members.fetch();
        
        const channel = interaction.options.getChannel('channel');
        if (!channel.parent || channel.parent.id !== config.CLUB_CATEGORY_ID) {
            return interaction.editReply({ content: "指定されたチャンネルは部活チャンネルではありません。" });
        }

        // 部長情報の取得
        const leaderRoleId = await redis.get(`leader_roles:${channel.id}`);
        let leaderMention = '未設定';
        if (leaderRoleId) {
            const role = await interaction.guild.roles.fetch(leaderRoleId, { force: true }).catch(() => null);
            if (role) {
                if (role.members.size > 0) {
                    leaderMention = role.members.map(m => m.toString()).join(', ');
                } else {
                    leaderMention = '不在';
                }
            }
        }

        // 部活説明の取得
        const description = channel.topic || '説明はありません。';

        // 部活順位の計算
        const category = channel.parent;
        const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
        let ranking = [];
        for (const ch of clubChannels.values()) {
            const count = await redis.get(`weekly_message_count:${ch.id}`) || 0;
            ranking.push({ id: ch.id, count: Number(count), position: ch.position });
        }
        ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
        const rank = ranking.findIndex(r => r.id === channel.id) + 1;

        // 部員数（アクティブユーザー数）の計算
        const activeUsers = new Set();
        const messageCounts = await redis.keys(`weekly_message_count:${channel.id}:*`);
        for (const key of messageCounts) {
            const count = await redis.get(key);
            if (count > 0) {
                const userId = key.split(':').pop();
                activeUsers.add(userId);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`${channel.name} の情報`)
            .setColor(0x5865F2)
            .addFields(
                { name: '👑 部長', value: leaderMention, inline: true },
                { name: '📊 週間順位', value: `${rank}位`, inline: true },
                { name: '👥 アクティブ部員数', value: `${activeUsers.size}人`, inline: true },
                { name: '📝 部活説明', value: description }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
