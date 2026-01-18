const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionsBitField, ChannelType } = require('discord.js');
const config = require('../config.js');
const { calculateWeeklyActivity } = require('../utils/utility.js');

// ready.jsからcalculateWeeklyRankingをインポート（利用可能な場合）
let calculateWeeklyRanking;
try {
    const readyModule = require('../events/ready.js');
    if (readyModule.calculateWeeklyRanking) {
        calculateWeeklyRanking = readyModule.calculateWeeklyRanking;
    }
} catch (e) {
    // インポートできない場合は後で実装
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testmaintenance')
        .setDescription('賞金支払いの処理をテストします（ドライラン）。(管理者限定)'),
    async execute(interaction, redis) {
        const ALLOWED_ROLE_ID = '1449784235102703667';
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasAllowedRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);
        
        if (!isAdmin && !hasAllowedRole) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        try {
            const guild = interaction.guild;
            
            // メモリ内のデータをRedisに反映してから計算（sortコマンドと同じ処理）
            if (global.dailyMessageBuffer) {
                let reflectedCount = 0;
                for (const [channelId, count] of Object.entries(global.dailyMessageBuffer)) {
                    if (count > 0) {
                        try {
                            await redis.incrby(`weekly_message_count:${channelId}`, count);
                            reflectedCount += count;
                            // sortコマンドと同じく反映後にリセット（日次バッチでの重複を防ぐ）
                            global.dailyMessageBuffer[channelId] = 0;
                        } catch (error) {
                            console.error(`Redis反映エラー for channel ${channelId}:`, error);
                        }
                    }
                }
                if (reflectedCount > 0) {
                    console.log(`[テスト賞金] メモリ内のデータをRedisに反映しました: ${reflectedCount}件`);
                }
            }
            
            // ランキング計算
            let ranking;
            if (calculateWeeklyRanking) {
                ranking = await calculateWeeklyRanking(guild, redis);
            } else {
                // ready.jsと同じロジックを実装
                let allClubChannels = [];
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
                
                if (allClubChannels.length === 0) {
                    return interaction.editReply({ content: '部活が見つかりませんでした。' });
                }
                
                ranking = [];
                for (const channel of allClubChannels) {
                    const activity = await calculateWeeklyActivity(channel, redis);
                    const previousScore = await redis.get(`previous_score:${channel.id}`) || 0;
                    const previousScoreNum = Number(previousScore);
                    const pointChange = activity.activityScore - previousScoreNum;
                    
                    ranking.push({ 
                        id: channel.id, 
                        name: channel.name,
                        messageCount: activity.weeklyMessageCount,
                        activeMemberCount: activity.activeMemberCount,
                        activityScore: activity.activityScore,
                        pointChange: pointChange,
                        position: channel.position
                    });
                }
                
                ranking.sort((a, b) => {
                    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
                    return a.position - b.position;
                });
            }
            
            if (!ranking || ranking.length === 0) {
                return interaction.editReply({ content: '部活が見つかりませんでした。' });
            }
            
            const top5 = ranking.slice(0, 5);
            const clubsToArchive = [];
            const rewardTargets = [];
            const errors = [];
            
            // 全部活を処理
            for (let i = 0; i < ranking.length; i++) {
                const club = ranking[i];
                const channel = await guild.channels.fetch(club.id).catch(() => null);
                if (!channel) {
                    errors.push(`チャンネル ${club.id} が見つかりません`);
                    continue;
                }
                
                // 部長を取得
                const leaderUserId = await redis.get(`leader_user:${channel.id}`);
                if (!leaderUserId) {
                    clubsToArchive.push({ channel: channel.name, reason: '部長不在' });
                    continue;
                }
                
                // 部長がサーバーに存在するか確認
                const leaderMember = await guild.members.fetch(leaderUserId).catch(() => null);
                if (!leaderMember) {
                    clubsToArchive.push({ channel: channel.name, reason: '部長退会' });
                    continue;
                }
                
                // ロメコイン残高を確認（実際にはAPIを呼ばず、設定を確認）
                if (!config.CROSSROID_API_URL || !config.CROSSROID_API_TOKEN) {
                    errors.push('CROSSROID_API_URLまたはCROSSROID_API_TOKENが設定されていません');
                    continue;
                }
                
                // API接続テスト（実際の残高取得は行わない）
                let balanceCheck = '確認可能';
                try {
                    // 接続テストのみ（実際の残高は取得しない）
                    const testUrl = `${config.CROSSROID_API_URL}/api/romecoin/${leaderUserId}`;
                    // 実際には呼ばないが、URLが正しいか確認
                    if (!testUrl.startsWith('http')) {
                        balanceCheck = 'URL形式エラー';
                        errors.push(`部活「${channel.name}」: API URL形式エラー`);
                    }
                } catch (e) {
                    balanceCheck = '接続エラー';
                    errors.push(`部活「${channel.name}」: ${e.message}`);
                }
                
                // TOP5の場合は賞金対象（賞金システムは削除済み）
                // const isTop5 = top5.some(top => top.id === club.id);
                // const rankIndex = top5.findIndex(top => top.id === club.id);
                // 
                // if (isTop5 && rankIndex !== -1) {
                //     const rewardAmount = config.CLUB_TOP5_REWARDS?.[rankIndex] || 0;
                //     rewardTargets.push({
                //         channel: channel.name,
                //         rank: rankIndex + 1,
                //         leader: leaderMember.user.username,
                //         leaderId: leaderUserId,
                //         amount: rewardAmount,
                //         balanceCheck: balanceCheck
                //     });
                // }
            }
            
            // 結果をEmbedで表示
            const embeds = [];
            
            // 概要
            const summaryEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🧪 賞金処理テスト結果（ドライラン）')
                .setDescription('実際の処理は行いませんでした。以下の結果はシミュレーションです。')
                .addFields(
                    { name: '📊 統計', value: `総部活数: ${ranking.length}\n賞金支払い対象: ${rewardTargets.length}\n廃部対象: ${clubsToArchive.length}`, inline: false },
                    { name: '⚙️ 設定', value: `API URL: ${config.CROSSROID_API_URL ? '設定済み' : '未設定'}\nAPI Token: ${config.CROSSROID_API_TOKEN ? '設定済み' : '未設定'}`, inline: false }
                )
                .setTimestamp();
            
            embeds.push(summaryEmbed);
            
            // TOP5賞金対象
            if (rewardTargets.length > 0) {
                let rewardText = '';
                for (const target of rewardTargets) {
                    rewardText += `${target.rank}位: **${target.channel}**\n`;
                    rewardText += `  部長: ${target.leader} (${target.leaderId})\n`;
                    rewardText += `  賞金: <:romecoin2:1452874868415791236> ${target.amount.toLocaleString()}\n`;
                    rewardText += `  残高確認: ${target.balanceCheck}\n\n`;
                }
                
                const rewardEmbed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏆 TOP5賞金支払い対象')
                    .setDescription(rewardText)
                    .setTimestamp();
                
                embeds.push(rewardEmbed);
            }
            
            // 廃部対象
            if (clubsToArchive.length > 0) {
                let archiveText = '';
                for (const club of clubsToArchive) {
                    archiveText += `**${club.channel}**\n`;
                    archiveText += `  理由: ${club.reason}\n\n`;
                }
                
                const archiveEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🗑️ 廃部対象')
                    .setDescription(archiveText)
                    .setTimestamp();
                
                embeds.push(archiveEmbed);
            }
            
            // エラー
            if (errors.length > 0) {
                let errorText = errors.slice(0, 10).join('\n');
                if (errors.length > 10) {
                    errorText += `\n...他 ${errors.length - 10}件のエラー`;
                }
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF6B6B)
                    .setTitle('⚠️ エラー・警告')
                    .setDescription(errorText)
                    .setTimestamp();
                
                embeds.push(errorEmbed);
            }
            
            await interaction.editReply({ embeds: embeds });
            
        } catch (error) {
            console.error('Test maintenance error:', error);
            await interaction.editReply({ content: `テスト実行中にエラーが発生しました: ${error.message}` });
        }
    },
};

