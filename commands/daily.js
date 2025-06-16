const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('デイリーボーナスを受け取ります'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const lastDaily = await redis.hget(`user:${mainAccountId}`, 'lastDaily');
            const now = new Date();
            
            // 日本時間に調整（UTC+9）
            now.setHours(now.getHours() + 9);
            
            // 今日の0時0分0秒を取得
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            today.setHours(today.getHours() - 9); // UTCに戻す
            
            // 前回のデイリー時間を取得
            const lastDailyDate = lastDaily ? new Date(parseInt(lastDaily)) : null;
            
            // 前回のデイリーが今日の0時以降かチェック
            if (lastDailyDate && lastDailyDate >= today) {
                const nextReset = new Date(today);
                nextReset.setDate(nextReset.getDate() + 1);
                const remainingTime = nextReset.getTime() - now.getTime();
                const hours = Math.floor(remainingTime / (60 * 60 * 1000));
                const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('クールダウン中')
                    .setDescription(`次のデイリーボーナスまで: ${hours}時間${minutes}分`);

                return interaction.editReply({ embeds: [embed] });
            }

            // ブースターロールの確認
            const member = await interaction.guild.members.fetch(userId);
            const hasBoosterRole = member.roles.cache.has(config.BOOSTER_ROLE_ID);
            const amount = hasBoosterRole ? config.DAILY_COIN_BOOSTED_AMOUNT : config.DAILY_COIN_AMOUNT;
            
            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hset(`user:${mainAccountId}`, 'lastDaily', now.getTime().toString());
            multi.hincrby(`user:${mainAccountId}`, 'balance', amount);
            await multi.exec();

            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('デイリーボーナスを受け取りました')
                .addFields(
                    { name: '獲得', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '残高', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('デイリーボーナスエラー:', error);
            await interaction.editReply('デイリーボーナスの受け取り中にエラーが発生しました。');
        }
    },
};
