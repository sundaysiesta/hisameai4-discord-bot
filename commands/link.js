const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const config = require('../config.js');
const { notion, getNotionRelationTitles, getNotionPropertyText } = require('../utils/notionHelpers.js');
const { getGenerationRoleName } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('DiscordアカウントとNotionの名前を紐付けます。(管理者限定)')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('紐付けたいDiscordユーザー')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('name')
                .setDescription('Notionデータベース上の正確な名前（タイトル）')
                .setRequired(true)),
    async execute(interaction, redis, notion) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

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
            
            // 危険等級ロールを付与
            const hazardNames = await getNotionRelationTitles(notion, props['危険等級']);
            for (const roleName of hazardNames) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${roleName}:`, e));
                    addedRoles.push(role.name);
                }
            }

            // 部長ロールを付与
            const leaderRoleId = getNotionPropertyText(props['部長']);
            if (leaderRoleId && leaderRoleId !== 'N/A') {
                const role = interaction.guild.roles.cache.get(leaderRoleId);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add leader role ${role.name}:`, e));
                    addedRoles.push(role.name);
                }
            }

            let replyMessage = `成功！ ${targetUser.username} を「${characterName}」に紐付けました。`;
            if (addedRoles.length > 0) {
                replyMessage += `\n付与されたロール: ${addedRoles.join(', ')}`;
            }

            await interaction.editReply(replyMessage);

        } catch (error) {
            console.error('Notion API /link error:', error);
            await interaction.editReply('Notionとの連携中にエラーが発生しました。');
        }
    },
};
