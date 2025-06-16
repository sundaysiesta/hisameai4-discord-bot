const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('所持金と銀行残高を表示します')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user') || interaction.user;
        
        try {
            const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
            const balance = await redis.hget(`user:${mainAccountId}`, 'balance') || '0';
            const bank = await redis.hget(`user:${mainAccountId}`, 'bank') || '0';
            const total = parseInt(balance) + parseInt(bank);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`${targetUser.username} の残高`)
                .addFields(
                    { name: '所持金', value: `${config.COIN_SYMBOL} ${parseInt(balance).toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '銀行残高', value: `${config.COIN_SYMBOL} ${parseInt(bank).toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '合計', value: `${config.COIN_SYMBOL} ${total.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('残高表示エラー:', error);
            await interaction.editReply('残高の取得中にエラーが発生しました。');
        }
    },
};
