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
            
            // 現在時刻を取得（JST）
            const now = new Date();
            const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
            const today = jstNow.toISOString().split('T')[0]; // YYYY-MM-DD形式
            
            // 前回のデイリー日付を取得
            const lastDailyDate = await redis.get(`daily:${mainAccountId}`);
            
            if (lastDailyDate === today) {
                // 次の日付まで待つ必要がある
                const tomorrow = new Date(jstNow);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                
                const remainingTime = tomorrow.getTime() - jstNow.getTime();
                const hoursLeft = Math.floor(remainingTime / (60 * 60 * 1000));
                const minutesLeft = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
                const secondsLeft = Math.floor((remainingTime % (60 * 1000)) / 1000);

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('クールダウン中')
                    .setDescription(`次のデイリーボーナスまで: ${hoursLeft}時間${minutesLeft}分${secondsLeft}秒`);

                return interaction.editReply({ embeds: [embed] });
            }

            // ブースターロールの確認
            const member = await interaction.guild.members.fetch(userId);
            const hasBoosterRole = member.roles.cache.has(config.BOOSTER_ROLE_ID);
            const amount = hasBoosterRole ? config.DAILY_COIN_BOOSTED_AMOUNT : config.DAILY_COIN_AMOUNT;
            
            // Redisでのトランザクション処理
            const multi = redis.multi();
            
            // 最後のデイリー日付を設定（翌日の0時まで有効）
            const tomorrow = new Date(jstNow);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            const ttl = Math.floor((tomorrow.getTime() - jstNow.getTime()) / 1000);
            
            multi.set(`daily:${mainAccountId}`, today);
            multi.expire(`daily:${mainAccountId}`, ttl);
            
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
