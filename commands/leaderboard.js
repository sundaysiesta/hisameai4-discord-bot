const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const { getAllKeys } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('所持金ランキングを表示します'),
    async execute(interaction, redis) {
        await interaction.deferReply();
        
        try {
            // すべてのユーザーのコイン残高を取得
            const userKeys = await getAllKeys(redis, 'user:*');
            const balances = [];
            
            for (const key of userKeys) {
                const userId = key.split(':')[1];
                // mainAccountIdを確認
                const mainAccountId = await redis.hget(key, 'mainAccountId');
                if (!mainAccountId || mainAccountId === userId) {  // メインアカウントのみを集計
                    const balance = await redis.hget(key, 'balance');
                    if (balance) {
                        try {
                            const user = await interaction.client.users.fetch(userId);
                            balances.push({
                                userId,
                                username: user.username,
                                balance: parseInt(balance)
                            });
                        } catch (error) {
                            console.error(`ユーザー取得エラー (${userId}):`, error);
                        }
                    }
                }
            }

            // 残高で降順ソート
            balances.sort((a, b) => b.balance - a.balance);

            // トップ10を抽出
            const top10 = balances.slice(0, 10);

            // 現在のユーザーのランキングを検索
            const userRank = balances.findIndex(b => b.userId === interaction.user.id) + 1;
            const userBalance = balances.find(b => b.userId === interaction.user.id)?.balance || 0;

            const embed = new EmbedBuilder()
                .setColor('#ffd700')
                .setTitle('ロメコインランキング')
                .setDescription('全サーバーの所持金ランキング')
                .setTimestamp();

            // トップ10のリストを作成
            let description = '';
            top10.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                description += `${medal} **${user.username}**\n${config.COIN_SYMBOL} ${user.balance.toLocaleString()} ${config.COIN_NAME}\n\n`;
            });

            embed.setDescription(description);

            // ユーザー自身のランキング情報を追加
            if (userRank > 0) {
                embed.addFields({
                    name: 'あなたのランキング',
                    value: `${userRank}位\n${config.COIN_SYMBOL} ${userBalance.toLocaleString()} ${config.COIN_NAME}`
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('ランキング表示エラー:', error);
            await interaction.editReply('ランキングの表示中にエラーが発生しました。');
        }
    },
};
