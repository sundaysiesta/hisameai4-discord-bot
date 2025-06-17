const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('club')
        .setDescription('指定した部活の情報（部長、説明、順位、部員数）を表示します。')
        .addChannelOption(option => 
            option.setName('部活')
                .setDescription('情報を表示したい部活チャンネル')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),
    async execute(interaction, redis) {
        await interaction.deferReply();
        await interaction.guild.members.fetch();
        
        const targetChannel = interaction.options.getChannel('部活');
        const category = await interaction.guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
        if (!category) return interaction.editReply({ content: "部活カテゴリが見つかりません。" });
        if (!category.children.cache.has(targetChannel.id)) {
            return interaction.editReply({ content: "指定されたチャンネルは部活チャンネルではありません。" });
        }

        // 部長情報の取得
        const leaderRoleId = await redis.get(`leader_roles:${targetChannel.id}`);
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

        // 部活の説明を取得
        const description = targetChannel.topic || '説明なし';

        // 部活の順位を計算
        const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
        let ranking = [];
        for (const channel of clubChannels.values()) {
            const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
            ranking.push({ id: channel.id, count: Number(count), position: channel.position });
        }
        ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
        const rank = ranking.findIndex(r => r.id === targetChannel.id) + 1;

        // 部員数（アクティブユーザー数）を計算
        const activeUsers = new Set();
        const messages = await targetChannel.messages.fetch({ limit: 100 }).catch(() => null);
        if (messages) {
            messages.forEach(msg => {
                if (msg.author && !msg.author.bot) {
                    activeUsers.add(msg.author.id);
                }
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`${targetChannel.name} の情報`)
            .setColor(0x5865F2)
            .addFields(
                { name: '👑 部長', value: leaderMention, inline: true },
                { name: '📊 順位', value: `${rank}位`, inline: true },
                { name: '👥 部員数', value: `${activeUsers.size}人`, inline: true },
                { name: '📝 説明', value: description }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
