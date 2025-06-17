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
                .setRequired(false)
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
            if (!type) {
                // テキストとボイスの両方のランキングを表示
                const textUsers = new Map();
                const voiceUsers = new Map();

                // テキストチャンネルの処理
                const textChannels = interaction.guild.channels.cache.filter(channel => 
                    channel.type === ChannelType.GuildText
                );

                for (const channel of textChannels.values()) {
                    const messageKey = `user_messages:${channel.id}:${duration}`;
                    const userMessages = await redis.hgetall(messageKey);
                    
                    for (const [userId, messageCount] of Object.entries(userMessages)) {
                        const currentCount = textUsers.get(userId) || 0;
                        textUsers.set(userId, currentCount + parseInt(messageCount));
                    }
                }

                // ボイスチャンネルの処理
                const voiceChannels = interaction.guild.channels.cache.filter(channel => 
                    channel.type === ChannelType.GuildVoice
                );

                for (const channel of voiceChannels.values()) {
                    const voiceKey = `user_voice:${channel.id}:${duration}`;
                    const userVoice = await redis.hgetall(voiceKey);
                    
                    for (const [userId, voiceTime] of Object.entries(userVoice)) {
                        const currentTime = voiceUsers.get(userId) || 0;
                        voiceUsers.set(userId, currentTime + parseInt(voiceTime));
                    }
                }

                // テキストランキングの作成
                const sortedTextUsers = Array.from(textUsers.entries())
                    .map(([userId, count]) => ({
                        userId,
                        count,
                        xp: count
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10);

                // ボイスランキングの作成
                const sortedVoiceUsers = Array.from(voiceUsers.entries())
                    .map(([userId, count]) => ({
                        userId,
                        count,
                        xp: count * 60
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10);

                const embed = new EmbedBuilder()
                    .setTitle('ランキング')
                    .setColor('#0099ff')
                    .setDescription(`期間: ${getDurationText(duration)}`);

                // テキストランキングの追加
                if (sortedTextUsers.length > 0) {
                    embed.addFields({ name: 'テキストランキング', value: '\u200B' });
                    sortedTextUsers.forEach((user, index) => {
                        const level = calculateTextLevel(user.xp);
                        embed.addFields({
                            name: `${index + 1}位: <@${user.userId}>`,
                            value: `Lv.${level} (${user.count.toLocaleString()} メッセージ)`
                        });
                    });
                }

                // ボイスランキングの追加
                if (sortedVoiceUsers.length > 0) {
                    embed.addFields({ name: 'ボイスランキング', value: '\u200B' });
                    sortedVoiceUsers.forEach((user, index) => {
                        const level = calculateVoiceLevel(user.xp);
                        embed.addFields({
                            name: `${index + 1}位: <@${user.userId}>`,
                            value: `Lv.${level} (${formatDuration(user.count)} 通話)`
                        });
                    });
                }

                await interaction.editReply({ embeds: [embed] });
            } else {
                // 特定のタイプのランキングのみ表示
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
                    if (type === 'text') {
                        const messageKey = `user_messages:${channel.id}:${duration}`;
                        const userMessages = await redis.hgetall(messageKey);
                        
                        for (const [userId, messageCount] of Object.entries(userMessages)) {
                            const currentCount = users.get(userId) || 0;
                            users.set(userId, currentCount + parseInt(messageCount));
                        }
                    } else {
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
                        xp: type === 'text' ? count : count * 60
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
