const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('migrateleaders')
        .setDescription('旧「部長ロール」方式から新「個別権限」方式へデータ移行します。(管理者限定)'),
    async execute(interaction, redis, notion) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            let processedChannels = 0;
            let updatedLeaders = 0;
            let notionUpdates = 0;

            // キャッシュにないチャンネル/メンバーも対象にするため事前フェッチ
            const allFetchedChannels = await guild.channels.fetch();
            await guild.members.fetch();

            // すべての対象チャンネルを列挙（親カテゴリ一致でフィルタ）
            let allClubChannels = [];
            for (const categoryId of config.CLUB_CATEGORIES) {
                const clubChannels = allFetchedChannels.filter(ch =>
                    ch && ch.parentId === categoryId &&
                    !config.EXCLUDED_CHANNELS.includes(ch.id) &&
                    ch.type === ChannelType.GuildText
                );
                allClubChannels.push(...clubChannels.values());
            }

            for (const channel of allClubChannels) {
                processedChannels++;
                // 旧データ: leader_roles:<channelId> -> roleId
                const roleId = await redis.get(`leader_roles:${channel.id}`);
                if (!roleId) continue;
                const role = await guild.roles.fetch(roleId).catch(() => null);
                if (!role || role.members.size === 0) continue;

                // 最初のメンバーを部長として採用（複数いる場合は先頭のみ）
                const leaderMember = role.members.first();
                if (!leaderMember) continue;

                // 新データ保存: leader_user:<channelId> = userId
                await redis.set(`leader_user:${channel.id}`, leaderMember.id);
                updatedLeaders++;

                // 権限をユーザーへ直接付与（旧ロールと共存）
                await channel.permissionOverwrites.edit(leaderMember.id, {
                    ViewChannel: true,
                    ManageChannels: true,
                    ManageMessages: true
                }).catch(() => {});

                // Notionの『部長』プロパティにチャンネルIDを追記
                try {
                    const notionRes = await notion.databases.query({
                        database_id: config.NOTION_DATABASE_ID,
                        filter: { property: 'DiscordユーザーID', rich_text: { equals: leaderMember.id } }
                    });
                    if (notionRes.results.length > 0) {
                        const page = notionRes.results[0];
                        const pageId = page.id;
                        const current = page.properties?.['部長'];
                        const prev = (current && current.rich_text && current.rich_text[0]?.plain_text) ? current.rich_text[0].plain_text : '';
                        const ids = new Set((prev || '').split(',').map(s => s.trim()).filter(Boolean));
                        ids.add(channel.id);
                        await notion.pages.update({
                            page_id: pageId,
                            properties: { '部長': { rich_text: [{ text: { content: Array.from(ids).join(',') } }] } }
                        });
                        notionUpdates++;
                    }
                } catch (e) {
                    console.error(`Notion更新失敗 (${channel.id}):`, e);
                }
            }

            await interaction.editReply(`移行完了: 対象チャンネル ${processedChannels}、部長設定 ${updatedLeaders}、Notion更新 ${notionUpdates}。`);
        } catch (error) {
            console.error('migrateleaders error:', error);
            await interaction.editReply('移行中にエラーが発生しました。ログを確認してください。');
        }
    },
};


