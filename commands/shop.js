const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('アイテムショップを表示します'),
    async execute(interaction) {
        await interaction.deferReply();
        
        try {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('ロメコインショップ')
                .setDescription('購入には `/buy [アイテムID]` を使用してください。');

            for (const item of config.COIN_ITEMS) {
                embed.addFields({
                    name: `${item.name} (ID: ${item.id})`,
                    value: `${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}\n${item.description}`
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('ショップ表示エラー:', error);
            await interaction.editReply('ショップの表示中にエラーが発生しました。');
        }
    },
};
