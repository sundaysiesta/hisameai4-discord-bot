const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clubname')
        .setDescription('部活の名前を変更します。(部長のみ)')
        .addStringOption(option => 
            option.setName('newname')
                .setDescription('新しい部活名（｜の後の部分のみ）')
                .setRequired(true)
                .setMaxLength(50)),
    async execute(interaction, redis) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const newName = interaction.options.getString('newname');
        const channel = interaction.channel;
        
        // 部活チャンネルかどうかチェック（人気部活カテゴリも含む）
        const isClubChannel = (
            channel.parent && (
                config.CLUB_CATEGORIES.includes(channel.parent.id) ||
                channel.parent.id === config.POPULAR_CLUB_CATEGORY_ID
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
            const currentName = channel.name;
            
            // 現在の名前を解析（絵文字｜名前・アクティブ数🔥⚡🌱・の形式）
            const nameMatch = currentName.match(/^(.+?)\|(.+?)([・🔥⚡🌱]\d+)?$/);
            if (!nameMatch) {
                return interaction.editReply({ content: "部活名の形式が正しくありません。絵文字｜名前の形式である必要があります。" });
            }
            
            const emoji = nameMatch[1]; // 絵文字部分
            const currentClubName = nameMatch[2]; // 現在の部活名
            const activityPart = nameMatch[3] || ''; // ・や🔥⚡🌱の部分
            
            // 新しい名前を構築
            const newChannelName = `${emoji}｜${newName}${activityPart}`;
            
            // チャンネル名を変更
            await channel.setName(newChannelName);
            
            const embed = new EmbedBuilder()
                .setTitle('📝 部活名変更')
                .setDescription(`部活名を変更しました。`)
                .setColor(0x5865F2)
                .addFields(
                    { name: '変更前', value: currentName, inline: true },
                    { name: '変更後', value: newChannelName, inline: true },
                    { name: '実行者', value: interaction.user.toString(), inline: true }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Clubname command error:', error);
            await interaction.editReply({ content: '部活名の変更中にエラーが発生しました。' });
        }
    },
};
