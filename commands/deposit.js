const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('所持金を銀行に預けます')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('預ける金額')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const amount = interaction.options.getInteger('amount');
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const balance = await redis.hget(`user:${mainAccountId}`, 'balance') || '0';
            
            if (parseInt(balance) < amount) {
                return interaction.editReply(`所持金が足りません。\n所持金: ${config.COIN_SYMBOL} ${parseInt(balance).toLocaleString()} ${config.COIN_NAME}`);
            }

            // 税金の計算
            const tax = Math.floor(amount * config.TAX_RATE);
            const taxAmount = tax;
            const depositAmount = amount - taxAmount;

            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hincrby(`user:${mainAccountId}`, 'balance', -amount);
            multi.hincrby(`user:${mainAccountId}`, 'bank', depositAmount);
            multi.hincrby(`user:${config.FINANCE_DEPARTMENT_ID}`, 'balance', taxAmount);
            await multi.exec();

            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');
            const newBank = await redis.hget(`user:${mainAccountId}`, 'bank');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('預金完了')
                .setDescription(`${amount.toLocaleString()}${config.COIN_NAME}を預けました！`)
                .addFields(
                    { name: '預金額', value: `${config.COIN_SYMBOL} ${depositAmount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '税金', value: `${config.COIN_SYMBOL} ${taxAmount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '所持金', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '銀行残高', value: `${config.COIN_SYMBOL} ${parseInt(newBank).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('預金エラー:', error);
            await interaction.editReply('預金中にエラーが発生しました。');
        }
    },
}; 