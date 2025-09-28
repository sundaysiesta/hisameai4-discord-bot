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
    
    // 日次メッセージバッファのクリーンアップ（1週間以上古いデータ）
    if (global.dailyMessageBuffer) {
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        for (const [channelId, lastUpdate] of Object.entries(global.dailyMessageBuffer)) {
            if (now - lastUpdate > oneWeek) {
                delete global.dailyMessageBuffer[channelId];
            }
        }
    }
    
    console.log('グローバル変数のクリーンアップを実行しました');
}

// 全部活の週間ランキング埋め込み（複数ページ対応）を作成する関数
async function createWeeklyRankingEmbeds(client, redis) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return [];

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
                // JSTに合わせるため+9時間して曜日を計算
                const jstNowMs = now.getTime() + 9 * 60 * 60 * 1000;
                const jstNow = new Date(jstNowMs);
                const day = jstNow.getUTCDay(); // 0=Sun
                const diffDays = day; // 今が日曜なら0日戻す
                const jstStartMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - diffDays * 24 * 60 * 60 * 1000;
                // JSTの0時 → UTCに戻すため-9時間
                return jstStartMs - 9 * 60 * 60 * 1000;
            };
            const sinceUtcMs = getStartOfWeekUtcMs();

            // 週の開始以降のメッセージのみからアクティブユーザーとメッセージ数を算出（最大500件まで遡る）
            const messageCounts = new Map();
            let weeklyMessageCount = 0; // リアルタイムでメッセージ数をカウント
            let beforeId = undefined;
            let fetchedTotal = 0;
            const maxFetch = 500;
            while (fetchedTotal < maxFetch) {
                const batch = await channel.messages.fetch({ limit: Math.min(100, maxFetch - fetchedTotal), before: beforeId }).catch(() => null);
                if (!batch || batch.size === 0) break;
                for (const msg of batch.values()) {
                    // 週開始より古い最古のメッセージに到達したら打ち切り
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

module.exports = {
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
                        { name: '💡 気軽に始めよう', value: '• まずは小規模でも作ってみてOK\n• 途中で放置しても大丈夫\n• 気が向いたときに活動すればOK', inline: false },
                        { name: '📝 入力項目', value: '部活名・絵文字・活動内容', inline: true },
                        { name: '⏰ 制限', value: '7日に1回', inline: true },
                        { name: '📍 場所', value: '人気・新着部活', inline: true },
                        { name: '🎨 絵文字例', value: '⚽ 🎵 🎨 🎮 📚 🎮', inline: false }
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
            for (const [channelId, count] of Object.entries(dailyMessageBuffer)) {
                if (count > 0) {
                    await redis.incrby(`weekly_message_count:${channelId}`, count);
                    dailyMessageBuffer[channelId] = 0;
                }
            }
            console.log('部活メッセージ数を1日分まとめてRedisに反映しました。');
        };
        cron.schedule('0 0 * * *', flushClubMessageCounts, { scheduled: true, timezone: 'Asia/Tokyo' });

        // --- 自動ソート（土曜日23:45） ---
        const autoSortChannels = async () => {
            try {
                const guild = client.guilds.cache.first();
                if (!guild) return;
                
                console.log('土曜23:45の自動ソートを実行します');
                await sortClubChannelsOnly(guild, redis);
                console.log('自動ソートが完了しました');
            } catch (error) {
                console.error('自動ソートエラー:', error);
            }
        };
        cron.schedule('45 23 * * 6', autoSortChannels, { scheduled: true, timezone: 'Asia/Tokyo' });

        // --- 週次リセット（日曜日午前0時） ---
        const resetWeeklyCounts = async () => {
            try {
                // 全部活チャンネルの週間カウントを0にリセット
                const guild = client.guilds.cache.first();
                if (!guild) return;

                let allClubChannels = [];
                
                // 全ての部活カテゴリからチャンネルを取得
                for (const categoryId of config.CLUB_CATEGORIES) {
                    const category = await guild.channels.fetch(categoryId).catch(() => null);
                    if (category && category.type === ChannelType.GuildCategory) {
                        const clubChannels = category.children.cache.filter(ch => 
                            !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                            ch.type === ChannelType.GuildText
                        );
                        allClubChannels.push(...clubChannels.values());
                    }
                }
                
                // 廃部候補カテゴリからも取得して部室棟に戻す
                const inactiveCategory = await guild.channels.fetch(config.INACTIVE_CLUB_CATEGORY_ID).catch(() => null);
                if (inactiveCategory && inactiveCategory.type === ChannelType.GuildCategory) {
                    const inactiveChannels = inactiveCategory.children.cache.filter(ch => 
                        !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                        ch.type === ChannelType.GuildText
                    );
                    allClubChannels.push(...inactiveChannels.values());
                }

                // 全部活チャンネルの週間カウントと前回スコアを0にリセット
                for (const channel of allClubChannels) {
                    await redis.set(`weekly_message_count:${channel.id}`, 0);
                    await redis.del(`previous_score:${channel.id}`);
                }
                
                console.log('週間メッセージカウントをリセットしました。');
                
                // 週間ランキングの更新（部活作成パネルの更新）
                const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
                if (panelChannel) {
                    const rankingEmbeds = await createWeeklyRankingEmbeds(client, redis);
                    
                    const clubPanelEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('🎫 部活作成パネル')
                        .setDescription('**新規でもすぐ参加できる遊び場**\n\n気軽に部活を作ってみませんか？\n\n**流れ：**\n1. ボタンを押してフォームを開く\n2. 部活名・絵文字・活動内容を入力\n3. チャンネルが自動作成され、部長権限が付与される')
                        .addFields(
                            { name: '💡 気軽に始めよう', value: '• まずは小規模でも作ってみてOK\n• 途中で放置しても大丈夫\n• 気が向いたときに活動すればOK', inline: false },
                            { name: '📝 入力項目', value: '部活名・絵文字・活動内容', inline: true },
                            { name: '⏰ 制限', value: '7日に1回', inline: true },
                            { name: '📍 場所', value: '人気・新着部活', inline: true },
                            { name: '🎨 絵文字例', value: '⚽ 🎵 🎨 🎮 📚 🎮', inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'HisameAI Mark.4' });

                    const messagePayload = {
                        embeds: rankingEmbeds && rankingEmbeds.length > 0 ? [...rankingEmbeds, clubPanelEmbed] : [clubPanelEmbed],
                        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
                    };
                    
                    await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, messagePayload);
                }
                
                console.log('週間ランキングと部活作成パネルを更新しました');
            } catch (error) {
                console.error('週次リセットエラー:', error);
            }
        };
        cron.schedule('0 0 * * 0', resetWeeklyCounts, { scheduled: true, timezone: 'Asia/Tokyo' });

	},
};
