const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clubtopic')
        .setDescription('部活チャンネルのトピックを変更します。(部長のみ)')
        .addStringOption(option => 
            option.setName('topic')
                .setDescription('新しいトピック')
                .setRequired(true)
                .setMaxLength(1024)),
    async execute(interaction, redis) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const newTopic = interaction.options.getString('topic');
        const channel = interaction.channel;
        
        // 部活チャンネルかどうかチェック（人気部活カテゴリも含む）
        const isClubChannel = (
            channel.parent && (
                config.CLUB_CATEGORIES.includes(channel.parent.id) ||
                channel.parent.id === config.POPULAR_CLUB_CATEGORY_ID ||
                channel.parent.id === config.INACTIVE_CLUB_CATEGORY_ID
            )
        );
        if (!isClubChannel) {
            return interaction.editReply({ content: "このコマンドは部活チャンネルでのみ使用できます。" });
        }
        
        // 部長かどうかチェック
        const leaderUserId = await redis.get(`leader_user:${channel.id}`);
        if (!leaderUserId || leaderUserId !== interaction.user.id) {
            return interaction.editReply({ content: "このコマンドは部長のみが使用できます。" });
        }
        
        try {
            const oldTopic = channel.topic || '（トピックなし）';
            
            // トピックを変更
            await channel.setTopic(newTopic);
            
            const embed = new EmbedBuilder()
                .setTitle('📝 部活トピック変更')
                .setDescription(`部活チャンネルのトピックを変更しました。`)
                .setColor(0x5865F2)
                .addFields(
                    { name: '変更前', value: oldTopic.length > 1024 ? oldTopic.substring(0, 1021) + '...' : oldTopic, inline: false },
                    { name: '変更後', value: newTopic.length > 1024 ? newTopic.substring(0, 1021) + '...' : newTopic, inline: false },
                    { name: '実行者', value: interaction.user.toString(), inline: true }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Clubtopic command error:', error);
            await interaction.editReply({ content: 'トピックの変更中にエラーが発生しました。' });
        }
    },
};

