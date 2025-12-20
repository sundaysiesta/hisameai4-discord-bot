const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const config = require('../config.js');
const { notion } = require('../utils/notionHelpers.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leader')
        .setDescription('部活チャンネルに部長を手動で設定します。(管理者限定)')
        .addChannelOption(option =>
            option.setName('部活')
                .setDescription('対象の部活チャンネル')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('部長')
                .setDescription('Notionデータベース上の正確な名前（タイトル）')
                .setRequired(true)),
    async execute(interaction, redis) {
        const ALLOWED_ROLE_ID = '1449784235102703667';
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasAllowedRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);
        
        if (!isAdmin && !hasAllowedRole) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply({flags: [MessageFlags.Ephemeral]});
        const channel = interaction.options.getChannel('部活');
        const characterName = interaction.options.getString('部長');
        
        try {
            // Notionデータベースからユーザーを検索
            const response = await notion.databases.query({
                database_id: config.NOTION_DATABASE_ID,
                filter: { property: '名前', title: { equals: characterName } },
            });
            
            if (response.results.length === 0) {
                return interaction.editReply(`名前「${characterName}」が見つかりませんでした。`);
            }
            
            const page = response.results[0];
            const props = page.properties;
            
            // DiscordユーザーIDを取得
            const discordUserId = props['DiscordユーザーID']?.rich_text?.[0]?.plain_text;
            if (!discordUserId) {
                return interaction.editReply(`「${characterName}」はDiscordアカウントと紐付けられていません。先に/linkコマンドで紐付けてください。`);
            }
            
            // Discordユーザーを取得
            const targetUser = await interaction.guild.members.fetch(discordUserId).catch(() => null);
            if (!targetUser) {
                return interaction.editReply(`Discordユーザー（ID: ${discordUserId}）が見つかりませんでした。`);
            }
            
            // チャンネル権限を設定
            await channel.permissionOverwrites.edit(targetUser.id, { 
                ViewChannel: true,
                ManageChannels: true, 
                ManageMessages: true,
                ManageRoles: true
            });
            
            // Redisに部長情報を保存（新方式: 個人ID）
            await redis.set(`leader_user:${channel.id}`, targetUser.id);
            
            // Notionの『部長』プロパティにチャンネルIDを追加
            const currentChannels = props['部長']?.rich_text?.[0]?.plain_text || '';
            const channelIds = currentChannels.split(',').map(s => s.trim()).filter(Boolean);
            
            if (!channelIds.includes(channel.id)) {
                channelIds.push(channel.id);
                await notion.pages.update({
                    page_id: page.id,
                    properties: {
                        '部長': { rich_text: [{ text: { content: channelIds.join(', ') } }] },
                    },
                });
            }
            
            await interaction.editReply({ 
                content: `${channel.name} の部長を ${targetUser.user.username}（${characterName}）に設定し、権限を付与しました。` 
            });
        } catch (error) {
            console.error('Leader command error:', error);
            await interaction.editReply({ content: '部長の設定中にエラーが発生しました。' });
        }
    },
};
