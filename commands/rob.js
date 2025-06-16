const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rob')
        .setDescription('財務省から強盗を試みます'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        
        try {
            // クールダウンチェック
            const lastRobTime = await redis.get(`rob:${userId}`);
            if (lastRobTime) {
                const timeLeft = parseInt(lastRobTime) + config.ROB_COOLDOWN - Date.now();
                if (timeLeft > 0) {
                    const minutes = Math.ceil(timeLeft / 60000);
                    return interaction.editReply(`強盗は${minutes}分後に再度試みることができます。`);
                }
            }

            const financeBalance = await redis.hget(`user:${config.FINANCE_DEPARTMENT_ID}`, 'balance') || '0';
            
            if (parseInt(financeBalance) <= 0) {
                return interaction.editReply('財務省には何もありません。');
            }

            // 強盗の成功判定
            const isSuccess = Math.random() < config.ROB_SUCCESS_RATE;
            const robPercent = Math.random() * (config.ROB_MAX_PERCENT - config.ROB_MIN_PERCENT) + config.ROB_MIN_PERCENT;
            const robAmount = Math.floor(parseInt(financeBalance) * robPercent);

            if (isSuccess) {
                // 成功時の処理
                const multi = redis.multi();
                multi.hincrby(`user:${config.FINANCE_DEPARTMENT_ID}`, 'balance', -robAmount);
                multi.hincrby(`user:${userId}`, 'balance', robAmount);
                multi.set(`rob:${userId}`, Date.now());
                await multi.exec();

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('強盗成功！')
                    .setDescription(`財務省から${robAmount.toLocaleString()}${config.COIN_NAME}を盗みました！`)
                    .addFields(
                        { name: '盗んだ金額', value: `${config.COIN_SYMBOL} ${robAmount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '財務省の残高', value: `${config.COIN_SYMBOL} ${(parseInt(financeBalance) - robAmount).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else {
                // 失敗時の処理
                const fine = Math.floor(robAmount * 0.5); // 盗もうとした金額の50%を罰金として
                const multi = redis.multi();
                multi.hincrby(`user:${userId}`, 'balance', -fine);
                multi.hincrby(`user:${config.FINANCE_DEPARTMENT_ID}`, 'balance', fine);
                multi.set(`rob:${userId}`, Date.now());
                await multi.exec();

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('強盗失敗！')
                    .setDescription('強盗に失敗し、罰金を科せられました！')
                    .addFields(
                        { name: '罰金額', value: `${config.COIN_SYMBOL} ${fine.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('強盗エラー:', error);
            await interaction.editReply('強盗中にエラーが発生しました。');
        }
    },
}; 