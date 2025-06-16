const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ActivityType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels, updateLevelRoles, calculateTextLevel, calculateVoiceLevel, safeIncrby } = require('../utils/utility.js');

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
    try {
        // チャンネルの取得方法を修正
        const rankingChannel = await guild.channels.fetch(config.RANKING_CHANNEL_ID).catch(() => null);
        if (!rankingChannel) {
            console.error('ランキングチャンネルが見つかりません。');
            return;
        }

        let levelMessage, clubMessage, trendMessage;

        try {
            const now = new Date();
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const titleDate = `${firstDayOfMonth.getMonth() + 1}月${firstDayOfMonth.getDate()}日〜`;
            const monthKey = now.toISOString().slice(0, 7);
            const textKeys = await redis.keys(`monthly_xp:text:${monthKey}:*`);
            const voiceKeys = await redis.keys(`monthly_xp:voice:${monthKey}:*`);
            const textUsers = [];
            for (const key of textKeys) {
                try {
                    const xp = await redis.get(key);
                    if (xp !== null && !isNaN(xp)) textUsers.push({ userId: key.split(':')[3], xp: Number(xp) });
                } catch (e) { console.error(e); }
            }
            const voiceUsers = [];
            for (const key of voiceKeys) {
                try {
                    const xp = await redis.get(key);
                    if (xp !== null && !isNaN(xp)) voiceUsers.push({ userId: key.split(':')[3], xp: Number(xp) });
                } catch (e) { console.error(e); }
            }

            // 上位20名のユーザーIDを取得
            const top20Text = textUsers.sort((a,b)=>b.xp - a.xp).slice(0, 20);
            const top20Voice = voiceUsers.sort((a,b)=>b.xp - a.xp).slice(0, 20);
            
            // 必要なユーザーIDのみを収集
            const neededUserIds = new Set([...top20Text.map(u => u.userId), ...top20Voice.map(u => u.userId)]);
            
            // 必要なユーザーのみをフェッチ
            const memberCache = new Map();
            for (const userId of neededUserIds) {
                try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) memberCache.set(userId, member);
                } catch (e) { console.error(`Failed to fetch member ${userId}:`, e); }
            }

            let textDesc = top20Text.map((u, i) => {
                const member = memberCache.get(u.userId);
                return member ? `**${i+1}位:** ${member} - Lv.${calculateTextLevel(u.xp)} (${u.xp} XP)` : null;
            }).filter(Boolean).join('\n') || 'まだ誰もXPを獲得していません。';

            let voiceDesc = top20Voice.map((u, i) => {
                const member = memberCache.get(u.userId);
                return member ? `**${i+1}位:** ${member} - Lv.${calculateVoiceLevel(u.xp)} (${u.xp} XP)` : null;
            }).filter(Boolean).join('\n') || 'まだ誰もXPを獲得していません。';

            const levelEmbed = new EmbedBuilder()
                .setTitle(`月間レベルランキング (${titleDate})`)
                .setColor(0xFFD700)
                .addFields(
                    { name: '💬 テキスト', value: textDesc, inline: true },
                    { name: '🎤 ボイス', value: voiceDesc, inline: true }
                )
                .setTimestamp();
            levelMessage = await postOrEdit(rankingChannel, 'level_ranking_message_id', { embeds: [levelEmbed] });
        } catch (e) { console.error("レベルランキング更新エラー:", e); }

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
                        let leaderRoleId = await redis.get(`leader_roles:${club.id}`);
                        let leaderMention = '未設定';
                        if (leaderRoleId) {
                            const notionResponse = await notion.databases.query({
                                database_id: config.NOTION_DATABASE_ID,
                                filter: { property: '部長ロール', rich_text: { equals: leaderRoleId } }
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
          try {
            // --- トレンドワードのリスト型対応 ---
            const trendEntries = await redis.lrange('trend_words', 0, -1);
            const trendItemsMap = new Map();
            const now = Date.now();
            const cutoff = now - config.TREND_WORD_LIFESPAN;
            for (const entry of trendEntries) {
                // entry形式: word:userId:timestamp
                const [word, userId, timestamp] = entry.split(':');
                if (!word || !timestamp) continue;
                if (Number(timestamp) < cutoff) continue;
                if (!trendItemsMap.has(word)) trendItemsMap.set(word, 0);
                trendItemsMap.set(word, trendItemsMap.get(word) + 1);
            }
            // スコアで降順ソート
            const trendItems = Array.from(trendItemsMap.entries())
                .map(([word, score]) => ({ word, score }))
                .sort((a, b) => b.score - a.score);

            const trendEmbed = new EmbedBuilder()
                .setTitle('サーバー内トレンド (過去3時間)')
                .setColor(0x1DA1F2)
                .setTimestamp();

            if (trendItems.length === 0) {
                trendEmbed.setDescription('現在、トレンドはありません。');
            } else {
                trendEmbed.setDescription(
                    trendItems.slice(0, 30).map((item, index) => `**${index + 1}位:** ${item.word} (スコア: ${item.score})`).join('\n')
                );
            }
            trendMessage = await postOrEdit(rankingChannel, 'trend_message_id', { embeds: [trendEmbed] });
        } catch (e) { console.error("トレンドランキング更新エラー:", e); }
        
        try {
            const payload = { content: '各ランキングへ移動:', components: [] };
            const linkButtons = new ActionRowBuilder();
            if (levelMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('レベルランキングへ').setStyle(ButtonStyle.Link).setURL(levelMessage.url));
            if (clubMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('部活ランキングへ').setStyle(ButtonStyle.Link).setURL(clubMessage.url));
            if (trendMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('トレンドへ').setStyle(ButtonStyle.Link).setURL(trendMessage.url));
            if (linkButtons.components.length > 0) payload.components.push(linkButtons);
            await postOrEdit(rankingChannel, 'ranking_links_message_id', payload);
        } catch(e){ console.error("リンクボタン更新エラー:", e); }
    } catch (error) {
        console.error('ランキングの更新に失敗しました:', error);
    }
}

// ボイスチャットのXP付与処理
async function handleVoiceXp(member, xpToGive, redis) {
    if (!member || member.roles.cache.has(config.XP_EXCLUDED_ROLE_ID)) return;

    try {
        const mainAccountId = await redis.hget(`user:${member.id}`, 'mainAccountId') || member.id;
        const userKey = `user:${mainAccountId}`;
        const monthlyKey = `monthly_xp:voice:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
        const dailyKey = `daily_xp:voice:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;

        // 各キーの存在確認と初期化を個別に実行
        const [userData, monthlyExists, dailyExists] = await Promise.all([
            redis.hgetall(userKey),
            redis.exists(monthlyKey),
            redis.exists(dailyKey)
        ]);

        // ユーザーデータの初期化（必要な場合）
        if (!userData || Object.keys(userData).length === 0) {
            await redis.hset(userKey, {
                textXp: '0',
                voiceXp: '0',
                balance: '0',
                bank: '0'
            });
        }

        // 月間・日間XPの初期化（必要な場合）
        if (!monthlyExists) {
            await redis.set(monthlyKey, '0');
        }
        if (!dailyExists) {
            await redis.set(dailyKey, '0');
        }

        // XPとロメコインの更新（個別に実行して確実性を高める）
        const multi = redis.multi();
        multi.hincrby(userKey, 'voiceXp', xpToGive);
        multi.hincrby(userKey, 'balance', xpToGive); // 同額のロメコインを付与
        multi.incrby(monthlyKey, xpToGive);
        multi.incrby(dailyKey, xpToGive);
        multi.expire(monthlyKey, 60 * 60 * 24 * 32);  // 32日
        multi.expire(dailyKey, 60 * 60 * 24 * 2);     // 2日
        await multi.exec();

        await updateLevelRoles(member, redis, member.client);
    } catch (error) {
        console.error('ボイスXP付与エラー:', error);
    }
}

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`ボットが起動しました: ${client.user.tag}`);
        client.redis = redis;

        try {
            // ボットのステータスを設定
            const savedStatus = await redis.get('bot_status_text');
            if (savedStatus) {
                client.user.setActivity(savedStatus, { type: ActivityType.Playing });
            } else {
                client.user.setPresence({
                    activities: [{ 
                        name: 'ロメコイン経済システム',
                        type: ActivityType.Playing
                    }],
                    status: 'online'
                });
            }

            // 再起動通知
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) {
                const commitInfo = await getLatestCommitInfo();
                const embed = new EmbedBuilder()
                    .setTitle('🤖 再起動しました。確認してください。')
                    .setColor(0x3498DB)
                    .setTimestamp();

                if (commitInfo) {
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
                    embed.addFields({ name: 'バージョン情報', value: '取得に失敗しました。' });
                }

                await notificationChannel.send({ embeds: [embed] });
            }

            // 匿名チャンネルの設定
            const anonyChannel = await client.channels.fetch(config.ANONYMOUS_CHANNEL_ID).catch(() => null);
            if (anonyChannel) {
                await postStickyMessage(client, anonyChannel, config.STICKY_BUTTON_ID, {
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(config.STICKY_BUTTON_ID)
                            .setLabel('書き込む')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✍️')
                    )]
                });
            }

            // 部活パネルの設定
            const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (panelChannel) {
                await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, {
                    content: '新しい部活を設立するには、下のボタンを押してください。',
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(config.CREATE_CLUB_BUTTON_ID)
                            .setLabel('部活を作成する')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('🎫')
                    )]
                });
            }

            // 匿名メッセージカウンターの初期化
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) {
                await redis.set('anonymous_message_counter', 216);
            }

            // ランキングの更新を実行
            const guild = await client.guilds.fetch(config.GUILD_ID).catch(error => {
                console.error('ギルドの取得に失敗しました:', error);
                return null;
            });

            if (!guild) {
                console.error('ギルドが見つかりません。GUILD_IDを確認してください。');
                return;
            }

            // 起動時に即時ランキング更新
            await updatePermanentRankings(guild, redis, notion).catch(error => {
                console.error('ランキングの更新に失敗しました:', error);
            });

            // 定期的なランキング更新のスケジュール設定
            cron.schedule('0 */1 * * *', async () => {
                try {
                    const voiceStates = guild.voiceStates.cache;
                    const activeVCs = new Map();
                    
                    // VCのXP処理
                    voiceStates.forEach(vs => {
                        if (vs.channel && !vs.serverMute && !vs.selfMute && !vs.member.user.bot) {
                            const members = activeVCs.get(vs.channelId) || [];
                            members.push(vs.member);
                            activeVCs.set(vs.channelId, members);
                        }
                    });

                    const now = Date.now();
                    for (const members of activeVCs.values()) {
                        if (members.length > 1) {
                            for (const member of members) {
                                if (member.roles.cache.has(config.XP_EXCLUDED_ROLE_ID)) continue;
                                const cooldownKey = `xp_cooldown:voice:${member.id}`;
                                const lastXpTime = await redis.get(cooldownKey);
                                if (!lastXpTime || (now - lastXpTime > config.VOICE_XP_COOLDOWN)) {
                                    const xp = config.VOICE_XP_AMOUNT;
                                    await handleVoiceXp(member, xp, redis);
                                    await redis.set(cooldownKey, now, { ex: 125 });
                                }
                            }
                        }
                    }
                    await updatePermanentRankings(guild, redis, notion);
                } catch (error) {
                    console.error('定期ランキング更新でエラーが発生しました:', error);
                }
            });

            // 部活チャンネルの並び替え
            cron.schedule('0 0 * * *', async () => {
                try {
                    await sortClubChannels(guild);
                } catch (error) {
                    console.error('部活チャンネルの並び替えでエラーが発生しました:', error);
                }
            });

            // 毎日深夜0時にRedisキーのクリーンアップを実行
            cron.schedule('0 0 * * *', async () => {
                try {
                    const now = Date.now();
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yesterdayKey = yesterday.toISOString().slice(0, 10);

                    // 期限切れの日次XPデータを削除
                    const dailyKeys = await redis.keys(`daily_xp:*:${yesterdayKey}:*`);
                    if (dailyKeys.length > 0) {
                        await redis.del(...dailyKeys);
                    }

                    // 期限切れのトレンドデータを削除（3時間以上前）
                    const cutoff = now - config.TREND_WORD_LIFESPAN;
                    await redis.zremrangebyscore('trend_words_scores', '-inf', cutoff);
                    await redis.zremrangebyscore('trend_words_timestamps', '-inf', cutoff);

                    // 不要なクールダウンキーを削除
                    const cooldownKeys = await redis.keys('xp_cooldown:*');
                    for (const key of cooldownKeys) {
                        const timestamp = await redis.get(key);
                        if (now - timestamp > 24 * 60 * 60 * 1000) {
                            await redis.del(key);
                        }
                    }

                    console.log('Redisキーのクリーンアップが完了しました。');
                } catch (error) {
                    console.error('Redisキーのクリーンアップ中にエラー:', error);
                }
            }, { scheduled: true, timezone: "Asia/Tokyo" });

        } catch (error) {
            console.error('readyイベントの実行中にエラーが発生しました:', error);
        }
	},
};
