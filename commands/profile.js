const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const { notion, getNotionPropertyText, getNotionRelationTitles } = require('../utils/notionHelpers.js');
const { getGenerationRoleName } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('プロフィールを表示します。ユーザー指定か名前検索、または自身のプロフを表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('プロフィールを表示したいユーザー')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Notionデータベースの名前で検索')
                .setRequired(false)),

    async execute(interaction, redis, notion) {
        await interaction.deferReply();

        const userOption = interaction.options.getUser('user');
        const nameOption = interaction.options.getString('name');

        let notionPage;
        let targetUser;

        try {
            if (nameOption) {
                // 名前で検索する場合
                const response = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    filter: { property: '名前', title: { equals: nameOption } },
                });
                if (response.results.length === 0) {
                    return interaction.editReply(`名前「${nameOption}」のプロフィールは見つかりませんでした。`);
                }
                notionPage = response.results[0];
                const discordId = getNotionPropertyText(notionPage.properties['DiscordユーザーID']);
                if (discordId !== 'N/A') {
                    targetUser = await interaction.client.users.fetch(discordId).catch(() => null);
                }
                if (!targetUser) {
                    targetUser = interaction.user; 
                }
            } else {
                // ユーザー指定または自身のプロフィール
                targetUser = userOption || interaction.user;
                const response = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    filter: { property: 'DiscordユーザーID', rich_text: { equals: targetUser.id } },
                });
                if (response.results.length === 0) {
                    return interaction.editReply(`${targetUser.username} さんのプロフィールはまだ登録されていません。`);
                }
                notionPage = response.results[0];
            }

            const props = notionPage.properties;
            let imageUrl = targetUser ? targetUser.displayAvatarURL() : interaction.guild.iconURL();
            if (notionPage.icon?.type === 'file') imageUrl = notionPage.icon.file.url;
            if (notionPage.icon?.type === 'external') imageUrl = notionPage.icon.external.url;
            
            const generationNames = await getNotionRelationTitles(notion, props['世代']);
            const generationValue = generationNames.length > 0 ? generationNames.join(', ') : '不明';
            
            let embedColor = 0x5865F2;
            if(generationNames.length > 0) {
                const romanRoleName = getGenerationRoleName(generationNames[0]);
                if (romanRoleName) {
                    const role = interaction.guild.roles.cache.find(r => r.name === romanRoleName);
                    if (role && role.color !== 0) embedColor = role.color;
                }
            }
            
            const genderValue = getNotionPropertyText(props['性別']);
            const birthYearValue = getNotionPropertyText(props['生年度']);
            const birthplaceValue = getNotionPropertyText(props['出身地']);
            const communityNames = await getNotionRelationTitles(notion, props['界隈']);
            const titleNames = await getNotionRelationTitles(notion, props['称号']);
            const hazardNames = await getNotionRelationTitles(notion, props['危険等級']); // 【追加】
            const descriptionValue = getNotionPropertyText(props['説明']);
            const rankValue = getNotionPropertyText(props['ロメランク']);

            const communityValue = communityNames.length > 0 ? communityNames.join(', ') : '不明';
            const titleValue = titleNames.length > 0 ? titleNames.join(', ') : 'なし';
            const hazardValue = hazardNames.length > 0 ? hazardNames.join(', ') : 'なし'; // 【追加】

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(`${getNotionPropertyText(props['名前'])} のプロフィール`)
                .setThumbnail(imageUrl)
                .addFields(
                    { name: '世代', value: generationValue, inline: true },
                    { name: '性別', value: genderValue === 'N/A' ? '不明' : genderValue, inline: true },
                    { name: '生年度', value: birthYearValue === 'N/A' ? '不明' : birthYearValue, inline: true },
                    { name: '出身地', value: birthplaceValue === 'N/A' ? '不明' : birthplaceValue, inline: true },
                    { name: '界隈', value: communityValue, inline: true },
                    { name: '称号', value: titleValue, inline: true },
                    { name: 'ロメランク', value: rankValue, inline: true },
                    { name: '危険等級', value: hazardValue, inline: true }, // 【追加】
                    { name: '説明', value: descriptionValue === 'N/A' ? 'なし' : descriptionValue }
                )
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.username}` });
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Notion API /profile error:', error);
            await interaction.editReply('プロフィールの取得中にエラーが発生しました。');
        }
    },
};
