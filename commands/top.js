const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { calculateTextLevel, calculateVoiceLevel } = require('../utils/utility.js');
const config = require('../config.js');

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
                    { name: 'ボイス', value: 'voice' }
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
