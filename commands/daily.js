const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('日課報酬を受け取ります'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const lastDaily = await redis.hget(`user:${mainAccountId}`, 'lastDaily');
            const now = Date.now();

            if (lastDaily && now - parseInt(lastDaily) < config.DAILY_COOLDOWN) {
                const remainingTime = config.DAILY_COOLDOWN - (now - parseInt(lastDaily));
                const hours = Math.floor(remainingTime / (60 * 60 * 1000));
                const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('クールダウン中')
                    .setDescription(`次の日課報酬まで: ${hours}時間${minutes}分`);

                return interaction.editReply({ embeds: [embed] });
            }

            // 報酬の計算
            const amount = Math.floor(Math.random() * (config.DAILY_COIN_MAX - config.DAILY_COIN_MIN + 1)) + config.DAILY_COIN_MIN;
            
            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hset(`user:${mainAccountId}`, 'lastDaily', now.toString());
            multi.hincrby(`user:${mainAccountId}`, 'balance', amount);
            await multi.exec();

            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('日課報酬を受け取りました')
                .addFields(
                    { name: '獲得', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '残高', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('日課報酬エラー:', error);
            await interaction.editReply('日課報酬の受け取り中にエラーが発生しました。');
        }
    },
};
