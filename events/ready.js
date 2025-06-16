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
        console.log('updatePermanentRankings開始');
        
        // guildが正しく取得できているか確認
        if (!guild) {
            console.error('ギルドが未定義です');
            return;
        }

        // クライアントの参照を取得
        const client = guild.client;
        if (!client) {
            console.error('クライアントの参照が取得できません');
            return;
        }

        // ギルドのチャンネルを再取得
        try {
            // ギルドを再取得して最新の状態にする
            const freshGuild = await client.guilds.fetch(guild.id);
            if (!freshGuild) {
                console.error('ギルドの再取得に失敗');
                return;
            }
            guild = freshGuild;
            console.log('ギルドの再取得に成功:', guild.name);
        } catch (error) {
            console.error('ギルドの再取得に失敗:', error);
            return;
        }

        console.log('ギルド名:', guild.name);
        console.log('チャンネルID:', config.RANKING_CHANNEL_ID);

        let rankingChannel = null;
        try {
            // チャンネルを直接取得
            rankingChannel = await client.channels.fetch(config.RANKING_CHANNEL_ID);
            if (!rankingChannel) {
                console.error('ランキングチャンネルが見つかりません');
                return;
            }
            console.log('ランキングチャンネルの取得に成功:', rankingChannel.name);
        } catch (e) {
            console.error('ランキングチャンネルの取得に失敗:', e);
            return;
        }

        // ランキングメッセージの送信を試みる
        try {
            const testMessage = await rankingChannel.send('ランキング更新中...');
            await testMessage.delete();
            console.log('ランキングチャンネルへの送信テスト成功');
        } catch (e) {
            console.error('ランキングチャンネルへの送信テスト失敗:', e);
            return;
        }

        let levelMessage, coinMessage, clubMessage, trendMessage;

        try {
            // メインアカウントのマッピングを作成
            const userKeys = await redis.keys('user:*');
            const mainAccountMap = new Map();
            await Promise.all(userKeys.map(async key => {
                const userId = key.split(':')[1];
                const mainAccountId = await redis.hget(key, 'mainAccountId') || userId;
                mainAccountMap.set(userId, mainAccountId);
            }));

            // 月間のデータを取得
            const now = new Date();
            const monthKey = now.toISOString().slice(0, 7);
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const titleDate = `${firstDayOfMonth.getMonth() + 1}月${firstDayOfMonth.getDate()}日〜`;

            // テキストとボイスXPの集計
            const [textKeys, voiceKeys] = await Promise.all([
                redis.keys(`monthly_xp:text:${monthKey}:*`),
                redis.keys(`monthly_xp:voice:${monthKey}:*`)
            ]);

            // テキストXPの集計（メインアカウントベース）
            const textUsers = new Map();
            await Promise.all(textKeys.map(async key => {
                try {
                    const userId = key.split(':')[3];
                    const mainAccountId = mainAccountMap.get(userId) || userId;
                    const xp = Number(await redis.get(key)) || 0;
                    textUsers.set(mainAccountId, (textUsers.get(mainAccountId) || 0) + xp);
                } catch (e) { console.error('テキストXP集計エラー:', e); }
            }));

            // ボイスXPの集計（メインアカウントベース）
            const voiceUsers = new Map();
            await Promise.all(voiceKeys.map(async key => {
                try {
                    const userId = key.split(':')[3];
                    const mainAccountId = mainAccountMap.get(userId) || userId;
                    const xp = Number(await redis.get(key)) || 0;
                    voiceUsers.set(mainAccountId, (voiceUsers.get(mainAccountId) || 0) + xp);
                } catch (e) { console.error('ボイスXP集計エラー:', e); }
            }));

            // 上位20名の取得
            const top20Text = Array.from(textUsers.entries())
                .map(([userId, xp]) => ({ userId, xp }))
                .sort((a, b) => b.xp - a.xp)
                .slice(0, 20);

            const top20Voice = Array.from(voiceUsers.entries())
                .map(([userId, xp]) => ({ userId, xp }))
                .sort((a, b) => b.xp - a.xp)
                .slice(0, 20);

            // メンバー情報を一括取得
            const memberCache = new Map();
            const uniqueUserIds = new Set([
                ...top20Text.map(u => u.userId),
                ...top20Voice.map(u => u.userId)
            ]);

            await Promise.all(Array.from(uniqueUserIds).map(async userId => {
                try {
                    const member = await guild.members.fetch(userId);
                    if (member) memberCache.set(userId, member);
                } catch (e) { 
                    console.error(`メンバー取得エラー ${userId}:`, e); 
                }
            }));

            // ランキング表示の生成
            const textDesc = top20Text.map((u, i) => {
                const member = memberCache.get(u.userId);
                return member ? `**${i+1}位:** ${member} - Lv.${calculateTextLevel(u.xp)} (${u.xp.toLocaleString()} XP)` : null;
            }).filter(Boolean).join('\n') || 'まだ誰もXPを獲得していません。';

            const voiceDesc = top20Voice.map((u, i) => {
                const member = memberCache.get(u.userId);
                return member ? `**${i+1}位:** ${member} - Lv.${calculateVoiceLevel(u.xp)} (${u.xp.toLocaleString()} XP)` : null;
            }).filter(Boolean).join('\n') || 'まだ誰もXPを獲得していません。';

            // ランキングの更新
            const levelEmbed = new EmbedBuilder()
                .setTitle(`月間レベルランキング (${titleDate})`)
                .setColor(0xFFD700)
                .addFields(
                    { name: '💬 テキスト', value: textDesc, inline: true },
                    { name: '🎤 ボイス', value: voiceDesc, inline: true }
                )
                .setTimestamp();
            levelMessage = await postOrEdit(rankingChannel, 'level_ranking_message_id', { embeds: [levelEmbed] });

            // ロメコインランキングの更新（メインアカウントベース）
            const coinBalances = new Map();
            await Promise.all(userKeys.map(async key => {
                try {
                    const userId = key.split(':')[1];
                    const mainAccountId = mainAccountMap.get(userId) || userId;
                    const balance = Number(await redis.hget(key, 'balance')) || 0;
                    coinBalances.set(mainAccountId, (coinBalances.get(mainAccountId) || 0) + balance);
                } catch (e) { console.error('コイン集計エラー:', e); }
            }));

            const top20Balance = Array.from(coinBalances.entries())
                .map(([userId, balance]) => ({ userId, balance }))
                .sort((a, b) => b.balance - a.balance)
                .slice(0, 20);

            // コインランキング用のメンバー情報を更新
            await Promise.all(top20Balance.map(async user => {
                if (!memberCache.has(user.userId)) {
                    try {
                        const member = await guild.members.fetch(user.userId);
                        if (member) memberCache.set(user.userId, member);
                    } catch (e) { console.error(`コインランキングメンバー取得エラー ${user.userId}:`, e); }
                }
            }));

            const balanceDesc = top20Balance.map((u, i) => {
                const member = memberCache.get(u.userId);
                return member ? `**${i+1}位:** ${member} - ${config.COIN_SYMBOL} ${u.balance.toLocaleString()} ${config.COIN_NAME}` : null;
            }).filter(Boolean).join('\n') || 'まだ誰もコインを獲得していません。';

            const coinEmbed = new EmbedBuilder()
                .setTitle('ロメコインランキング')
                .setColor(0xFFD700)
                .setDescription(balanceDesc)
                .setTimestamp();

            coinMessage = await postOrEdit(rankingChannel, 'coin_ranking_message_id', { embeds: [coinEmbed] });

        } catch (e) { console.error("レベル・コインランキング更新エラー:", e); }

        try {
            // 部活カテゴリの取得
            let clubCategory;
            try {
                clubCategory = await guild.channels.fetch(config.CLUB_CATEGORY_ID);
            } catch (error) {
                console.error('部活カテゴリの取得に失敗:', error);
                clubCategory = null;
            }

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
    if (!member || member.roles.cache.has(config.XP_EXCLUDED_ROLE_ID)) {
        console.log(`ボイスXP付与をスキップ: ${member?.id} (除外ロールまたはメンバーなし)`);
        return;
    }

    try {
        const mainAccountId = await redis.hget(`user:${member.id}`, 'mainAccountId') || member.id;
        const userKey = `user:${mainAccountId}`;
        const monthlyKey = `monthly_xp:voice:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
        const dailyKey = `daily_xp:voice:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;

        try {
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
                console.log(`ユーザーデータを初期化: ${mainAccountId}`);
            }

            // 月間・日間XPの初期化（必要な場合）
            if (!monthlyExists) {
                await redis.set(monthlyKey, '0');
                console.log(`月間XPキーを初期化: ${monthlyKey}`);
            }
            if (!dailyExists) {
                await redis.set(dailyKey, '0');
                console.log(`日間XPキーを初期化: ${dailyKey}`);
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
            console.log(`ボイスXP付与成功: ${mainAccountId} +${xpToGive}XP`);
        } catch (redisError) {
            console.error('Redis操作エラー:', redisError);
            throw redisError;
        }
    } catch (error) {
        console.error('ボイスXP付与エラー:', error);
        console.error('エラーの詳細:', {
            memberId: member?.id,
            guildId: member?.guild?.id,
            channelId: member?.voice?.channelId
        });
    }
}

// Function has been merged into updatePermanentRankings

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
                client.user.setPresence({
                    activities: [{ name: savedStatus, type: ActivityType.Playing }],
                    status: 'online',
                });
            } else {
                client.user.setPresence({
                    activities: [{ name: '起動完了', type: ActivityType.Playing }],
                    status: 'online',
                });
            }

            // 再起動通知
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) {
                const latestCommit = await getLatestCommitInfo();
                const commitInfo = latestCommit 
                    ? `\n最新のコミット: ${latestCommit.message}\nSHA: ${latestCommit.sha}\nURL: ${latestCommit.url}`
                    : '';
                await notificationChannel.send(`✅ ボットが再起動しました。${commitInfo}`);
            }

            // 匿名チャンネルの設定
            const anonyChannel = await client.channels.fetch(config.ANONYMOUS_CHANNEL_ID).catch(() => null);
            if (anonyChannel) {
                const payload = {
                    components:
                    [
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(config.STICKY_BUTTON_ID)
                                    .setLabel('書き込む')
                                    .setStyle(ButtonStyle.Success)
                                    .setEmoji('✍️')
                            )
                    ]
                };
                await postStickyMessage(client, anonyChannel, config.STICKY_BUTTON_ID, payload);
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

            // 現在のギルドを取得
            let guild;
            try {
                // ギルドの取得を試みる
                guild = await client.guilds.fetch(config.GUILD_ID);
                if (!guild) {
                    console.error('ギルドが見つかりません。');
                    return;
                }

                // ギルドのチャンネルを取得
                try {
                    // ギルドを再取得して最新の状態にする
                    const freshGuild = await client.guilds.fetch(guild.id);
                    if (!freshGuild) {
                        console.error('ギルドの再取得に失敗');
                        return;
                    }
                    guild = freshGuild;
                    console.log('ギルドの再取得に成功:', guild.name);
                } catch (error) {
                    console.error('ギルドの再取得に失敗:', error);
                    return;
                }

                // ランキングチャンネルの存在確認
                const rankingChannel = await client.channels.fetch(config.RANKING_CHANNEL_ID).catch(() => null);
                if (!rankingChannel) {
                    console.error('ランキングチャンネルが見つかりません。');
                    return;
                }

                console.log('ギルドの取得に成功:', guild.name);
                console.log('ランキングチャンネルの取得に成功:', rankingChannel.name);

                // 起動時にランキング更新を実行
                try {
                    await updatePermanentRankings(guild, redis, notion);
                    console.log('ランキングの更新が完了しました');
                } catch (error) {
                    console.error('起動時のランキング更新でエラーが発生しました:', error);
                }

                // 定期的なランキング更新（1時間ごと）
                cron.schedule('0 * * * *', async () => {
                    try {
                        const currentGuild = await client.guilds.fetch(config.GUILD_ID);
                        if (currentGuild) {
                            // ランキングの更新
                            await updatePermanentRankings(currentGuild, redis, notion);
                        } else {
                            console.error('ギルドが見つかりません。');
                        }
                    } catch (error) {
                        console.error('定期ランキング更新でエラーが発生しました:', error);
                    }
                });

                // 部活チャンネルの並び替え（毎日0時）
                cron.schedule('0 0 * * *', async () => {
                    try {
                        const currentGuild = await client.guilds.fetch(config.GUILD_ID);
                        if (currentGuild) {
                            await sortClubChannels(redis, currentGuild);
                        } else {
                            console.error('ギルドが見つかりません。');
                        }
                    } catch (error) {
                        console.error('部活チャンネルの並び替えでエラーが発生しました:', error);
                    }
                }, {
                    scheduled: true,
                    timezone: "Asia/Tokyo"
                });

            } catch (error) {
                console.error('ギルドの取得に失敗:', error);
                return;
            }

            console.log('ランキングチャンネルID:', config.RANKING_CHANNEL_ID);

            // ランキングメッセージIDをリセット
            await redis.del('level_ranking_message_id');
            await redis.del('coin_ranking_message_id');
            await redis.del('club_ranking_message_id');
            await redis.del('trend_message_id');
            await redis.del('ranking_links_message_id');
            console.log('ランキングメッセージIDをリセットしました');

            // 定期的なランキング更新（1時間ごと）
            cron.schedule('0 * * * *', async () => {
                try {
                    const currentGuild = await client.guilds.fetch(config.GUILD_ID);
                    if (currentGuild) {
                        // ランキングの更新
                        await updatePermanentRankings(currentGuild, redis, notion);
                    } else {
                        console.error('ギルドが見つかりません。');
                    }
                } catch (error) {
                    console.error('定期ランキング更新でエラーが発生しました:', error);
                }
            });

            // 部活チャンネルの並び替え（毎日0時）
            cron.schedule('0 0 * * *', async () => {
                try {
                    const currentGuild = await client.guilds.fetch(config.GUILD_ID);
                    if (currentGuild) {
                        await sortClubChannels(redis, currentGuild);
                    } else {
                        console.error('ギルドが見つかりません。');
                    }
                } catch (error) {
                    console.error('部活チャンネルの並び替えでエラーが発生しました:', error);
                }
            }, {
                scheduled: true,
                timezone: "Asia/Tokyo"
            });

        } catch (error) {
            console.error('readyイベントの実行中にエラーが発生しました:', error);
        }
	},
};
