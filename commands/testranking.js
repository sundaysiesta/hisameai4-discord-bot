const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const { calculateWeeklyActivity, getActivityIcon } = require('../utils/utility.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testranking')
        .setDescription('部活ランキングの計算式とソート処理をテスト表示します。(管理者限定)')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('表示する部活の数（デフォルト: 20）')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(100)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: 'このコマンドを使用する権限がありません。', 
                flags: [MessageFlags.Ephemeral] 
            });
        }
        
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        try {
            const limit = interaction.options.getInteger('limit') || 20;
            
            // メモリ内のデータをRedisに反映してから計算（sortコマンドと同じ処理）
            // メモリ内のデータを保存（表示用）
            const memoryBufferSnapshot = global.dailyMessageBuffer ? { ...global.dailyMessageBuffer } : {};
            
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
                    console.log(`[テストランキング] メモリ内のデータをRedisに反映しました: ${reflectedCount}件`);
                }
            }
            
            // 全部活チャンネルを取得
            let allClubChannels = [];
            const allCategories = [...config.CLUB_CATEGORIES, config.POPULAR_CLUB_CATEGORY_ID];
            
            for (const categoryId of allCategories) {
                const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);
                if (category && category.type === ChannelType.GuildCategory) {
                    const clubChannels = category.children.cache.filter(ch => 
                        !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                        ch.type === ChannelType.GuildText
                    );
                    allClubChannels.push(...clubChannels.values());
                }
            }
            
            if (allClubChannels.length === 0) {
                return interaction.editReply('部活チャンネルが見つかりませんでした。');
            }
            
            // ランキング計算（詳細情報付き）
            let ranking = [];
            for (const channel of allClubChannels) {
                const activity = await calculateWeeklyActivity(channel, redis);
                
                // 前回のスコアを取得
                const previousScore = await redis.get(`previous_score:${channel.id}`) || 0;
                const previousScoreNum = Number(previousScore);
                const pointChange = activity.activityScore - previousScoreNum;
                
                // 現在のチャンネル名を解析
                const currentName = channel.name;
                const scorePattern = /[🔥⚡🌱・]\d+$/;
                const baseName = currentName.replace(scorePattern, '');
                const activityIcon = getActivityIcon(activity.activityScore);
                const newName = `${baseName}${activityIcon}${activity.activityScore}`;
                
                // メモリ内のデータも取得（表示用）
                const memoryCount = memoryBufferSnapshot[channel.id] || 0;
                
                ranking.push({
                    id: channel.id,
                    name: channel.name,
                    baseName: baseName,
                    newName: newName,
                    messageCount: activity.weeklyMessageCount,
                    activeMemberCount: activity.activeMemberCount,
                    activityScore: activity.activityScore,
                    pointChange: pointChange,
                    position: channel.position,
                    categoryId: channel.parentId,
                    categoryName: channel.parent?.name || '不明',
                    activeMembers: activity.activeMembers,
                    memoryCount: memoryCount // メモリ内のカウント（反映前）
                });
            }
            
            // ソート処理（実際のソートロジックと同じ）
            ranking.sort((a, b) => {
                if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
                return a.position - b.position;
            });
            
            // カテゴリ配置の計算（実際のロジックと同じ）
            const maxChannelsPerCategory = 50;
            const topChannelOffset = 2;
            
            for (let i = 0; i < ranking.length; i++) {
                const club = ranking[i];
                let targetCategoryId;
                let positionInCategory;
                
                if (i < 5) {
                    targetCategoryId = config.POPULAR_CLUB_CATEGORY_ID;
                    positionInCategory = i;
                } else {
                    const adjustedIndex = i - 5;
                    if (adjustedIndex < maxChannelsPerCategory - topChannelOffset) {
                        targetCategoryId = config.CLUB_CATEGORIES[0];
                        positionInCategory = adjustedIndex + topChannelOffset;
                    } else {
                        const categoryIndex = Math.floor((adjustedIndex - (maxChannelsPerCategory - topChannelOffset)) / (maxChannelsPerCategory - topChannelOffset)) + 1;
                        if (categoryIndex < config.CLUB_CATEGORIES.length) {
                            targetCategoryId = config.CLUB_CATEGORIES[categoryIndex];
                            positionInCategory = (adjustedIndex - (maxChannelsPerCategory - topChannelOffset)) % (maxChannelsPerCategory - topChannelOffset) + topChannelOffset;
                        } else {
                            targetCategoryId = config.CLUB_CATEGORIES[config.CLUB_CATEGORIES.length - 1];
                            positionInCategory = adjustedIndex + topChannelOffset;
                        }
                    }
                }
                
                club.targetCategoryId = targetCategoryId;
                club.positionInCategory = positionInCategory;
                
                // カテゴリ名を取得
                const targetCategory = await interaction.guild.channels.fetch(targetCategoryId).catch(() => null);
                club.targetCategoryName = targetCategory?.name || '不明';
            }
            
            // 表示用のデータを準備
            const displayRanking = ranking.slice(0, limit);
            
            // 計算式の説明
            const formulaText = `**アクティブ度 = アクティブ部員数 × 週間メッセージ数**
            
**計算例:**
- アクティブ部員数: 5人
- 週間メッセージ数: 100件
- アクティブ度 = 5 × 100 = **500pt**

**アイコン表示:**
- 🔥: 10,000pt以上
- ⚡: 1,000pt以上
- 🌱: 100pt以上
- ・: 100pt未満

**📝 メモリ内データについて:**
メッセージ数はメモリ内でカウントされ、30分ごと（毎時0分と30分）にRedisに反映されます。
テストコマンド実行時は、メモリ内のデータもRedisに反映してから計算しています。
（メモリ内のカウントが表示されている場合は、反映前の状態です）`;

            // ランキング詳細
            let rankingText = '';
            for (let i = 0; i < displayRanking.length; i++) {
                const club = displayRanking[i];
                const rank = i + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
                
                const changeText = club.pointChange > 0 
                    ? ` ↑+${club.pointChange}` 
                    : club.pointChange < 0 
                        ? ` ↓${club.pointChange}` 
                        : '';
                
                const categoryChange = club.categoryId !== club.targetCategoryId 
                    ? `\n  📍 カテゴリ移動: ${club.categoryName} → ${club.targetCategoryName}` 
                    : '';
                
                const positionChange = club.position !== club.positionInCategory 
                    ? `\n  📌 位置変更: ${club.position} → ${club.positionInCategory}` 
                    : '';
                
                const nameChange = club.name !== club.newName 
                    ? `\n  ✏️ 名前変更: \`${club.name}\` → \`${club.newName}\`` 
                    : '';
                
                rankingText += `${medal} <#${club.id}>\n`;
                rankingText += `  📊 アクティブ度: ${getActivityIcon(club.activityScore)}${club.activityScore}pt${changeText}\n`;
                rankingText += `  👥 アクティブ部員数: ${club.activeMemberCount}人\n`;
                rankingText += `  💬 週間メッセージ数: ${club.messageCount}件`;
                if (club.memoryCount > 0) {
                    rankingText += ` (メモリ内: +${club.memoryCount}件)`;
                }
                rankingText += `\n`;
                rankingText += `  🧮 計算式: ${club.activeMemberCount} × ${club.messageCount} = ${club.activityScore}pt\n`;
                if (categoryChange) rankingText += categoryChange;
                if (positionChange) rankingText += positionChange;
                if (nameChange) rankingText += nameChange;
                rankingText += `\n`;
            }
            
            // ソート処理の説明
            const sortInfoText = `**ソート処理の詳細:**

1. **ソート順序:**
   - アクティブ度（降順）
   - 同点の場合はチャンネル位置（昇順）で安定化

2. **カテゴリ配置:**
   - 1-5位: 人気部活カテゴリ（位置 0-4）
   - 6位以降: 部室棟カテゴリ（位置 2から開始）
   - カテゴリが50個で上限の場合は次のカテゴリへ

3. **名前変更処理:**
   - 既存のスコア部分（🔥⚡🌱・のパターン）を検出して除去
   - 新しいスコアとアイコンを追加
   - 例: \`⚽｜サッカー部🔥1000\` → \`⚽｜サッカー部⚡500\``;

            // 埋め込みメッセージを作成
            const embeds = [];
            
            // 計算式の説明
            embeds.push(new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📐 ランキング計算式')
                .setDescription(formulaText)
                .setTimestamp()
                .setFooter({ text: 'HisameAI Mark.4 - テストモード' }));
            
            // ランキング詳細
            if (rankingText.length > 4000) {
                // 長すぎる場合は分割
                const parts = rankingText.match(/[\s\S]{1,4000}(?=\n|$)/g) || [];
                for (let i = 0; i < parts.length; i++) {
                    embeds.push(new EmbedBuilder()
                        .setColor(0xFFD700)
                        .setTitle(`🏆 ランキング詳細 (${i + 1}/${parts.length})`)
                        .setDescription(parts[i])
                        .setTimestamp()
                        .setFooter({ text: `表示: ${displayRanking.length}/${ranking.length}件` }));
                }
            } else {
                embeds.push(new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏆 ランキング詳細')
                    .setDescription(rankingText || 'データがありません')
                    .setTimestamp()
                    .setFooter({ text: `表示: ${displayRanking.length}/${ranking.length}件` }));
            }
            
            // ソート処理の説明
            embeds.push(new EmbedBuilder()
                .setColor(0x4CAF50)
                .setTitle('🔄 ソート処理の詳細')
                .setDescription(sortInfoText)
                .setTimestamp()
                .setFooter({ text: 'HisameAI Mark.4 - テストモード' }));
            
            await interaction.editReply({ embeds: embeds });
            
        } catch (error) {
            console.error('Test ranking error:', error);
            await interaction.editReply('ランキングテストの実行中にエラーが発生しました。');
        }
    },
};

