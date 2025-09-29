const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { sortClubChannels, getActivityIcon } = require('../utils/utility.js');
const config = require('../config.js');

// 現在の週間ランキング埋め込みを作成する関数（共通計算関数を使用）
async function createCurrentRankingEmbeds(guild, redis) {
    try {
        // 共通の計算関数を使用（events/ready.jsからインポート）
        const { calculateWeeklyRanking } = require('../events/ready.js');
        const ranking = await calculateWeeklyRanking(guild, redis);
        if (ranking.length === 0) return [];
        
        // 全件をページ分割（1ページ最大20クラブ）
        const pageSize = 20;
        const numPages = Math.ceil(ranking.length / pageSize) || 1;
        const embeds = [];
        for (let page = 0; page < numPages; page++) {
            const start = page * pageSize;
            const end = Math.min(start + pageSize, ranking.length);
            let text = '';
            for (let i = start; i < end; i++) {
                const club = ranking[i];
                const place = i + 1;
                const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `${place}.`;
                
                // ポイント増減の表示
                let changeText = '';
                if (club.pointChange > 0) {
                    changeText = ` ↑+${club.pointChange}`;
                } else if (club.pointChange < 0) {
                    changeText = ` ↓${club.pointChange}`;
                }
                
                const activityIcon = getActivityIcon(club.activityScore);
                text += `${medal} <#${club.id}> — ${activityIcon}${club.activityScore}pt${changeText}\n`;
            }
            if (text.length === 0) text = 'データがありません';
            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle(`🏆 現在の週間ランキング (${page + 1}/${numPages})`)
                .setDescription('アクティブ度（部員数 × メッセージ数）に基づくランキングです\n（中間結果・週次リセット前）')
                .addFields({ name: '📈 ランキング', value: text, inline: false })
                .setTimestamp()
                .setFooter({ text: 'HisameAI Mark.4' });
            embeds.push(embed);
        }
        return embeds;
    } catch (error) {
        console.error('現在のランキング作成エラー:', error);
        return [];
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sort')
        .setDescription('部活チャンネルを現在のアクティブ順に手動で並び替えます。(管理者限定)'),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        try {
            // メモリ内のデータをRedisに反映してからソート
            if (global.dailyMessageBuffer) {
                for (const [channelId, count] of Object.entries(global.dailyMessageBuffer)) {
                    if (count > 0) {
                        try {
                            await redis.incrby(`weekly_message_count:${channelId}`, count);
                            global.dailyMessageBuffer[channelId] = 0; // 反映後はリセット
                        } catch (error) {
                            console.error(`Redis反映エラー for channel ${channelId}:`, error);
                        }
                    }
                }
            }
            
            // アーカイブ復活処理（アクティブポイントが復活した部活を部活カテゴリに戻す）
            const { autoReviveArchivedClubs, autoArchiveInactiveClubs } = require('../events/ready.js');
            await autoReviveArchivedClubs(interaction.guild, redis);
            
            // 自動廃部処理（アクティブポイント0の部活をアーカイブに移動）
            await autoArchiveInactiveClubs(interaction.guild, redis);
            
            // 部活チャンネルのソート実行
            await sortClubChannels(redis, interaction.guild);
            
            // 現在の週間ランキングを取得して表示
            const rankingEmbeds = await createCurrentRankingEmbeds(interaction.guild, redis);
            
            if (rankingEmbeds && rankingEmbeds.length > 0) {
                await interaction.editReply({ 
                    content: '部活チャンネルを現在のアクティブ順に並び替えました。\n\n**現在の週間ランキング（中間結果）:**', 
                    embeds: rankingEmbeds 
                });
            } else {
                await interaction.editReply('部活チャンネルを現在のアクティブ順に並び替えました。');
            }
        } catch (error) {
            console.error('sortコマンド実行エラー:', error);
            await interaction.editReply('ソート実行中にエラーが発生しました。');
        }
    },
};
