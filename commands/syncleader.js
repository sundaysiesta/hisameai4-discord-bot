const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const config = require('../config.js');
const { getAllKeys } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncleader')
        .setDescription('全ユーザーの部長ロールIDをNotion人物DBに同期します（管理者限定）'),
    async execute(interaction, redis, notion) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            // 1. 全部活チャンネルIDから部長ロールIDを収集
            const clubKeys = await getAllKeys(redis, 'leader_roles:*');
            const allLeaderRoleIds = new Set();
            for (const key of clubKeys) {
                const roleId = await redis.get(key);
                if (roleId) allLeaderRoleIds.add(roleId);
            }
            // 2. サーバーメンバーごとに所持している部長ロールID一覧を作成
            const guild = interaction.guild;
            await guild.members.fetch(); // キャッシュ
            let updatedCount = 0;
            for (const member of guild.members.cache.values()) {
                const ownedLeaderRoles = Array.from(allLeaderRoleIds).filter(roleId => member.roles.cache.has(roleId));
                // 3. Notion人物DBでDiscordユーザーID一致のページを検索
                const notionRes = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    filter: { property: 'DiscordユーザーID', rich_text: { equals: member.id } }
                });
                if (notionRes.results.length > 0) {
                    const pageId = notionRes.results[0].id;
                    // 4. 部長ロールプロパティをカンマ区切りで上書き
                    await notion.pages.update({
                        page_id: pageId,
                        properties: {
                            '部長ロール': { rich_text: [{ text: { content: ownedLeaderRoles.join(',') } }] }
                        }
                    });
                    updatedCount++;
                }
            }
            await interaction.editReply(`同期完了: ${updatedCount}人の部長ロール情報をNotionに反映しました。`);
        } catch (error) {
            console.error('syncleader error:', error);
            await interaction.editReply('同期中にエラーが発生しました。');
        }
    },
}; 