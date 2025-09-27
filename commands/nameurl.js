const { SlashCommandBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nameurl')
        .setDescription('指定された名前リストからNotionデータベースのアイコンURLを取得してCSV形式で返します（管理者限定）')
        .addStringOption(option =>
            option.setName('リスト')
                .setDescription('名前リスト（改行区切り）')
                .setRequired(true)
        ),
    async execute(interaction, redis, notion) {
        // 管理者権限チェック
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: 'このコマンドは管理者のみ使用できます。', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const nameList = interaction.options.getString('リスト');
            const names = nameList.split('\n').map(name => name.trim()).filter(name => name.length > 0);
            
            const results = [];
            
            for (const name of names) {
                try {
                    // Notionデータベースから名前で検索
                    const response = await notion.databases.query({
                        database_id: config.NOTION_DATABASE_ID,
                        filter: {
                            property: '名前',
                            title: {
                                equals: name
                            }
                        }
                    });

                    if (response.results.length > 0) {
                        const page = response.results[0];
                        const iconUrl = page.properties['アイコンURL']?.url || 'URLなし';
                        results.push(`${name},${iconUrl}`);
                    } else {
                        results.push(`${name},見つかりません`);
                    }
                } catch (error) {
                    console.error(`名前 "${name}" の検索エラー:`, error);
                    results.push(`${name},エラー`);
                }
            }

            const csvResult = results.join('\n');
            
            // メッセージが長すぎる場合はファイルとして送信
            if (csvResult.length > 2000) {
                const buffer = Buffer.from(csvResult, 'utf8');
                await interaction.editReply({
                    content: '結果が長いため、ファイルとして送信します。',
                    files: [{
                        attachment: buffer,
                        name: 'name_url_list.csv'
                    }]
                });
            } else {
                await interaction.editReply({
                    content: `\`\`\`\n${csvResult}\n\`\`\``
                });
            }

        } catch (error) {
            console.error('nameurlコマンドエラー:', error);
            await interaction.editReply({ 
                content: `❌ エラーが発生しました: ${error.message}` 
            });
        }
    },
};
