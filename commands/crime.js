const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crime')
        .setDescription('犯罪を犯してコインを稼ぎます（失敗すると罰金）'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const lastCrime = await redis.hget(`user:${mainAccountId}`, 'lastCrime');
            const now = Date.now();

            if (lastCrime && now - parseInt(lastCrime) < config.CRIME_COOLDOWN) {
                const remainingTime = config.CRIME_COOLDOWN - (now - parseInt(lastCrime));
                const minutes = Math.floor(remainingTime / (60 * 1000));
                const seconds = Math.floor((remainingTime % (60 * 1000)) / 1000);

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('クールダウン中')
                    .setDescription(`次の犯罪まで: ${minutes}分${seconds}秒`);

                return interaction.editReply({ embeds: [embed] });
            }

            // 犯罪のリスト
            const crimes = [
                { name: '万引き', message: '万引きをして' },
                { name: '強盗', message: '強盗をして' },
                { name: '詐欺', message: '詐欺をして' },
                { name: '窃盗', message: '窃盗をして' },
                { name: '横領', message: '横領をして' }
            ];

            const crime = crimes[Math.floor(Math.random() * crimes.length)];
            const isSuccess = Math.random() < config.CRIME_SUCCESS_RATE;

            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hset(`user:${mainAccountId}`, 'lastCrime', now.toString());

            if (isSuccess) {
                const amount = Math.floor(Math.random() * (config.CRIME_COIN_MAX - config.CRIME_COIN_MIN + 1)) + config.CRIME_COIN_MIN;
                multi.hincrby(`user:${mainAccountId}`, 'balance', amount);
                await multi.exec();

                const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle(crime.name)
                    .setDescription(`${crime.message}${amount.toLocaleString()}${config.COIN_NAME}を獲得しました！`)
                    .addFields(
                        { name: '獲得', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '残高', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else {
                const fine = Math.floor(Math.random() * (config.CRIME_FINE_MAX - config.CRIME_FINE_MIN + 1)) + config.CRIME_FINE_MIN;
                const currentBalance = await redis.hget(`user:${mainAccountId}`, 'balance') || '0';
                const newBalance = Math.max(0, parseInt(currentBalance) - fine);
                multi.hset(`user:${mainAccountId}`, 'balance', newBalance.toString());
                await multi.exec();

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('犯罪失敗')
                    .setDescription(`${crime.name}に失敗し、罰金を科せられました！`)
                    .addFields(
                        { name: '罰金', value: `${config.COIN_SYMBOL} ${fine.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '残高', value: `${config.COIN_SYMBOL} ${newBalance.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('犯罪エラー:', error);
            await interaction.editReply('犯罪中にエラーが発生しました。');
        }
    },
}; 