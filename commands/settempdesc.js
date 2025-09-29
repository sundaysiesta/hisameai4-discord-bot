const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settempdesc')
        .setDescription('あなたのプロフィールに表示する仮の説明文を設定します。')
        .addStringOption(option =>
            option.setName('description')
                .setDescription('設定したい説明文 (リセットする場合は "none" と入力)')
                .setRequired(true)),
    async execute(interaction, redis, notion) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const targetUser = interaction.user;
        const description = interaction.options.getString('description');

        try {
            const response = await notion.databases.query({
                database_id: config.NOTION_DATABASE_ID,
                filter: { property: 'DiscordユーザーID', rich_text: { equals: targetUser.id } },
            });

            if (response.results.length === 0) {
                return interaction.editReply('あなたのプロフィールがNotionデータベースに登録されていません。管理者に連絡してください。');
            }

            const pageId = response.results[0].id;

            await notion.pages.update({
                page_id: pageId,
                properties: {
                    '仮説明': {
                        rich_text: [{
                            text: {
                                content: description.toLowerCase() === 'none' ? '' : description
                            }
                        }]
                    },
                },
            });

            if (description.toLowerCase() === 'none') {
                await interaction.editReply('仮の説明文をリセットしました。');
            } else {
                await interaction.editReply('仮の説明文を設定しました！');
            }

        } catch (error) {
            console.error('Settempdesc command error:', error);
            await interaction.editReply('説明文の設定中にエラーが発生しました。');
        }
    },
};
