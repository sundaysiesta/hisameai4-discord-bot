const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const { notion } = require('../utils/notionHelpers.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('ショップでアイテムを購入します')
        .addStringOption(option => 
            option.setName('itemid')
                .setDescription('購入するアイテムのID')
                .setRequired(true)
                .addChoices(
                    ...config.COIN_ITEMS.map(item => ({
                        name: item.name,
                        value: item.id
                    }))
                )),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const itemId = interaction.options.getString('itemid');
        
        try {
            const item = config.COIN_ITEMS.find(i => i.id === itemId);
            if (!item) {
                return interaction.editReply('指定されたアイテムが見つかりません。');
            }

            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const balance = await redis.hget(`user:${mainAccountId}`, 'balance') || '0';

            if (parseInt(balance) < item.price) {
                return interaction.editReply(`所持金が足りません。\n必要金額: ${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}\n所持金: ${config.COIN_SYMBOL} ${parseInt(balance).toLocaleString()} ${config.COIN_NAME}`);
            }

            // アイテム固有の処理
            let successMessage = '';
            switch (itemId) {
                case 'weather_title':
                case 'lome_master':
                    // Notionデータベースに称号を追加
                    try {
                        const response = await notion.databases.query({
                            database_id: config.NOTION_DATABASE_ID,
                            filter: {
                                property: 'DiscordユーザーID',
                                rich_text: { equals: userId }
                            }
                        });

                        if (response.results.length > 0) {
                            const pageId = response.results[0].id;
                            const currentTitles = response.results[0].properties['称号']?.relation || [];
                            
                            // 称号データベースに新しい称号を追加
                            const titlePage = await notion.pages.create({
                                parent: { database_id: config.NOTION_TITLES_DATABASE_ID },
                                properties: {
                                    '名称': { title: [{ text: { content: item.name } }] },
                                    '開催日': { date: { start: new Date().toISOString().split('T')[0] } }
                                }
                            });

                            // ユーザーの称号リストを更新
                            await notion.pages.update({
                                page_id: pageId,
                                properties: {
                                    '称号': {
                                        relation: [...currentTitles, { id: titlePage.id }]
                                    }
                                }
                            });
                        }
                        successMessage = `${item.name}を購入し、称号に追加しました！`;
                    } catch (error) {
                        console.error('称号追加エラー:', error);
                        return interaction.editReply('称号の追加中にエラーが発生しました。');
                    }
                    break;

                case 'custom_role':
                    // カスタムロールを作成
                    try {
                        const role = await interaction.guild.roles.create({
                            name: `${interaction.user.username}の称号`,
                            color: 'Random',
                            reason: 'ロメコインショップでの購入'
                        });
                        await interaction.member.roles.add(role);
                        successMessage = `カスタムロール「${role.name}」を作成し、付与しました！`;
                    } catch (error) {
                        console.error('ロール作成エラー:', error);
                        return interaction.editReply('ロールの作成中にエラーが発生しました。');
                    }
                    break;

                default:
                    successMessage = `${item.name}を購入しました！`;
            }

            // 購入処理（コインの減算）
            await redis.hincrby(`user:${mainAccountId}`, 'balance', -item.price);
            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('購入完了')
                .setDescription(successMessage)
                .addFields(
                    { name: 'アイテム', value: item.name, inline: true },
                    { name: '価格', value: `${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '残高', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('購入エラー:', error);
            await interaction.editReply('購入処理中にエラーが発生しました。');
        }
    },
};
