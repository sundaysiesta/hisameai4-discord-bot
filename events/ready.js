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

async function updatePermanentRankings(client, guild, redis, notion) {
    try {
        console.log('updatePermanentRankings開始');
        
        // guildが正しく取得できているか確認
        if (!guild) {
            console.error('ギルドが未定義です');
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

        // レベルランキング
        try {
            const levelRanking = await redis.zRange('user_levels', 0, 9, { REV: true, WITHSCORES: true });
            const levelMembers = await Promise.all(
                levelRanking
                    .filter((_, i) => i % 2 === 0)
                    .map(async (userId) => {
                        try {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (!member) {
                                console.error(`メンバー取得エラー ${userId}: メンバーが見つかりません`);
                                return null;
                            }
                            return member;
                        } catch (error) {
                            console.error(`メンバー取得エラー ${userId}:`, error);
                            return null;
                        }
                    })
            );

            const validLevelMembers = levelMembers.filter(m => m !== null);
            if (validLevelMembers.length > 0) {
                const levelEmbed = new EmbedBuilder()
                    .setTitle('🏆 レベルランキング')
                    .setColor('#FFD700')
                    .setDescription(
                        validLevelMembers
                            .map((member, index) => {
                                const level = parseInt(levelRanking[index * 2 + 1]);
                                return `${index + 1}. ${member} - レベル ${level}`;
                            })
                            .join('\n')
                    )
                    .setTimestamp();

                levelMessage = await rankingChannel.send({ embeds: [levelEmbed] });
                await redis.set('level_ranking_message_id', levelMessage.id);
            }
        } catch (error) {
            console.error('レベルランキングの更新に失敗:', error);
        }

        // コインランキング
        try {
            const coinRanking = await redis.zRange('user_coins', 0, 9, { REV: true, WITHSCORES: true });
            const coinMembers = await Promise.all(
                coinRanking
                    .filter((_, i) => i % 2 === 0)
                    .map(async (userId) => {
                        try {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (!member) {
                                console.error(`コインランキングメンバー取得エラー ${userId}: メンバーが見つかりません`);
                                return null;
                            }
                            return member;
                        } catch (error) {
                            console.error(`コインランキングメンバー取得エラー ${userId}:`, error);
                            return null;
                        }
                    })
            );

            const validCoinMembers = coinMembers.filter(m => m !== null);
            if (validCoinMembers.length > 0) {
                const coinEmbed = new EmbedBuilder()
                    .setTitle('💰 コインランキング')
                    .setColor('#FFD700')
                    .setDescription(
                        validCoinMembers
                            .map((member, index) => {
                                const coins = parseInt(coinRanking[index * 2 + 1]);
                                return `${index + 1}. ${member} - ${coins}コイン`;
                            })
                            .join('\n')
                    )
                    .setTimestamp();

                coinMessage = await rankingChannel.send({ embeds: [coinEmbed] });
                await redis.set('coin_ranking_message_id', coinMessage.id);
            }
        } catch (error) {
            console.error('コインランキングの更新に失敗:', error);
        }

        // 部活ランキング
        try {
            const clubCategory = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
            if (!clubCategory) {
                console.error('部活カテゴリの取得に失敗: カテゴリが見つかりません');
                return;
            }

            const clubChannels = clubCategory.children.cache.filter(channel => 
                channel.type === ChannelType.GuildVoice && 
                channel.members.size > 0
            );

            const clubRanking = Array.from(clubChannels.values())
                .map(channel => ({
                    name: channel.name,
                    members: channel.members.size
                }))
                .sort((a, b) => b.members - a.members)
                .slice(0, 10);

            if (clubRanking.length > 0) {
                const clubEmbed = new EmbedBuilder()
                    .setTitle('🎮 部活ランキング')
                    .setColor('#FFD700')
                    .setDescription(
                        clubRanking
                            .map((club, index) => `${index + 1}. ${club.name} - ${club.members}人`)
                            .join('\n')
                    )
                    .setTimestamp();

                clubMessage = await rankingChannel.send({ embeds: [clubEmbed] });
                await redis.set('club_ranking_message_id', clubMessage.id);
            }
        } catch (error) {
            console.error('部活ランキングの更新に失敗:', error);
        }

        // トレンドワード
        try {
            const trendWords = await redis.zRange('trend_words', 0, 9, { REV: true, WITHSCORES: true });
            if (trendWords.length > 0) {
                const trendEmbed = new EmbedBuilder()
                    .setTitle('🔥 トレンドワード')
                    .setColor('#FFD700')
                    .setDescription(
                        trendWords
                            .filter((_, i) => i % 2 === 0)
                            .map((word, index) => `${index + 1}. ${word}`)
                            .join('\n')
                    )
                    .setTimestamp();

                trendMessage = await rankingChannel.send({ embeds: [trendEmbed] });
                await redis.set('trend_message_id', trendMessage.id);
            }
        } catch (error) {
            console.error('トレンドワードの更新に失敗:', error);
        }

        console.log('ランキングの更新が完了しました');
    } catch (error) {
        console.error('ランキング更新でエラーが発生しました:', error);
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
                    await updatePermanentRankings(client, guild, redis, notion);
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
                            await updatePermanentRankings(client, currentGuild, redis, notion);
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
            console.log('ランキングメッセージIDをリセットしました');

            // 定期的なランキング更新（1時間ごと）
            cron.schedule('0 * * * *', async () => {
                try {
                    const currentGuild = await client.guilds.fetch(config.GUILD_ID);
                    if (currentGuild) {
                        // ランキングの更新
                        await updatePermanentRankings(client, currentGuild, redis, notion);
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
