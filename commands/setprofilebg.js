const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setprofilebg')
        .setDescription('あなたのプロフィールカードの背景画像を設定します。')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('背景に設定したい画像のURL (リセットする場合は "none" と入力)')
                .setRequired(true)),
    async execute(interaction, redis, notion) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const targetUser = interaction.user;
        const imageUrl = interaction.options.getString('url');

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
                    'プロフカードURL': {
                        url: imageUrl.toLowerCase() === 'none' ? null : imageUrl
                    },
                },
            });

            if (imageUrl.toLowerCase() === 'none') {
                await interaction.editReply('プロフィールカードの背景をデフォルト（黒）にリセットしました。');
            } else {
                await interaction.editReply('プロフィールカードの背景画像を設定しました！ 次回`/profile`コマンド使用時に反映されます。');
            }

        } catch (error) {
            console.error('Setprofilebg command error:', error);
            if (error.code === 'validation_error') {
                 await interaction.editReply('無効なURL形式です。画像のURLを正しく入力してください。');
            } else {
                 await interaction.editReply('背景の設定中にエラーが発生しました。');
            }
        }
    },
};
