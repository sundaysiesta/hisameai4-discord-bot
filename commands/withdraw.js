const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('銀行から所持金を引き出します')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('引き出す金額')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const amount = interaction.options.getInteger('amount');
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const bankBalance = await redis.hget(`user:${mainAccountId}`, 'bank') || '0';
            
            if (parseInt(bankBalance) < amount) {
                return interaction.editReply(`銀行残高が足りません。\n銀行残高: ${config.COIN_SYMBOL} ${parseInt(bankBalance).toLocaleString()} ${config.COIN_NAME}`);
            }

            // 税金の計算
            const tax = Math.floor(amount * config.TAX_RATE);
            const taxAmount = tax;
            const withdrawAmount = amount - taxAmount;

            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hincrby(`user:${mainAccountId}`, 'bank', -amount);
            multi.hincrby(`user:${mainAccountId}`, 'balance', withdrawAmount);
            multi.hincrby(`user:${config.FINANCE_DEPARTMENT_ID}`, 'balance', taxAmount);
            await multi.exec();

            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');
            const newBank = await redis.hget(`user:${mainAccountId}`, 'bank');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('引き出し完了')
                .setDescription(`${amount.toLocaleString()}${config.COIN_NAME}を引き出しました！`)
                .addFields(
                    { name: '引き出し額', value: `${config.COIN_SYMBOL} ${withdrawAmount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '税金', value: `${config.COIN_SYMBOL} ${taxAmount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '所持金', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '銀行残高', value: `${config.COIN_SYMBOL} ${parseInt(newBank).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('引き出しエラー:', error);
            await interaction.editReply('引き出し中にエラーが発生しました。');
        }
    },
}; 