const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ActivityType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels, safeIncrby, getAllKeys, getActivityIcon } = require('../utils/utility.js');

/**
 * 【新規追加】GitHub APIから最新のコミット情報を取得する関数
 * @returns {Promise<object|null>} コミット情報 (sha, message, url) または null
 */
async function getLatestCommitInfo() {
  try {
    const repo = 'sundaysiesta/hisameai4-discord-bot';
    const branch = 'main';
    const url = `https://api.github.com/repos/${repo}/commits/${branch}`;
    
    // Node.js v18以降に標準搭載されているfetchを使用
    const response = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'HisameAI-Discord-Bot' }
    });
    
    if (!response.ok) {
      console.error(`GitHub API Error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const commitData = await response.json();
    return {
      sha: commitData.sha,
      // コミットメッセージの1行目のみを取得
      message: commitData.commit.message.split('\n')[0],
      url: commitData.html_url
    };
  } catch (error) {
    console.error('Failed to fetch latest commit info from GitHub:', error);
    return null;
  }
}

// グローバル変数のクリーンアップ関数
function cleanupGlobalVariables() {
    const now = Date.now();
    
    // 匿名投稿クールダウンのクリーンアップ
    if (global.anonymousCooldown) {
        for (const [userId, timestamp] of Object.entries(global.anonymousCooldown)) {
            if (now - timestamp > config.ANONYMOUS_COOLDOWN_EXPIRY) {
                delete global.anonymousCooldown[userId];
            }
        }
    }
    
    // 代理投稿削除マップのクリーンアップ
    if (global.proxyDeleteMap) {
        for (const [messageId, timestamp] of Object.entries(global.proxyDeleteMap)) {
            if (now - timestamp > config.PROXY_DELETE_MAP_EXPIRY) {
                delete global.proxyDeleteMap[messageId];
            }
        }
    }
    
    // メンション機能クールダウンのクリーンアップ（24時間以上古いデータ）
    if (global.mentionCooldown) {
        const oneDay = 24 * 60 * 60 * 1000;
        for (const [userId, timestamp] of Object.entries(global.mentionCooldown)) {
            if (now - timestamp > oneDay) {
                delete global.mentionCooldown[userId];
            }
        }
    }
    
    // メンション機能説明表示クールダウンのクリーンアップ（1時間以上古いデータ）
    if (global.mentionHelpCooldown) {
        const oneHour = 60 * 60 * 1000;
        for (const [guildId, timestamp] of Object.entries(global.mentionHelpCooldown)) {
            if (now - timestamp > oneHour) {
                delete global.mentionHelpCooldown[guildId];
            }
        }
    }
    
    // 日次メッセージバッファのクリーンアップ（不要 - 日次バッチで0にリセットされる）
    // dailyMessageBufferはカウント数（数値）を保存しているため、タイムスタンプベースのクリーンアップは適用しない
    
    console.log('グローバル変数のクリーンアップを実行しました');
}

// 共通の週間ランキング計算関数（統一ロジック）
async function calculateWeeklyRanking(guild, redis) {
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
        
        // 共通の週間アクティブ度計算関数を使用
        const { calculateWeeklyActivity } = require('../utils/utility.js');
        
        // アクティブ度（部員数 × メッセージ数）でランキングを作成
        let ranking = [];
        for (const channel of allClubChannels) {
            // 共通の週間アクティブ度計算関数を使用
            const activity = await calculateWeeklyActivity(channel, redis);
            
            // 前回のスコアを取得
            const previousScore = await redis.get(`previous_score:${channel.id}`) || 0;
            const previousScoreNum = Number(previousScore);
            
            // ポイントの増減を計算
            const pointChange = activity.activityScore - previousScoreNum;
            
            // 今回のスコアを保存（次回用）
            await redis.setex(`previous_score:${channel.id}`, 7 * 24 * 60 * 60, activity.activityScore.toString());
            
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
        
        // アクティブ度（部員数 × メッセージ数）でソート（同数の場合はチャンネル位置で安定化）
        ranking.sort((a, b) => {
            if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
            return a.position - b.position;
        });
        
        return ranking;
    } catch (error) {
        console.error('週間ランキング計算エラー:', error);
        return [];
    }
}

// 全部活の週間ランキング埋め込み（複数ページ対応）を作成する関数
async function createWeeklyRankingEmbeds(client, redis) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return [];

        // 共通の計算関数を使用
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
                .setTitle(`🏆 週間部活ランキング (${page + 1}/${numPages})`)
                .setDescription('アクティブ度（部員数 × メッセージ数）に基づくランキングです\n（日曜0時に更新）')
                .addFields({ name: '📈 ランキング', value: text, inline: false })
                .setTimestamp()
                .setFooter({ text: 'HisameAI Mark.4' });
            embeds.push(embed);
        }
        return embeds;
    } catch (error) {
        console.error('週間ランキング作成エラー:', error);
        return [];
    }
}

// アーカイブから復活する機能：アクティブポイントが0より大きい部活を部活カテゴリに戻す
async function autoReviveArchivedClubs(guild, redis) {
    try {
        console.log('アーカイブ復活処理を開始します...');
        
        // アーカイブカテゴリから部活チャンネルを取得
        const archiveCategories = [config.ARCHIVE_CATEGORY_ID, config.ARCHIVE_OVERFLOW_CATEGORY_ID];
        let archivedClubChannels = [];
        
        for (const categoryId of archiveCategories) {
            const category = await guild.channels.fetch(categoryId).catch(() => null);
            if (category && category.type === ChannelType.GuildCategory) {
                const clubChannels = category.children.cache.filter(ch => 
                    !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                    ch.type === ChannelType.GuildText
                );
                archivedClubChannels.push(...clubChannels.values());
            }
        }
        
        if (archivedClubChannels.length === 0) {
            console.log('復活対象の部活はありません');
            return;
        }
        
        // 各チャンネルのアクティブポイントを計算
        const channelsToRevive = [];
        for (const channel of archivedClubChannels) {
            // 共通の週間アクティブ度計算関数を使用
            const activity = await calculateWeeklyActivity(channel, redis);
            
            // 厳格な復活条件をチェック
            const meetsRevivalConditions = 
                activity.activityScore >= config.REVIVAL_MIN_ACTIVITY_SCORE &&
                activity.activeMemberCount >= config.REVIVAL_MIN_ACTIVE_MEMBERS &&
                activity.weeklyMessageCount >= config.REVIVAL_MIN_MESSAGE_COUNT;
            
            if (meetsRevivalConditions) {
                channelsToRevive.push({ 
                    channel, 
                    activityScore: activity.activityScore, 
                    activeMemberCount: activity.activeMemberCount, 
                    weeklyMessageCount: activity.weeklyMessageCount 
                });
            }
        }
        
        if (channelsToRevive.length === 0) {
            console.log('復活対象の部活はありません');
            return;
        }
        
        console.log(`${channelsToRevive.length}個の部活を復活処理します`);
        
        // 人気部活カテゴリを取得（復活先）
        const popularCategory = await guild.channels.fetch(config.POPULAR_CLUB_CATEGORY_ID).catch(() => null);
        
        if (!popularCategory) {
            console.error('人気部活カテゴリが見つかりません');
            return;
        }
        
        for (const { channel, activityScore, activeMemberCount, weeklyMessageCount } of channelsToRevive) {
            try {
                // チャンネルを人気部活カテゴリに移動
                await channel.setParent(popularCategory, { 
                    lockPermissions: false,
                    reason: '自動復活処理（アクティブポイント復活）'
                });
                
                // 部長権限を復元
                try {
                    let leaderUserId = await redis.get(`leader_user:${channel.id}`);
                    
                    // Redisに部長情報がない場合は、Notionから取得を試行
                    if (!leaderUserId) {
                        console.log(`部活「${channel.name}」の部長情報をNotionから取得を試行します`);
                        // Notionから部長情報を取得する処理は複雑なため、ここではスキップ
                        // 必要に応じて後で実装
                    }
                    
                    if (leaderUserId) {
                        // 部長権限を復元
                        await channel.permissionOverwrites.edit(leaderUserId, {
                            ViewChannel: true,
                            ManageMessages: true,
                            ManageRoles: true
                        }, { reason: '復活時の部長権限復元' });
                        console.log(`部活「${channel.name}」の部長権限を復元しました（ユーザーID: ${leaderUserId}）`);
                    } else {
                        console.log(`部活「${channel.name}」の部長情報が見つかりません。手動で部長を設定してください。`);
                    }
                } catch (permissionError) {
                    console.error(`部活「${channel.name}」の部長権限復元エラー:`, permissionError);
                }
                
                // 復活通知の埋め込みメッセージを送信
                try {
                    const revivalEmbed = new EmbedBuilder()
                        .setColor(0x4CAF50) // 緑色
                        .setTitle('🎉 部活が復活しました！')
                        .setDescription('この部活はアクティブポイントが復活したため、部活カテゴリに戻りました。')
                        .addFields(
                            { 
                                name: '📊 復活理由', 
                                value: `週間アクティブポイント: ${activityScore}pt\nアクティブ部員数: ${activeMemberCount}人\n週間メッセージ数: ${weeklyMessageCount}件`, 
                                inline: false 
                            },
                            { 
                                name: '✅ 復活条件', 
                                value: `• アクティブポイント: ${activityScore}pt ≥ ${config.REVIVAL_MIN_ACTIVITY_SCORE}pt\n• アクティブ部員数: ${activeMemberCount}人 ≥ ${config.REVIVAL_MIN_ACTIVE_MEMBERS}人\n• メッセージ数: ${weeklyMessageCount}件 ≥ ${config.REVIVAL_MIN_MESSAGE_COUNT}件`, 
                                inline: false 
                            },
                            { 
                                name: '👑 部長権限', 
                                value: '部長の権限が自動的に復元されました', 
                                inline: true 
                            },
                            { 
                                name: '📍 現在の場所', 
                                value: `カテゴリ: ${popularCategory.name}`, 
                                inline: true 
                            },
                            { 
                                name: '📅 次回チェック', 
                                value: '毎週土曜日23:45に自動チェックされます', 
                                inline: true 
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'HisameAI Mark.4 - 自動復活システム' });
                    
                    await channel.send({ embeds: [revivalEmbed] });
                } catch (embedError) {
                    console.error(`復活通知メッセージ送信エラー for ${channel.name}:`, embedError);
                }
                
                console.log(`部活「${channel.name}」を復活させました（${activityScore}pt）`);
                
            } catch (error) {
                console.error(`部活「${channel.name}」の復活処理でエラー:`, error);
            }
        }
        
        console.log('アーカイブ復活処理が完了しました');
        
    } catch (error) {
        console.error('アーカイブ復活処理エラー:', error);
    }
}

// 自動廃部機能：アクティブポイント0の部活をアーカイブに移動
async function autoArchiveInactiveClubs(guild, redis) {
    try {
        console.log('自動廃部処理を開始します...');
        
        // 全部活チャンネルを取得
        let allClubChannels = [];
        const allCategories = [...config.CLUB_CATEGORIES, config.POPULAR_CLUB_CATEGORY_ID, config.INACTIVE_CLUB_CATEGORY_ID];
        
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
        
        if (allClubChannels.length === 0) return;
        
        // 各チャンネルのアクティブポイントを計算
        const channelsToArchive = [];
        for (const channel of allClubChannels) {
            // 共通の週間アクティブ度計算関数を使用
            const activity = await calculateWeeklyActivity(channel, redis);
            
            // アクティブポイントが0の場合は廃部対象
            if (activity.activityScore === 0) {
                channelsToArchive.push(channel);
            }
        }
        
        if (channelsToArchive.length === 0) {
            console.log('廃部対象の部活はありません');
            return;
        }
        
        console.log(`${channelsToArchive.length}個の部活を廃部処理します`);
        
        // アーカイブカテゴリを取得
        const archiveCategory = await guild.channels.fetch(config.ARCHIVE_CATEGORY_ID).catch(() => null);
        const archiveOverflowCategory = await guild.channels.fetch(config.ARCHIVE_OVERFLOW_CATEGORY_ID).catch(() => null);
        
        if (!archiveCategory || !archiveOverflowCategory) {
            console.error('アーカイブカテゴリが見つかりません');
            return;
        }
        
        // アーカイブカテゴリの現在のチャンネル数を確認
        const currentArchiveChannels = archiveCategory.children.cache.filter(ch => ch.type === ChannelType.GuildText).size;
        const maxArchiveChannels = 50;
        
        for (const channel of channelsToArchive) {
            try {
                // アーカイブカテゴリが50個を超える場合はオーバーフローカテゴリに移動
                const targetCategory = currentArchiveChannels >= maxArchiveChannels ? archiveOverflowCategory : archiveCategory;
                
                // アーカイブカテゴリの権限を取得して同期
                const archivePermissions = targetCategory.permissionOverwrites.cache;
                
                // チャンネルの権限をアーカイブカテゴリに合わせて設定
                const newPermissions = [];
                for (const [id, permission] of archivePermissions) {
                    newPermissions.push({
                        id: id,
                        allow: permission.allow,
                        deny: permission.deny,
                        type: permission.type
                    });
                }
                
                // チャンネルをアーカイブカテゴリに移動
                await channel.setParent(targetCategory, { 
                    lockPermissions: false,
                    reason: '自動廃部処理（アクティブポイント0）'
                });
                
                // 権限を同期
                await channel.permissionOverwrites.set(newPermissions, 'アーカイブカテゴリの権限同期');
                
                // 廃部通知の埋め込みメッセージを送信
                try {
                    const archiveEmbed = new EmbedBuilder()
                        .setColor(0xFF6B6B) // 赤色
                        .setTitle('📦 部活がアーカイブされました')
                        .setDescription('この部活は週間アクティブポイントが0のため、自動的にアーカイブされました。')
                        .addFields(
                            { 
                                name: '📊 廃部理由', 
                                value: '週間アクティブポイント: 0pt\n（アクティブ部員数 × 週間メッセージ数 = 0）', 
                                inline: false 
                            },
                            { 
                                name: '🔄 復活方法', 
                                value: `以下の条件をすべて満たす必要があります：\n• アクティブポイント: ${config.REVIVAL_MIN_ACTIVITY_SCORE}pt以上\n• アクティブ部員数: ${config.REVIVAL_MIN_ACTIVE_MEMBERS}人以上\n• 週間メッセージ数: ${config.REVIVAL_MIN_MESSAGE_COUNT}件以上`, 
                                inline: false 
                            },
                            { 
                                name: '📅 次回チェック', 
                                value: '毎週土曜日23:45に自動チェックされます', 
                                inline: true 
                            },
                            { 
                                name: '📍 現在の場所', 
                                value: `カテゴリ: ${targetCategory.name}`, 
                                inline: true 
                            }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'HisameAI Mark.4 - 自動廃部システム' });
                    
                    await channel.send({ embeds: [archiveEmbed] });
                } catch (embedError) {
                    console.error(`廃部通知メッセージ送信エラー for ${channel.name}:`, embedError);
                }
                
                console.log(`部活「${channel.name}」をアーカイブに移動しました`);
                
                // カウンターを更新
                if (targetCategory.id === config.ARCHIVE_CATEGORY_ID) {
                    currentArchiveChannels++;
                }
                
            } catch (error) {
                console.error(`部活「${channel.name}」のアーカイブ処理でエラー:`, error);
            }
        }
        
        console.log('自動廃部処理が完了しました');
        
    } catch (error) {
        console.error('自動廃部処理エラー:', error);
    }
}

// 部活チャンネルのソートのみを実行する関数（ランキング表示なし）
async function sortClubChannelsOnly(guild, redis) {
    try {
        // メモリ内のデータをRedisに反映してからソート（/sortコマンドと同じ処理）
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
        await sortClubChannels(redis, guild);
        console.log('部活チャンネルのソートを実行しました');
    } catch (error) {
        console.error('部活チャンネルソートエラー:', error);
    }
}

// グローバル: 部活チャンネルごとのメッセージ数をメモリ内でカウント
if (!global.dailyMessageBuffer) global.dailyMessageBuffer = {};
const dailyMessageBuffer = global.dailyMessageBuffer;

// 共通の計算関数をexport
module.exports = {
    calculateWeeklyRanking,
    autoArchiveInactiveClubs,
    autoReviveArchivedClubs,
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`Logged in as ${client.user.tag}!`);
        client.redis = redis; 

        // メモリ使用量の監視を追加
        let lastLogTime = 0;
        setInterval(() => {
            const now = Date.now();
            if (now - lastLogTime >= 5 * 60 * 1000) { // 5分以上経過している場合のみ
                const used = process.memoryUsage();
                if (used.heapUsed > 500 * 1024 * 1024) { // 500MB以上使用している場合のみ
                    console.log(`High memory usage: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
                }
                lastLogTime = now;
            }
        }, 60 * 1000); // 1分ごとにチェック

        // 定期的なメモリクリーンアップ
        setInterval(cleanupGlobalVariables, config.MEMORY_CLEANUP_INTERVAL);

        try {
            const savedStatus = await redis.get('bot_status_text');
            if (savedStatus) client.user.setActivity(savedStatus, { type: ActivityType.Playing });

            // 【ここから修正】
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) {
                // GitHub APIから最新のコミット情報を取得
                const commitInfo = await getLatestCommitInfo();
                
                const embed = new EmbedBuilder()
                    .setTitle('🤖 再起動しました。確認してください。')
                    .setColor(0x3498DB)
                    .setTimestamp();
                
                if (commitInfo) {
                    // 取得した情報をEmbedに追加
                    embed.addFields(
                        { 
                            name: '現在のバージョン', 
                            value: `[${commitInfo.sha.substring(0, 7)}](${commitInfo.url})` 
                        },
                        {
                            name: '最新の変更内容',
                            value: `\`\`\`${commitInfo.message}\`\`\``
                        }
                    );
                } else {
                    // 取得に失敗した場合
                    embed.addFields({ name: 'バージョン情報', value: '取得に失敗しました。' });
                }

                await notificationChannel.send({ embeds: [embed] });
            }
            // 【ここまで修正】
            
            const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (panelChannel) {
                // 週間ランキング（全ページ）を取得
                const rankingEmbeds = await createWeeklyRankingEmbeds(client, redis);
                
                // 部活作成パネルの埋め込みを作成
                const clubPanelEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🎫 部活作成パネル')
                    .setDescription('**新規でもすぐ参加できる遊び場**\n\n気軽に部活を作ってみませんか？\n\n**流れ：**\n1. ボタンを押してフォームを開く\n2. 部活名・絵文字・活動内容を入力\n3. チャンネルが自動作成され、部長権限が付与される')
                    .addFields(
                        { name: '💰 必要ロメコイン', value: `<:romecoin2:1452874868415791236> ${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}`, inline: true },
                        { name: '⏰ 作成制限', value: '7日に1回', inline: true },
                        { name: '📍 作成場所', value: '人気・新着部活', inline: true },
                        { name: '💡 気軽に始めよう', value: '• まずは小規模でも作ってみてOK\n• 途中で放置しても大丈夫\n• 気が向いたときに活動すればOK', inline: false },
                        { name: '📝 入力項目', value: '部活名・絵文字・活動内容', inline: true },
                        { name: '🎨 絵文字例', value: '⚽ 🎵 🎨 🎮 📚 🎮', inline: true },
                        { name: '⚠️ 注意事項', value: `部活作成には${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}ロメコインが必要です。残高が不足している場合は作成できません。`, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'HisameAI Mark.4' });

                // 週間ランキングと部活作成パネルを送信
                const messagePayload = {
                    embeds: rankingEmbeds && rankingEmbeds.length > 0 ? [...rankingEmbeds, clubPanelEmbed] : [clubPanelEmbed],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
                };
                
                await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, messagePayload);
            }
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) await redis.set('anonymous_message_counter', 216);
        } catch (error) { console.error('起動時の初期化処理でエラー:', error); }

        
        // --- 部活メッセージ数を1日1回Redisに反映 ---
        const flushClubMessageCounts = async () => {
            let totalReflected = 0;
            for (const [channelId, count] of Object.entries(dailyMessageBuffer)) {
                if (count > 0) {
                    try {
                        const beforeRedis = await redis.get(`weekly_message_count:${channelId}`) || 0;
                        await redis.incrby(`weekly_message_count:${channelId}`, count);
                        const afterRedis = await redis.get(`weekly_message_count:${channelId}`) || 0;
                        console.log(`[日次バッチ] チャンネル ${channelId}: メモリ ${count}件 → Redis ${beforeRedis} → ${afterRedis}`);
                        dailyMessageBuffer[channelId] = 0;
                        totalReflected += count;
                    } catch (error) {
                        console.error(`[日次バッチ] Redis反映エラー for channel ${channelId}:`, error);
                    }
                }
            }
            console.log(`[日次バッチ] 部活メッセージ数を1日分まとめてRedisに反映しました。合計: ${totalReflected}件`);
        };
        cron.schedule('0 0 * * *', flushClubMessageCounts, { scheduled: true, timezone: 'Asia/Tokyo' });

        // --- 自動ソート + 廃部処理 + ランキング更新（土曜日23:45） ---
        const autoSortChannels = async () => {
            try {
                const guild = client.guilds.cache.first();
                if (!guild) {
                    console.error('自動ソート: ギルドが見つかりません');
                    return;
                }
                
                console.log('土曜23:45の自動ソート + 廃部処理 + 復活処理 + ランキング更新を実行します');
                
                // 1. アーカイブ復活処理（アクティブポイントが復活した部活を部活カテゴリに戻す）
                await autoReviveArchivedClubs(guild, redis);
                
                // 2. 自動廃部処理（アクティブポイント0の部活をアーカイブに移動）
                await autoArchiveInactiveClubs(guild, redis);
                
                // 3. チャンネルソート実行
                await sortClubChannelsOnly(guild, redis);
                
                // 4. 週間ランキングの更新（部活作成パネルの更新）
                const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
                if (panelChannel) {
                    const rankingEmbeds = await createWeeklyRankingEmbeds(client, redis);
                    
                    const clubPanelEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('🎫 部活作成パネル')
                        .setDescription('**新規でもすぐ参加できる遊び場**\n\n気軽に部活を作ってみませんか？\n\n**流れ：**\n1. ボタンを押してフォームを開く\n2. 部活名・絵文字・活動内容を入力\n3. チャンネルが自動作成され、部長権限が付与される')
                        .addFields(
                            { name: '💰 必要ロメコイン', value: `<:romecoin2:1452874868415791236> ${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}`, inline: true },
                            { name: '⏰ 作成制限', value: '7日に1回', inline: true },
                            { name: '📍 作成場所', value: '人気・新着部活', inline: true },
                            { name: '💡 気軽に始めよう', value: '• まずは小規模でも作ってみてOK\n• 途中で放置しても大丈夫\n• 気が向いたときに活動すればOK', inline: false },
                            { name: '📝 入力項目', value: '部活名・絵文字・活動内容', inline: true },
                            { name: '🎨 絵文字例', value: '⚽ 🎵 🎨 🎮 📚 🎮', inline: true },
                            { name: '⚠️ 注意事項', value: `部活作成には<:romecoin2:1452874868415791236> ${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}が必要です。残高が不足している場合は作成できません。`, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'HisameAI Mark.4' });

                    const messagePayload = {
                        embeds: rankingEmbeds && rankingEmbeds.length > 0 ? [...rankingEmbeds, clubPanelEmbed] : [clubPanelEmbed],
                        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
                    };
                    
                    await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, messagePayload);
                }
                
                console.log('自動ソート + 廃部処理 + ランキング更新が完了しました');
            } catch (error) {
                console.error('自動ソートエラー:', error);
            }
        };
        // 週末自動ソートのスケジュール設定（土曜日23:45 JST）
        console.log('週末自動ソートスケジュールを設定しました: 土曜日23:45 JST');
        
        // タイムゾーン確認用のログ
        const now = new Date();
        const jstOffset = 9 * 60 * 60 * 1000; // JSTはUTC+9
        const jstNow = new Date(now.getTime() + jstOffset);
        console.log(`[タイムゾーン確認] 現在時刻: UTC=${now.toISOString()}, JST=${jstNow.toISOString().replace('Z', '+09:00')}`);
        
        // 次回実行時刻を計算（JSTの次の土曜日23:45）
        const calculateNextRun = () => {
            const nowDate = new Date();
            // JSTに変換（UTC+9時間）
            const jstDate = new Date(nowDate.getTime() + jstOffset);
            const jstYear = jstDate.getUTCFullYear();
            const jstMonth = jstDate.getUTCMonth();
            const jstDay = jstDate.getUTCDate();
            const jstHour = jstDate.getUTCHours();
            const jstMinute = jstDate.getUTCMinutes();
            const currentDay = jstDate.getUTCDay(); // 0=日曜, 6=土曜
            
            // 次の土曜日23:45を計算
            let daysUntilSaturday;
            if (currentDay === 6) { // 今日が土曜日
                if (jstHour < 23 || (jstHour === 23 && jstMinute < 45)) {
                    // 今日の23:45がまだ来ていない
                    daysUntilSaturday = 0;
                } else {
                    // 今日の23:45は過ぎたので、来週の土曜日
                    daysUntilSaturday = 7;
                }
            } else {
                // 土曜日ではない
                daysUntilSaturday = (6 - currentDay + 7) % 7;
            }
            
            // 次の土曜日23:45 JSTを計算
            const nextSaturdayJST = new Date(Date.UTC(jstYear, jstMonth, jstDay + daysUntilSaturday, 23, 45, 0, 0));
            // UTCに変換（JST-9時間）
            const nextSaturdayUTC = new Date(nextSaturdayJST.getTime() - jstOffset);
            
            return { jst: nextSaturdayJST, utc: nextSaturdayUTC };
        };
        const nextRun = calculateNextRun();
        console.log(`[次回自動ソート実行予定] JST=${nextRun.jst.toISOString().replace('Z', '+09:00')}, UTC=${nextRun.utc.toISOString()}`);
        
        // cronジョブの実行開始ログを追加
        const autoSortChannelsWithLogging = async () => {
            const startTime = new Date();
            const jstStartTime = new Date(startTime.getTime() + jstOffset);
            console.log(`[自動ソート開始] 実行時刻: JST=${jstStartTime.toISOString().replace('Z', '+09:00')}, UTC=${startTime.toISOString()}`);
            try {
                await autoSortChannels();
                const endTime = new Date();
                const jstEndTime = new Date(endTime.getTime() + jstOffset);
                console.log(`[自動ソート完了] 完了時刻: JST=${jstEndTime.toISOString().replace('Z', '+09:00')}, 実行時間: ${endTime - startTime}ms`);
            } catch (error) {
                const endTime = new Date();
                const jstEndTime = new Date(endTime.getTime() + jstOffset);
                console.error(`[自動ソートエラー] エラー時刻: JST=${jstEndTime.toISOString().replace('Z', '+09:00')}, エラー:`, error);
            }
        };
        
        // 自動ソートのcron式: 土曜日23:45 JST = 土曜日14:45 UTC
        // node-cronのタイムゾーン指定が正しく機能しない場合に備え、UTC基準のcron式も設定
        const cronJob = cron.schedule('45 23 * * 6', autoSortChannelsWithLogging, { scheduled: true, timezone: 'Asia/Tokyo' });
        
        // バックアップ: UTC基準のcron式（土曜14:45 UTC = 土曜23:45 JST）
        // タイムゾーン問題を避けるため、UTC基準でも設定（重複実行を防ぐため無効化）
        // const cronJobUtc = cron.schedule('45 14 * * 6', autoSortChannelsWithLogging, { scheduled: false });
        
        // cronジョブの状態を確認
        const cronStatus = cronJob.getStatus();
        if (cronStatus === 'scheduled') {
            console.log('[自動ソート cronジョブ状態] スケジュール済み（実行待ち）');
        } else {
            console.warn(`[自動ソート cronジョブ状態] 警告: ステータスが「${cronStatus}」です`);
        }
        
        // 手動実行用のコマンドを追加（デバッグ用）
        // Discordチャンネルから実行できるようにする場合は、スラッシュコマンドを追加することも検討可能
        
        // デバッグ用: 手動実行関数をグローバルに公開
        global.manualAutoSort = autoSortChannels;
        console.log('手動実行用関数を設定しました: global.manualAutoSort()');

        // --- 週次リセット（日曜日午前0時） ---
        const resetWeeklyCountsWithLogging = async () => {
            const startTime = new Date();
            const jstOffset = 9 * 60 * 60 * 1000;
            const jstStartTime = new Date(startTime.getTime() + jstOffset);
            console.log(`[週次リセット開始] 実行時刻: JST=${jstStartTime.toISOString().replace('Z', '+09:00')}, UTC=${startTime.toISOString()}`);
            
            try {
                await resetWeeklyCounts();
                const endTime = new Date();
                const jstEndTime = new Date(endTime.getTime() + jstOffset);
                console.log(`[週次リセット完了] 完了時刻: JST=${jstEndTime.toISOString().replace('Z', '+09:00')}, 実行時間: ${endTime - startTime}ms`);
            } catch (error) {
                const endTime = new Date();
                const jstEndTime = new Date(endTime.getTime() + jstOffset);
                console.error(`[週次リセットエラー] エラー時刻: JST=${jstEndTime.toISOString().replace('Z', '+09:00')}, エラー:`, error);
            }
        };
        
        const resetWeeklyCounts = async () => {
            try {
                // 週次リセット前にメモリ内カウントをRedisに反映
                let memoryReflected = 0;
                if (global.dailyMessageBuffer) {
                    for (const [channelId, count] of Object.entries(global.dailyMessageBuffer)) {
                        if (count > 0) {
                            try {
                                await redis.incrby(`weekly_message_count:${channelId}`, count);
                                global.dailyMessageBuffer[channelId] = 0; // 反映後はリセット
                                memoryReflected += count;
                            } catch (error) {
                                console.error(`週次リセット前のRedis反映エラー for channel ${channelId}:`, error);
                            }
                        }
                    }
                    if (memoryReflected > 0) {
                        console.log(`[週次リセット] メモリ内カウントをRedisに反映しました。合計: ${memoryReflected}件`);
                    }
                }
                
                // 全部活チャンネルの週間カウントを0にリセット
                const guild = client.guilds.cache.first();
                if (!guild) {
                    console.error('[週次リセット] ギルドが見つかりません');
                    return;
                }

                let allClubChannels = [];
                
                // 全ての部活カテゴリからチャンネルを取得（人気部活カテゴリも含む）
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
                
                // 廃部候補カテゴリからも取得
                const inactiveCategory = await guild.channels.fetch(config.INACTIVE_CLUB_CATEGORY_ID).catch(() => null);
                if (inactiveCategory && inactiveCategory.type === ChannelType.GuildCategory) {
                    const inactiveChannels = inactiveCategory.children.cache.filter(ch => 
                        !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                        ch.type === ChannelType.GuildText
                    );
                    allClubChannels.push(...inactiveChannels.values());
                }
                
                // アーカイブカテゴリからも取得（アーカイブ中の部活も週次リセット対象）
                const archiveCategories = [config.ARCHIVE_CATEGORY_ID, config.ARCHIVE_OVERFLOW_CATEGORY_ID];
                for (const categoryId of archiveCategories) {
                    const category = await guild.channels.fetch(categoryId).catch(() => null);
                    if (category && category.type === ChannelType.GuildCategory) {
                        const archiveChannels = category.children.cache.filter(ch => 
                            !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                            ch.type === ChannelType.GuildText
                        );
                        allClubChannels.push(...archiveChannels.values());
                    }
                }

                // 全部活チャンネルの週間カウントと前回スコアを0にリセット
                let resetCount = 0;
                for (const channel of allClubChannels) {
                    try {
                        const beforeCount = await redis.get(`weekly_message_count:${channel.id}`) || 0;
                        await redis.set(`weekly_message_count:${channel.id}`, 0);
                        await redis.del(`previous_score:${channel.id}`);
                        if (Number(beforeCount) > 0) {
                            resetCount++;
                            console.log(`[週次リセット] チャンネル ${channel.name} (${channel.id}): ${beforeCount} → 0`);
                        }
                    } catch (error) {
                        console.error(`[週次リセット] チャンネル ${channel.id} のリセットエラー:`, error);
                    }
                }
                
                console.log(`[週次リセット] 週間メッセージカウントをリセットしました。対象チャンネル数: ${allClubChannels.length}件, リセット実行: ${resetCount}件`);
            } catch (error) {
                console.error('[週次リセット] エラー:', error);
                throw error;
            }
        };
        
        // 週次リセットの次回実行時刻を計算
        const calculateNextReset = () => {
            const nowDate = new Date();
            const jstOffset = 9 * 60 * 60 * 1000;
            const jstDate = new Date(nowDate.getTime() + jstOffset);
            const jstYear = jstDate.getUTCFullYear();
            const jstMonth = jstDate.getUTCMonth();
            const jstDay = jstDate.getUTCDate();
            const currentDay = jstDate.getUTCDay(); // 0=日曜, 6=土曜
            
            // 次の日曜日0:00を計算
            let daysUntilSunday;
            if (currentDay === 0) {
                // 今日が日曜日
                daysUntilSunday = 7; // 来週の日曜日
            } else {
                // 日曜日まで残り日数
                daysUntilSunday = (7 - currentDay) % 7 || 7;
            }
            
            // 次の日曜日0:00 JSTを計算
            const nextSundayJST = new Date(Date.UTC(jstYear, jstMonth, jstDay + daysUntilSunday, 0, 0, 0, 0));
            const nextSundayUTC = new Date(nextSundayJST.getTime() - jstOffset);
            
            return { jst: nextSundayJST, utc: nextSundayUTC };
        };
        const nextReset = calculateNextReset();
        console.log(`[次回週次リセット予定] JST=${nextReset.jst.toISOString().replace('Z', '+09:00')}, UTC=${nextReset.utc.toISOString()}`);
        
        const resetCronJob = cron.schedule('0 0 * * 0', resetWeeklyCountsWithLogging, { scheduled: true, timezone: 'Asia/Tokyo' });
        
        // cronジョブの状態を確認
        if (resetCronJob.getStatus() === 'scheduled') {
            console.log('[週次リセット cronジョブ状態] スケジュール済み（実行待ち）');
        } else {
            console.warn(`[週次リセット cronジョブ状態] 警告: ステータスが「${resetCronJob.getStatus()}」です`);
        }

	},
};
