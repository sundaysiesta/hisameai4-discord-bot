const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clubban')
        .setDescription('部活からユーザーの閲覧権限を削除/復活します。(部長のみ)')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('BAN/解除するユーザー')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('実行するアクション')
                .setRequired(true)
                .addChoices(
                    { name: 'BAN (閲覧権限を削除)', value: 'ban' },
                    { name: '解除 (閲覧権限を復活)', value: 'unban' }
                )),
    async execute(interaction, redis) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const targetUser = interaction.options.getUser('user');
        const action = interaction.options.getString('action');
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
        
        // 自分自身をBANしようとしている場合
        if (targetUser.id === interaction.user.id) {
            return interaction.editReply({ content: "自分自身をBANすることはできません。" });
        }
        
        try {
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            if (action === 'ban') {
                // BAN処理
                await channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: false
                });
                
                // BAN情報をRedisに保存
                await redis.set(`clubban:${channel.id}:${targetUser.id}`, 'true');
                
                const embed = new EmbedBuilder()
                    .setTitle('🚫 部活BAN実行')
                    .setDescription(`${targetUser.username} を ${channel.name} からBANしました。`)
                    .setColor(0xFF0000)
                    .addFields(
                        { name: '対象ユーザー', value: targetUser.toString(), inline: true },
                        { name: '部活', value: channel.name, inline: true },
                        { name: '実行者', value: interaction.user.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                
            } else if (action === 'unban') {
                // 解除処理
                await channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: true
                });
                
                // BAN情報をRedisから削除
                await redis.del(`clubban:${channel.id}:${targetUser.id}`);
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ 部活BAN解除')
                    .setDescription(`${targetUser.username} の ${channel.name} でのBANを解除しました。`)
                    .setColor(0x00FF00)
                    .addFields(
                        { name: '対象ユーザー', value: targetUser.toString(), inline: true },
                        { name: '部活', value: channel.name, inline: true },
                        { name: '実行者', value: interaction.user.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            }
            
        } catch (error) {
            console.error('Clubban command error:', error);
            await interaction.editReply({ content: 'BAN/解除処理中にエラーが発生しました。' });
        }
    },
};
