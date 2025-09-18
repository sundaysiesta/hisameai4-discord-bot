const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const { sortClubChannels, getActivityIcon } = require('../utils/utility.js');
const config = require('../config.js');

// 現在の週間ランキング埋め込みを作成する関数
async function createCurrentRankingEmbeds(guild, redis) {
    try {
        let allClubChannels = [];
        
        // 全部活カテゴリーから部活チャンネルを取得（人気部活カテゴリも含む）
        const allCategories = [...config.CLUB_CATEGORIES, config.POPULAR_CLUB_CATEGORY_ID];
        for (const categoryId of allCategories) {
            const category = await guild.channels.fetch(categoryId).catch(() => null);
            if (category && category.type === ChannelType.GuildCategory) {
                const clubChannels = category.children.cache.filter(ch => 
                    !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                    ch.type === ChannelType.GuildText
                );
                allClubChannels.push(...clubChannels.values());
            }
        }
        
        if (allClubChannels.length === 0) return [];
        
        // アクティブ度（部員数 × メッセージ数）でランキングを作成
        let ranking = [];
        for (const channel of allClubChannels) {
            // 部員数（アクティブユーザー数）の計算（今週の開始＝JSTの日曜0時以降のみ）
            const getStartOfWeekUtcMs = () => {
                const now = new Date();
                const jstNowMs = now.getTime() + 9 * 60 * 60 * 1000;
                const jstNow = new Date(jstNowMs);
                const day = jstNow.getUTCDay();
                const diffDays = day;
                const jstStartMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - diffDays * 24 * 60 * 60 * 1000;
                return jstStartMs - 9 * 60 * 60 * 1000;
            };
            const sinceUtcMs = getStartOfWeekUtcMs();

            const messageCounts = new Map();
            let weeklyMessageCount = 0; // リアルタイムでメッセージ数をカウント
            let beforeId = undefined;
            let fetchedTotal = 0;
            const maxFetch = 500;
            while (fetchedTotal < maxFetch) {
                const batch = await channel.messages.fetch({ limit: Math.min(100, maxFetch - fetchedTotal), before: beforeId }).catch(() => null);
                if (!batch || batch.size === 0) break;
                for (const msg of batch.values()) {
                    if (msg.createdTimestamp < sinceUtcMs) { batch.clear(); break; }
                    if (!msg.author.bot) {
                        const count = messageCounts.get(msg.author.id) || 0;
                        messageCounts.set(msg.author.id, count + 1);
                        weeklyMessageCount++; // メッセージ数をカウント
                    }
                }
                fetchedTotal += batch.size;
                const last = batch.last();
                if (!last || last.createdTimestamp < sinceUtcMs) break;
                beforeId = last.id;
            }

            // 1回以上メッセージを送っているユーザーをカウント（=その週の部員定義）
            const activeMembers = Array.from(messageCounts.entries())
                .filter(([_, count]) => count >= 1)
                .map(([userId]) => userId);

            const activeMemberCount = activeMembers.length;
            const activityScore = activeMemberCount * weeklyMessageCount;
            
            // 前回のスコアを取得
            const previousScore = await redis.get(`previous_score:${channel.id}`) || 0;
            const previousScoreNum = Number(previousScore);
            
            // ポイントの増減を計算
            const pointChange = activityScore - previousScoreNum;
            
            // 今回のスコアを保存（次回用）
            await redis.setex(`previous_score:${channel.id}`, 7 * 24 * 60 * 60, activityScore.toString());
            
            ranking.push({ 
                id: channel.id, 
                name: channel.name,
                messageCount: weeklyMessageCount,
                activeMemberCount: activeMemberCount,
                activityScore: activityScore,
                pointChange: pointChange,
                position: channel.position
            });
        }
        
        // アクティブ度（部員数 × メッセージ数）でソート（同数の場合はチャンネル位置で安定化）
        ranking.sort((a, b) => {
            if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
            return a.position - b.position;
        });
        
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
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        
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
