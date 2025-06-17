const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ChannelType } = require('discord.js');
const { calculateTextLevel, calculateVoiceLevel } = require('../utils/utility.js');
const { getNotionRelationTitles } = require('../utils/notionHelpers.js');
const config = require('../config.js');

const createLeaderboardEmbed = async (users, page, totalPages, title, type) => {
    const start = page * 10;
    const end = start + 10;
    const currentUsers = users.slice(start, end);

    const descriptionPromises = currentUsers.map(async (u, i) => {
        if (type === 'club') {
            return `**${start + i + 1}位:** <#${u.id}> - ${u.count.toLocaleString()} メッセージ`;
        }
        const level = type === 'text' ? calculateTextLevel(u.xp) : calculateVoiceLevel(u.xp);
        return `**${start + i + 1}位:** <@${u.userId}> - Lv.${level} (${u.xp.toLocaleString()} XP)`;
    });

    const description = (await Promise.all(descriptionPromises)).join('\n');

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || 'データがありません。')
        .setColor(0xFFA500)
        .setFooter({ text: `ページ ${page + 1} / ${totalPages}` })
        .setTimestamp();
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('ランキングを表示します')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('ランキングの種類')
                .setRequired(true)
                .addChoices(
                    { name: 'テキスト', value: 'text' },
                    { name: 'ボイス', value: 'voice' },
                    { name: '部活', value: 'club' }
                ))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('期間')
                .setRequired(false)
                .addChoices(
                    { name: '今日', value: 'day' },
                    { name: '今週', value: 'week' },
                    { name: '今月', value: 'month' }
                )),

    async execute(interaction, redis, notion) {
        await interaction.deferReply();
        const type = interaction.options.getString('type');
        const duration = interaction.options.getString('duration') || 'all';

        try {
            if (type === 'club') {
                // 部活ランキングの処理
                const response = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    filter: {
                        property: '種類',
                        select: {
                            equals: '部活'
                        }
                    }
                });

                const clubChannels = response.results.map(page => {
                    const channelId = page.properties['チャンネルID']?.rich_text?.[0]?.plain_text;
                    const memberCount = page.properties['部員数']?.number || 0;
                    return { channelId, memberCount };
                }).filter(club => club.channelId);

                const messageCounts = await Promise.all(
                    clubChannels.map(async ({ channelId }) => {
                        const key = `message_count:${channelId}:${duration}`;
                        const count = await redis.get(key) || 0;
                        return { channelId, count: parseInt(count) };
                    })
                );

                const sortedClubs = messageCounts
                    .map(({ channelId, count }) => {
                        const club = clubChannels.find(c => c.channelId === channelId);
                        return {
                            channelId,
                            count,
                            memberCount: club?.memberCount || 0
                        };
                    })
                    .sort((a, b) => b.count - a.count);

                const itemsPerPage = 10;
                const totalPages = Math.ceil(sortedClubs.length / itemsPerPage);
                let currentPage = 0;

                const createClubEmbed = (page) => {
                    const start = page * itemsPerPage;
                    const end = start + itemsPerPage;
                    const pageClubs = sortedClubs.slice(start, end);

                    const embed = new EmbedBuilder()
                        .setTitle('部活ランキング')
                        .setColor('#0099ff')
                        .setDescription(`期間: ${getDurationText(duration)}`)
                        .setFooter({ text: `ページ ${page + 1}/${totalPages}` });

                    pageClubs.forEach((club, index) => {
                        const channel = interaction.guild.channels.cache.get(club.channelId);
                        if (channel) {
                            embed.addFields({
                                name: `${start + index + 1}位: ${channel.name}`,
                                value: `メッセージ数: ${club.count}\n部員数: ${club.memberCount}人`
                            });
                        }
                    });

                    return embed;
                };

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev')
                            .setLabel('前へ')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('次へ')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === totalPages - 1)
                    );

                const message = await interaction.editReply({
                    embeds: [createClubEmbed(currentPage)],
                    components: [row]
                });

                const collector = message.createMessageComponentCollector({
                    time: 300000
                });

                collector.on('collect', async (i) => {
                    if (i.user.id !== interaction.user.id) {
                        await i.reply({ content: 'このボタンは使用できません。', ephemeral: true });
                        return;
                    }

                    if (i.customId === 'prev') {
                        currentPage--;
                    } else if (i.customId === 'next') {
                        currentPage++;
                    }

                    const newRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('prev')
                                .setLabel('前へ')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === 0),
                            new ButtonBuilder()
                                .setCustomId('next')
                                .setLabel('次へ')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === totalPages - 1)
                        );

                    await i.update({
                        embeds: [createClubEmbed(currentPage)],
                        components: [newRow]
                    });
                });

                collector.on('end', () => {
                    interaction.editReply({
                        components: []
                    }).catch(console.error);
                });

            } else {
                // テキスト/ボイスランキングの処理
                const users = new Map();
                const channels = interaction.guild.channels.cache.filter(channel => {
                    if (type === 'text') {
                        return channel.type === ChannelType.GuildText;
                    } else if (type === 'voice') {
                        return channel.type === ChannelType.GuildVoice;
                    }
                    return false;
                });

                for (const channel of channels.values()) {
                    const key = type === 'text' 
                        ? `message_count:${channel.id}:${duration}`
                        : `voice_time:${channel.id}:${duration}`;
                    const count = await redis.get(key) || 0;
                    
                    if (type === 'text') {
                        // テキストメッセージの場合は、ユーザーごとのメッセージ数を集計
                        const messageKey = `user_messages:${channel.id}:${duration}`;
                        const userMessages = await redis.hgetall(messageKey);
                        
                        for (const [userId, messageCount] of Object.entries(userMessages)) {
                            const currentCount = users.get(userId) || 0;
                            users.set(userId, currentCount + parseInt(messageCount));
                        }
                    } else {
                        // ボイスの場合は、ユーザーごとの通話時間を集計
                        const voiceKey = `user_voice:${channel.id}:${duration}`;
                        const userVoice = await redis.hgetall(voiceKey);
                        
                        for (const [userId, voiceTime] of Object.entries(userVoice)) {
                            const currentTime = users.get(userId) || 0;
                            users.set(userId, currentTime + parseInt(voiceTime));
                        }
                    }
                }

                const sortedUsers = Array.from(users.entries())
                    .map(([userId, count]) => ({
                        userId,
                        count,
                        xp: type === 'text' ? count : count * 60 // ボイスの場合は時間を秒に変換
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10);

                const embed = new EmbedBuilder()
                    .setTitle(`${type === 'text' ? 'テキスト' : 'ボイス'}ランキング`)
                    .setColor('#0099ff')
                    .setDescription(`期間: ${getDurationText(duration)}`);

                sortedUsers.forEach((user, index) => {
                    const level = type === 'text' ? calculateTextLevel(user.xp) : calculateVoiceLevel(user.xp);
                    const value = type === 'text'
                        ? `Lv.${level} (${user.count.toLocaleString()} メッセージ)`
                        : `Lv.${level} (${formatDuration(user.count)} 通話)`;
                    
                    embed.addFields({
                        name: `${index + 1}位: <@${user.userId}>`,
                        value: value
                    });
                });

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error in /top command:', error);
            await interaction.editReply('ランキングの取得中にエラーが発生しました。');
        }
    },
};

function getDurationText(duration) {
    switch (duration) {
        case 'day': return '今日';
        case 'week': return '今週';
        case 'month': return '今月';
        default: return '全期間';
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}時間${minutes}分`;
}
