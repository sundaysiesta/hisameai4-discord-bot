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


async function postOrEdit(channel, redisKey, payload) {
    const messageId = await channel.client.redis.get(redisKey);
    let message;
    if (messageId) {
        try {
            message = await channel.messages.fetch(messageId);
            await message.edit(payload);
        } catch (error) {
            console.error(`Failed to edit message ${messageId}, posting new one.`, error);
            message = await channel.send(payload);
            await channel.client.redis.set(redisKey, message.id);
        }
    } else {
        message = await channel.send(payload);
        await channel.client.redis.set(redisKey, message.id);
    }
    return message;
}

async function updatePermanentRankings(guild, redis, notion) {
    const rankingChannel = await guild.client.channels.fetch(config.RANKING_CHANNEL_ID).catch(() => null);
    if (!rankingChannel) return;

    let clubMessage;

    try {
        const clubCategory = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
        let clubRankingEmbed = new EmbedBuilder().setTitle('部活アクティブランキング (週間)').setColor(0x82E0AA).setTimestamp();
        if (clubCategory) {
             await guild.members.fetch(); // 全メンバーをキャッシュ
             const clubChannels = clubCategory.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
             let clubRanking = [];
             for (const channel of clubChannels.values()) {
                 const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
                 clubRanking.push({ id: channel.id, count: Number(count), position: channel.position });
             }
             clubRanking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
             if (clubRanking.length === 0) {
                 clubRankingEmbed.setDescription('現在、活動中の部活はありません。');
             } else {
                 const descriptionPromises = clubRanking.map(async (club, i) => {
                     // 1. redisから部長ロールID取得
                     let leaderRoleId = await redis.get(`leader_roles:${club.id}`);
                     // 2. なければNotionから取得（ここは省略可、必要なら追加）
                     let leaderMention = '未設定';
                     if (leaderRoleId) {
                         // 3. Notion人物DBから部長ロールプロパティ一致の人物を検索
                         const notionResponse = await notion.databases.query({
                             database_id: config.NOTION_DATABASE_ID,
                             filter: {
                                 or: [
                                     { property: '部長ロール', rich_text: { equals: leaderRoleId } },
                                     { property: '部長ロール', rich_text: { contains: leaderRoleId } }
                                 ]
                             }
                         });
                         if (notionResponse.results.length > 0) {
                             const userId = notionResponse.results[0].properties['DiscordユーザーID']?.rich_text?.[0]?.plain_text;
                             if (userId) {
                                 leaderMention = `<@${userId}>`;
                             } else {
                                 leaderMention = '不在';
                             }
                         } else {
                             leaderMention = '不在';
                         }
                     }
                     return `**${i + 1}位:** <#${club.id}>  **部長:** ${leaderMention}`;
                 });
                 clubRankingEmbed.setDescription((await Promise.all(descriptionPromises)).join('\n'));
             }
         } else {
             clubRankingEmbed.setDescription('部活カテゴリが見つかりません。');
         }
        clubMessage = await postOrEdit(rankingChannel, 'club_ranking_message_id', { embeds: [clubRankingEmbed] });
    } catch(e) { console.error("部活ランキング更新エラー:", e); }
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
            if (panelChannel) await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, { content: '新しい部活を設立するには、下のボタンを押してください。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))] });
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) await redis.set('anonymous_message_counter', 216);
        } catch (error) { console.error('起動時の初期化処理でエラー:', error); }

        // ---【追加】起動時に即時ランキング更新---
        try {
            const guild = client.guilds.cache.first();
            if (guild) {
                await updatePermanentRankings(guild, redis, notion);
                console.log('起動時にランキングを即時更新しました。');
            }
        } catch (e) {
            console.error('起動時ランキング即時更新エラー:', e);
        }

        // ---【修正】cron式を5分ごとに---
        cron.schedule('*/5 * * * *', async () => {
            try {
                const guild = client.guilds.cache.first();
                if (!guild) return;
                
                await updatePermanentRankings(guild, redis, notion);
            } catch (e) {
                console.error('ランキング自動更新cronエラー:', e);
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
