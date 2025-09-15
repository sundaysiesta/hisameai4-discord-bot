const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('migrateleaders')
        .setDescription('Notionの「部長」情報に基づきチャンネル権限・Redisを同期します。(管理者限定)'),
    async execute(interaction, redis, notion) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            await guild.members.fetch();

            // Notion全件取得（DiscordユーザーID・部長）
            let startCursor = undefined;
            const pages = [];
            do {
                const res = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    start_cursor: startCursor,
                });
                pages.push(...res.results);
                startCursor = res.has_more ? res.next_cursor : undefined;
            } while (startCursor);

            let updatedPerms = 0;
            let updatedRedis = 0;
            let cleanedNotion = 0;
            let missingMembers = 0;
            let missingChannels = 0;
            const conflicts = new Map(); // channelId -> Set<userId>
            const assigned = new Map(); // channelId -> userId（優先割当）

            for (const page of pages) {
                const discordIdProp = page.properties?.['DiscordユーザーID'];
                const leaderProp = page.properties?.['部長'];
                const userId = (discordIdProp && discordIdProp.rich_text && discordIdProp.rich_text[0]?.plain_text) ? discordIdProp.rich_text[0].plain_text.trim() : '';
                const raw = (leaderProp && leaderProp.rich_text && leaderProp.rich_text[0]?.plain_text) ? leaderProp.rich_text[0].plain_text : '';
                const channelIds = raw.split(',').map(s => s.trim()).filter(Boolean);

                if (!userId || channelIds.length === 0) continue;

                const member = await guild.members.fetch(userId).catch(() => null);
                if (!member) { missingMembers++; continue; }

                const validChannels = [];
                for (const channelId of channelIds) {
                    const channel = await guild.channels.fetch(channelId).catch(() => null);
                    if (!channel || channel.type !== ChannelType.GuildText) { missingChannels++; continue; }

                    // 競合検出
                    const prev = assigned.get(channelId);
                    if (prev && prev !== userId) {
                        const set = conflicts.get(channelId) || new Set([prev]);
                        set.add(userId);
                        conflicts.set(channelId, set);
                        continue; // 最初の割当を優先
                    }

                    // 権限付与
                    try {
                        await channel.permissionOverwrites.edit(userId, {
                            ViewChannel: true,
                            SendMessages: true,
                            ManageChannels: true,
                            ManageMessages: true
                        });
                        updatedPerms++;
                        assigned.set(channelId, userId);
                    } catch (e) {
                        console.error(`権限付与失敗: channel=${channelId}, user=${userId}`, e);
                    }

                    // Redis更新
                    try {
                        await redis.set(`leader_user:${channelId}`, userId);
                        updatedRedis++;
                    } catch (e) {
                        console.error(`Redis更新失敗: channel=${channelId}, user=${userId}`, e);
                    }

                    validChannels.push(channelId);
                }

                // Notion側のクリーニング（存在しないチャンネルID削除）
                const newJoined = validChannels.join(',');
                if (newJoined !== channelIds.join(',')) {
                    try {
                        await notion.pages.update({
                            page_id: page.id,
                            properties: { '部長': { rich_text: [{ text: { content: newJoined } }] } }
                        });
                        cleanedNotion++;
                    } catch (e) {
                        console.error(`Notionクリーニング失敗: user=${userId}`, e);
                    }
                }
            }

            let conflictText = '';
            if (conflicts.size > 0) {
                const lines = [];
                for (const [cid, set] of conflicts.entries()) {
                    lines.push(`${cid}: ${Array.from(set).join(', ')}`);
                }
                conflictText = `\n競合（同一チャンネルに複数の部長）:\n${lines.join('\n')}`;
            }

            await interaction.editReply(
                `同期完了: 権限更新 ${updatedPerms}, Redis更新 ${updatedRedis}, Notion整理 ${cleanedNotion}, 不在ユーザー ${missingMembers}, 不在チャンネル ${missingChannels}.${conflictText}`
            );
        } catch (error) {
            console.error('migrateleaders error:', error);
            await interaction.editReply('移行中にエラーが発生しました。ログを確認してください。');
        }
    },
};


