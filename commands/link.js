const { SlashCommandBuilder, PermissionsBitField, MessageFlags, ChannelType } = require('discord.js');
const config = require('../config.js');
const { notion, getNotionRelationTitles } = require('../utils/notionHelpers.js');
const { getGenerationRoleName, setDiscordIconToNotion } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('DiscordアカウントとNotionの名前を紐付けます。(管理者限定)')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('紐付けたいDiscordユーザー名')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('name')
                .setDescription('Notionデータベース上の正確な名前（タイトル）')
                .setRequired(true)),
    async execute(interaction, redis, notion) {
        const ALLOWED_ROLE_ID = '1449784235102703667';
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasAllowedRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);
        
        if (!isAdmin && !hasAllowedRole) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const targetUser = interaction.options.getUser('user');
        const characterName = interaction.options.getString('name');

        try {
            const response = await notion.databases.query({
                database_id: config.NOTION_DATABASE_ID,
                filter: { property: '名前', title: { equals: characterName } },
            });
            if (response.results.length === 0) {
                return interaction.editReply(`名前「${characterName}」が見つかりませんでした。`);
            }
            
            const page = response.results[0];
            const pageId = page.id;
            const props = page.properties;

            await notion.pages.update({
                page_id: pageId,
                properties: {
                    'DiscordユーザーID': { rich_text: [{ text: { content: targetUser.id } }] },
                },
            });

            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            let addedRoles = [];

            // 称号ロールを付与
            const titleNames = await getNotionRelationTitles(notion, props['称号']);
            for (const roleName of titleNames) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${roleName}:`, e));
                    addedRoles.push(role.name);
                }
            }

            // 世代ロールを付与
            const generationNames = await getNotionRelationTitles(notion, props['世代']);
            if(generationNames.length > 0) {
                const romanRoleName = getGenerationRoleName(generationNames[0]);
                if (romanRoleName) {
                    const role = interaction.guild.roles.cache.find(r => r.name === romanRoleName);
                    if (role) {
                        await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${romanRoleName}:`, e));
                        addedRoles.push(role.name);
                    }
                }
            }
            
            // 【追加】危険等級ロールを付与
            const hazardNames = await getNotionRelationTitles(notion, props['危険等級']);
            for (const roleName of hazardNames) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${roleName}:`, e));
                    addedRoles.push(role.name);
                }
            }

            // 新方式: Notionの『部長』に記録されたチャンネルIDに対して部長設定と権限付与
            let leaderChannelsSet = [];
            try {
                const managerChannelsRaw = props['部長'];
                const channelsText = (managerChannelsRaw && managerChannelsRaw.rich_text && managerChannelsRaw.rich_text[0]?.plain_text) ? managerChannelsRaw.rich_text[0].plain_text : '';
                const channelIds = channelsText.split(',').map(s => s.trim()).filter(Boolean);
                
                for (const chId of channelIds) {
                    try {
                        const ch = await interaction.guild.channels.fetch(chId).catch(() => null);
                        if (!ch || ch.type !== ChannelType.GuildText) {
                            console.log(`[Link] チャンネル ${chId} が見つからないか、テキストチャンネルではありません。`);
                            continue;
                        }
                        
                        // 部活チャンネルかどうかチェック
                        const isClubChannel = (
                            ch.parent && (
                                config.CLUB_CATEGORIES.includes(ch.parent.id) ||
                                ch.parent.id === config.POPULAR_CLUB_CATEGORY_ID ||
                                ch.parent.id === config.INACTIVE_CLUB_CATEGORY_ID ||
                                ch.parent.id === config.ARCHIVE_CATEGORY_ID ||
                                ch.parent.id === config.ARCHIVE_OVERFLOW_CATEGORY_ID
                            )
                        );
                        
                        if (!isClubChannel) {
                            console.log(`[Link] チャンネル ${ch.name} (${chId}) は部活チャンネルではありません。`);
                            continue;
                        }
                        
                        // 既存の部長の権限を削除（Redisから取得）
                        const currentLeaderId = await redis.get(`leader_user:${chId}`);
                        if (currentLeaderId && currentLeaderId !== targetUser.id) {
                            try {
                                await ch.permissionOverwrites.delete(currentLeaderId);
                                console.log(`[Link] 既存の部長（ID: ${currentLeaderId}）の権限を削除しました。チャンネル: ${ch.name}`);
                            } catch (error) {
                                console.error(`[Link] 既存の部長の権限削除エラー:`, error);
                            }
                        }
                        
                        // Redisに部長情報を保存
                        await redis.set(`leader_user:${chId}`, targetUser.id);
                        
                        // チャンネル権限を設定
                        await ch.permissionOverwrites.edit(targetUser.id, {
                            ViewChannel: true,
                            ManageMessages: true,
                            ManageRoles: true
                        });
                        
                        leaderChannelsSet.push(ch.name);
                        console.log(`[Link] チャンネル ${ch.name} (${chId}) の部長を ${targetUser.username} に設定し、権限を付与しました。`);
                    } catch (channelError) {
                        console.error(`[Link] チャンネル ${chId} の処理エラー:`, channelError);
                    }
                }
            } catch (e) {
                console.error('部長権限付与エラー:', e);
            }

            // DiscordアイコンをNotionに自動同期
            try {
                const iconResult = await setDiscordIconToNotion(interaction.client, notion, config, targetUser.id);
                if (iconResult.success) {
                    console.log(`[Link] アイコン同期成功: ${targetUser.username} -> ${characterName}`);
                } else {
                    console.log(`[Link] アイコン同期失敗: ${targetUser.username} - ${iconResult.error}`);
                }
            } catch (iconError) {
                console.error(`[Link] アイコン同期エラー: ${targetUser.username}`, iconError);
            }

            let replyMessage = `成功！ ${targetUser.username} を「${characterName}」に紐付けました。`;
            if (addedRoles.length > 0) {
                replyMessage += `\n付与されたロール: ${addedRoles.join(', ')}`;
            }
            if (leaderChannelsSet.length > 0) {
                replyMessage += `\n部長に設定されたチャンネル: ${leaderChannelsSet.join(', ')}`;
            }
            replyMessage += `\nDiscordアイコンをNotionに同期しました。`;

            await interaction.editReply(replyMessage);

        } catch (error) {
            console.error('Notion API /link error:', error);
            await interaction.editReply('Notionとの連携中にエラーが発生しました。');
        }
    },
};
