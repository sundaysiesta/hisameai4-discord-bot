const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('働いてコインを稼ぎます'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        
        try {
            const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
            const lastWork = await redis.hget(`user:${mainAccountId}`, 'lastWork');
            const now = Date.now();

            if (lastWork && now - parseInt(lastWork) < config.WORK_COOLDOWN) {
                const remainingTime = config.WORK_COOLDOWN - (now - parseInt(lastWork));
                const minutes = Math.floor(remainingTime / (60 * 1000));
                const seconds = Math.floor((remainingTime % (60 * 1000)) / 1000);

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('クールダウン中')
                    .setDescription(`次の労働まで: ${minutes}分${seconds}秒`);

                return interaction.editReply({ embeds: [embed] });
            }

            // 仕事のリスト
            const jobs = [
                { name: 'プログラミング', message: 'バグを修正して' },
                { name: 'レビュー対応', message: 'コードレビューをして' },
                { name: 'ドキュメント作成', message: 'ドキュメントを書いて' },
                { name: '会議参加', message: '会議に参加して' },
                { name: 'デバッグ作業', message: 'デバッグ作業をして' },
                { name: 'テストコード作成', message: 'テストを書いて' },
                { name: '技術調査', message: '新しい技術を調べて' },
                { name: 'モブプロ', message: 'モブプロに参加して' }
            ];

            const job = jobs[Math.floor(Math.random() * jobs.length)];
            const amount = Math.floor(Math.random() * (config.WORK_COIN_MAX - config.WORK_COIN_MIN + 1)) + config.WORK_COIN_MIN;
            
            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hset(`user:${mainAccountId}`, 'lastWork', now.toString());
            multi.hincrby(`user:${mainAccountId}`, 'balance', amount);
            await multi.exec();

            const newBalance = await redis.hget(`user:${mainAccountId}`, 'balance');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle(job.name)
                .setDescription(`${job.message}${amount.toLocaleString()}${config.COIN_NAME}を獲得しました！`)
                .addFields(
                    { name: '獲得', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '残高', value: `${config.COIN_SYMBOL} ${parseInt(newBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('労働エラー:', error);
            await interaction.editReply('労働中にエラーが発生しました。');
        }
    },
};
