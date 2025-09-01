const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ActivityType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels, safeIncrby, getAllKeys } = require('../utils/utility.js');

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

// 週間ランキングの埋め込みを作成する関数
async function createWeeklyRankingEmbed(client, redis) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return null;

        let allClubChannels = [];
        
        // 両方のカテゴリーから部活チャンネルを取得
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
        
        if (allClubChannels.length === 0) return null;
        
        // メッセージ数とアクティブ部員数でランキングを作成
        let ranking = [];
        for (const channel of allClubChannels) {
            const messageCount = await redis.get(`weekly_message_count:${channel.id}`) || 0;
            
            // アクティブ部員数を計算（過去100メッセージから）
            const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());
            const messageCounts = new Map();
            messages.forEach(msg => {
                if (!msg.author.bot) {
                    const count = messageCounts.get(msg.author.id) || 0;
                    messageCounts.set(msg.author.id, count + 1);
                }
            });
            const activeMembers = Array.from(messageCounts.entries())
                .filter(([_, count]) => count >= 5)
                .length;
            
            ranking.push({ 
                id: channel.id, 
                name: channel.name,
                messageCount: Number(messageCount), 
                activeMembers,
                position: channel.position
            });
        }
        
        // メッセージ数でソート（同じ場合はアクティブ部員数でソート）
        ranking.sort((a, b) => {
            if (b.messageCount !== a.messageCount) {
                return b.messageCount - a.messageCount;
            }
            if (b.activeMembers !== a.activeMembers) {
                return b.activeMembers - a.activeMembers;
            }
            return a.position - b.position;
        });
        
        // トップ10のみ表示
        const top10 = ranking.slice(0, 10);
        
        let rankingText = '';
        for (let i = 0; i < top10.length; i++) {
            const club = top10[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            rankingText += `${medal} **${club.name}**\n`;
            rankingText += `   📊 メッセージ: ${club.messageCount} | 👥 アクティブ: ${club.activeMembers}人\n\n`;
        }
        
        if (rankingText === '') {
            rankingText = 'データがありません';
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🏆 週間部活ランキング')
            .setDescription('アクティブ・部員数順の週間ランキングです\n（日曜0時に更新）')
            .addFields(
                { name: '📈 ランキング', value: rankingText, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'HisameAI Mark.4' });
            
        return embed;
    } catch (error) {
        console.error('週間ランキング作成エラー:', error);
        return null;
    }
}

// 部活チャンネルのソートのみを実行する関数（ランキング表示なし）
async function sortClubChannelsOnly(guild, redis) {
    try {
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
            
            const anonyChannel = await client.channels.fetch(config.ANONYMOUS_CHANNEL_ID).catch(() => null);
            if (anonyChannel) await postStickyMessage(client, anonyChannel, config.STICKY_BUTTON_ID, { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] });
            const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (panelChannel) {
                // 週間ランキングを取得
                const rankingEmbed = await createWeeklyRankingEmbed(client, redis);
                
                // 部活作成パネルの埋め込みを作成
                const clubPanelEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🎫 部活作成パネル')
                    .setDescription('新しい部活を設立するには、下のボタンを押してください。\n\n**部活設立の流れ：**\n1. ボタンを押して部活作成フォームを開く\n2. 部活名と活動内容を入力\n3. 部活チャンネルが自動で作成される\n4. 部長ロールが付与される\n\n**注意事項：**\n• 部活作成は24時間に1回まで\n• 部活名は分かりやすい名前にする\n• 活動内容は具体的に記入する')
                    .addFields(
                        { name: '📋 必要な情報', value: '• 部活名\n• 活動内容', inline: true },
                        { name: '⏰ 作成制限', value: '24時間に1回', inline: true },
                        { name: '🎯 作成場所', value: 'カテゴリー1または2', inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'HisameAI Mark.4' });

                // 週間ランキングと部活作成パネルを送信
                const messagePayload = {
                    embeds: rankingEmbed ? [rankingEmbed, clubPanelEmbed] : [clubPanelEmbed],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
                };
                
                await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, messagePayload);
            }
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) await redis.set('anonymous_message_counter', 216);
        } catch (error) { console.error('起動時の初期化処理でエラー:', error); }

        // ---【修正】部活ソートとランキング更新を週1回（日曜日午前0時）に実行---
        cron.schedule(config.CLUB_RANKING_UPDATE_CRON, async () => {
            try {
                const guild = client.guilds.cache.first();
                if (!guild) return;
                
                // 部活チャンネルのソート
                await sortClubChannelsOnly(guild, redis);
                
                // 週間ランキングの更新（部活作成パネルの更新）
                const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
                if (panelChannel) {
                    const rankingEmbed = await createWeeklyRankingEmbed(client, redis);
                    
                    const clubPanelEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('🎫 部活作成パネル')
                        .setDescription('新しい部活を設立するには、下のボタンを押してください。\n\n**部活設立の流れ：**\n1. ボタンを押して部活作成フォームを開く\n2. 部活名と活動内容を入力\n3. 部活チャンネルが自動で作成される\n4. 部長ロールが付与される\n\n**注意事項：**\n• 部活作成は24時間に1回まで\n• 部活名は分かりやすい名前にする\n• 活動内容は具体的に記入する')
                        .addFields(
                            { name: '📋 必要な情報', value: '• 部活名\n• 活動内容', inline: true },
                            { name: '⏰ 作成制限', value: '24時間に1回', inline: true },
                            { name: '🎯 作成場所', value: 'カテゴリー1または2', inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'HisameAI Mark.4' });

                    const messagePayload = {
                        embeds: rankingEmbed ? [rankingEmbed, clubPanelEmbed] : [clubPanelEmbed],
                        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
                    };
                    
                    await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, messagePayload);
                }
                
                console.log('週間ランキングと部活作成パネルを更新しました');
            } catch (e) {
                console.error('部活ソート・ランキング更新自動実行cronエラー:', e);
            }
        });
        
        // --- 部活メッセージ数を1日1回Redisに反映 ---
        const flushClubMessageCounts = async () => {
            for (const [channelId, count] of Object.entries(dailyMessageBuffer)) {
                if (count > 0) {
                    await redis.set(`weekly_message_count:${channelId}`, count);
                    dailyMessageBuffer[channelId] = 0;
                }
            }
            console.log('部活メッセージ数を1日分まとめてRedisに反映しました。');
        };
        cron.schedule('0 0 * * *', flushClubMessageCounts, { scheduled: true, timezone: 'Asia/Tokyo' });

	},
};
