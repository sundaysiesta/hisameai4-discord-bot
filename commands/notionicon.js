const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { setDiscordIconsToNotion, setDiscordIconToNotion } = require('../utils/utility.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notionicon')
        .setDescription('NotionデータベースとDiscordアイコンの同期を行います（管理者限定）')
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync')
                .setDescription('DiscordアイコンをNotionに一括で同期します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('syncuser')
                .setDescription('指定したユーザーのDiscordアイコンをNotionに同期します')
                .addUserOption(option =>
                    option.setName('ユーザー')
                        .setDescription('アイコンを同期したいユーザー')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Notionアイコン設定の状況を確認します')
        ),
    async execute(interaction, redis, notion) {
        // 管理者権限チェック
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: 'このコマンドは管理者のみ使用できます。', 
                ephemeral: true 
            });
        }

        const subcommand = interaction.options.getSubcommand();


        if (subcommand === 'sync') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const results = await setDiscordIconsToNotion(interaction.client, notion, config);
                
                const successCount = results.filter(r => r.success).length;
                const failCount = results.filter(r => !r.success).length;
                
                let message = `🔄 Discordアイコン→Notion同期完了！\n✅ 成功: ${successCount}件\n❌ 失敗: ${failCount}件\n\n`;
                
                if (failCount > 0) {
                    message += '**失敗したユーザー:**\n';
                    results.filter(r => !r.success).forEach(r => {
                        message += `• ${r.pageTitle} (${r.userId}): ${r.error}\n`;
                    });
                }

                // メッセージが長すぎる場合は分割
                if (message.length > 2000) {
                    const embed = new EmbedBuilder()
                        .setTitle('Discordアイコン→Notion同期結果')
                        .setDescription(`✅ 成功: ${successCount}件\n❌ 失敗: ${failCount}件`)
                        .setColor(successCount > failCount ? 0x00ff00 : 0xff0000);

                    if (failCount > 0) {
                        const failedUsers = results.filter(r => !r.success).slice(0, 10); // 最初の10件のみ表示
                        embed.addFields({
                            name: '失敗したユーザー（最初の10件）',
                            value: failedUsers.map(r => `• ${r.pageTitle}: ${r.error}`).join('\n'),
                            inline: false
                        });
                    }

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: message });
                }
            } catch (error) {
                console.error('Discordアイコン同期エラー:', error);
                await interaction.editReply({ 
                    content: `❌ 同期中にエラーが発生しました: ${error.message}` 
                });
            }
        }

        if (subcommand === 'syncuser') {
            const targetUser = interaction.options.getUser('ユーザー');
            
            await interaction.deferReply({ ephemeral: true });

            try {
                const result = await setDiscordIconToNotion(interaction.client, notion, config, targetUser.id);
                
                if (result.success) {
                    await interaction.editReply({ 
                        content: `✅ ${targetUser.username} のDiscordアイコンをNotionに同期しました！\nNotionページ: ${result.pageTitle}\nアイコンURL: ${result.avatarUrl}` 
                    });
                } else {
                    await interaction.editReply({ 
                        content: `❌ ${targetUser.username} のDiscordアイコン同期に失敗しました。\nエラー: ${result.error}` 
                    });
                }
            } catch (error) {
                console.error('Discordアイコン同期エラー:', error);
                await interaction.editReply({ 
                    content: `❌ エラーが発生しました: ${error.message}` 
                });
            }
        }

        if (subcommand === 'status') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const response = await notion.databases.query({
                    database_id: config.NOTION_DATABASE_ID,
                    page_size: 100
                });

                let message = '📊 Notionアイコン設定状況\n\n';
                let hasIconCount = 0;
                let noIconCount = 0;
                let linkedCount = 0;
                let unlinkedCount = 0;

                for (const page of response.results) {
                    const discordId = page.properties['DiscordユーザーID'].rich_text[0]?.plain_text;
                    const name = page.properties['名前'].title[0]?.plain_text || '不明';
                    
                    if (discordId && discordId !== 'N/A') {
                        linkedCount++;
                        if (page.icon && page.icon.type === 'external') {
                            hasIconCount++;
                            message += `✅ ${name} (${discordId}) - アイコン設定済み\n`;
                        } else {
                            noIconCount++;
                            message += `❌ ${name} (${discordId}) - アイコン未設定\n`;
                        }
                    } else {
                        unlinkedCount++;
                        message += `🔗 ${name} - Discord未リンク\n`;
                    }
                }

                message += `\n**統計:**\n• Discordリンク済み: ${linkedCount}人\n• アイコン設定済み: ${hasIconCount}人\n• アイコン未設定: ${noIconCount}人\n• Discord未リンク: ${unlinkedCount}人`;

                // メッセージが長すぎる場合は分割
                if (message.length > 2000) {
                    const embed = new EmbedBuilder()
                        .setTitle('Notionアイコン設定状況')
                        .setDescription(`**統計:**\n• Discordリンク済み: ${linkedCount}人\n• アイコン設定済み: ${hasIconCount}人\n• アイコン未設定: ${noIconCount}人\n• Discord未リンク: ${unlinkedCount}人`)
                        .setColor(0x0099ff);

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: message });
                }
            } catch (error) {
                console.error('Notionアイコン状況確認エラー:', error);
                await interaction.editReply({ 
                    content: `❌ 状況確認中にエラーが発生しました: ${error.message}` 
                });
            }
        }
    },
};
