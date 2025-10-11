const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { calculateWeeklyActivity } = require('../utils/utility.js');
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
        // 人気部活カテゴリも部活扱いにする
        const isClubChannel = (
            channel.parent && (
                config.CLUB_CATEGORIES.includes(channel.parent.id) ||
                channel.parent.id === config.POPULAR_CLUB_CATEGORY_ID
            )
        );
        if (!isClubChannel) {
            return interaction.editReply({ content: "指定されたチャンネルは部活チャンネルではありません。" });
        }

        try {
            // 部長情報の取得（新方式: 個人ID）
            let leaderMention = '未設定';
            const leaderUserId = await redis.get(`leader_user:${channel.id}`);
            if (leaderUserId) {
                const member = await interaction.guild.members.fetch(leaderUserId).catch(()=>null);
                leaderMention = member ? member.toString() : '不在';
            }

            // 部活説明の取得
            const description = channel.topic || '説明はありません。';

            // 部活順位の計算（アクティブ度で計算）
            const category = channel.parent;
            const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
            let ranking = [];
            for (const ch of clubChannels.values()) {
                // 共通の週間アクティブ度計算関数を使用
                const activity = await calculateWeeklyActivity(ch, redis);
                
                ranking.push({ 
                    id: ch.id, 
                    count: activity.activityScore, // アクティブ度を使用
                    position: ch.position 
                });
            }
            ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
            const rank = ranking.findIndex(r => r.id === channel.id) + 1;

            // 共通の週間アクティブ度計算関数を使用
            const activity = await calculateWeeklyActivity(channel, redis);

            const embed = new EmbedBuilder()
                .setTitle(`${channel.name} の情報`)
                .setColor(0x5865F2)
                .addFields(
                    { name: '👑 部長', value: leaderMention, inline: true },
                    { name: '📊 週間順位', value: `${rank}位`, inline: true },
                    { name: '👥 アクティブ部員数', value: `${activity.activeMemberCount}人`, inline: true },
                    { name: '📝 週間メッセージ数', value: `${activity.weeklyMessageCount}件`, inline: true },
                    { name: '🔥 アクティブ度', value: `${activity.activityScore}pt`, inline: true },
                    { name: '📝 部活説明', value: description }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Club info error:', error);
            await interaction.editReply('部活情報の取得中にエラーが発生しました。');
        }
    },
};
