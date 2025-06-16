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
            // メインアカウントIDの取得
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            
            // 現在時刻を取得（UTC）
            const now = new Date();
            const nowTime = now.getTime();
            
            // 前回のデイリー時間を取得
            const lastDaily = await redis.get(`daily:${mainAccountId}`);
            
            if (lastDaily) {
                const lastDailyTime = parseInt(lastDaily);
                const timeDiff = nowTime - lastDailyTime;
                
                // 24時間（ミリ秒）未満の場合
                if (timeDiff < 86400000) {
                    const remainingTime = 86400000 - timeDiff;
                    const hoursLeft = Math.floor(remainingTime / (60 * 60 * 1000));
                    const minutesLeft = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
                    const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);

                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('クールダウン中')
                        .setDescription(`次のデイリーボーナスまで: ${hoursLeft}時間${minutesLeft}分${secondsLeft}秒`);

                    return interaction.editReply({ embeds: [embed] });
                }
            }

            // ブースターロールの確認
            const member = await interaction.guild.members.fetch(userId);
            const hasBoosterRole = member.roles.cache.has(config.BOOSTER_ROLE_ID);
            const amount = hasBoosterRole ? config.DAILY_COIN_BOOSTED_AMOUNT : config.DAILY_COIN_AMOUNT;
            
            // Redisでのトランザクション処理
            const multi = redis.multi();
            
            // 最後のデイリー時間を設定（24時間の有効期限付き）
            multi.set(`daily:${mainAccountId}`, nowTime.toString(), 'EX', 86400);
            
            // 残高を更新
            multi.hincrby(`user:${mainAccountId}`, 'balance', amount);
            
            // トランザクションを実行
            const results = await multi.exec();
            
            if (!results) {
                throw new Error('トランザクションの実行に失敗しました');
            }

            // 新しい残高を取得
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
