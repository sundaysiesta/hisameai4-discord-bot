const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ActivityType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels, updateLevelRoles, calculateTextLevel, calculateVoiceLevel, safeIncrby } = require('../utils/utility.js');

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

async function updatePermanentRankings(guild, redis) {
    const rankingChannel = await guild.client.channels.fetch(config.RANKING_CHANNEL_ID).catch(() => null);
    if (!rankingChannel) return;

    await guild.members.fetch();
    await guild.roles.fetch();

    let levelMessage, clubMessage, trendMessage;

    // --- レベルランキング ---
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
            } catch (e) {
                if (e.message.includes("WRONGTYPE")) console.log(`Corrupted key ${key} found during ranking update. It will be fixed on next user activity.`);
                else console.error(e);
            }
        }
        const voiceUsers = [];
        for (const key of voiceKeys) {
             try {
                const xp = await redis.get(key);
                if (xp !== null && !isNaN(xp)) voiceUsers.push({ userId: key.split(':')[3], xp: Number(xp) });
            } catch (e) {
                if (e.message.includes("WRONGTYPE")) console.log(`Corrupted key ${key} found during ranking update. It will be fixed on next user activity.`);
                else console.error(e);
            }
        }

        const top20Text = textUsers.sort((a,b)=>b.xp - a.xp).slice(0, 20);
        const top20Voice = voiceUsers.sort((a,b)=>b.xp - a.xp).slice(0, 20);
        
        let textDesc = top20Text.map((u, i) => `**${i+1}位:** <@${u.userId}> - Lv.${calculateTextLevel(u.xp)} (${u.xp} XP)`).join('\n') || 'まだ誰もXPを獲得していません。';
        let voiceDesc = top20Voice.map((u, i) => `**${i+1}位:** <@${u.userId}> - Lv.${calculateVoiceLevel(u.xp)} (${u.xp} XP)`).join('\n') || 'まだ誰もXPを獲得していません。';

        const levelEmbed = new EmbedBuilder().setTitle(`月間レベルランキング (${titleDate})`).setColor(0xFFD700).addFields(
            { name: '💬 テキスト', value: textDesc, inline: true },
            { name: '🎤 ボイス', value: voiceDesc, inline: true }
        ).setTimestamp();
        levelMessage = await postOrEdit(rankingChannel, 'level_ranking_message_id', { embeds: [levelEmbed] });
    } catch (e) { console.error("レベルランキング更新エラー:", e); }

    // --- 部活ランキング ---
    try {
        const clubCategory = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
        let clubRankingEmbed = new EmbedBuilder().setTitle('部活アクティブランキング (週間)').setColor(0x82E0AA).setTimestamp();
        if (clubCategory) {
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
                     const leaderRoleId = await redis.get(`leader_roles:${club.id}`);
                     let leaderMention = '未設定';
                     if (leaderRoleId) {
                         const role = guild.roles.cache.get(leaderRoleId);
                         if (role) leaderMention = role.members.size > 0 ? role.members.map(m => m.toString()).join(', ') : '不在';
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
    
    // --- トレンドランキング ---
    try {
        const now = Date.now();
        const cutoff = now - config.TREND_WORD_LIFESPAN;
        const wordEntries = await redis.lrange('trend_words', 0, -1);
        const wordsToKeep = [];
        const wordData = {};
        wordEntries.forEach(entry => {
            const [word, userId, timestamp] = entry.split(':');
            if (Number(timestamp) >= cutoff) {
                wordsToKeep.push(entry);
                if (!wordData[word]) wordData[word] = { count: 0, users: new Set() };
                wordData[word].count++;
                wordData[word].users.add(userId);
            }
        });
        if (wordsToKeep.length < wordEntries.length) {
            await redis.del('trend_words');
            if (wordsToKeep.length > 0) await redis.lpush('trend_words', ...wordsToKeep);
        }
        const trendRanking = Object.entries(wordData).map(([word, data]) => ({ word: word, score: data.count * data.users.size })).sort((a, b) => b.score - a.score).slice(0, 20);
        const trendEmbed = new EmbedBuilder().setTitle('サーバー内トレンド (過去24時間)').setColor(0x1DA1F2).setTimestamp();
        if (trendRanking.length === 0) {
            trendEmbed.setDescription('現在、トレンドはありません。');
        } else {
            trendEmbed.setDescription(trendRanking.map((item, index) => `**${index + 1}位:** ${item.word} (スコア: ${item.score})`).join('\n'));
        }
        trendMessage = await postOrEdit(rankingChannel, 'trend_message_id', { embeds: [trendEmbed] });
    } catch (e) { console.error("トレンドランキング更新エラー:", e); }
    
    // --- リンクボタン ---
    try {
        const payload = { content: '各ランキングへ移動:', components: [] };
        const linkButtons = new ActionRowBuilder();
        if (levelMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('レベルランキングへ').setStyle(ButtonStyle.Link).setURL(levelMessage.url));
        if (clubMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('部活ランキングへ').setStyle(ButtonStyle.Link).setURL(clubMessage.url));
        if (trendMessage) linkButtons.addComponents(new ButtonBuilder().setLabel('トレンドへ').setStyle(ButtonStyle.Link).setURL(trendMessage.url));

        if (linkButtons.components.length > 0) {
            payload.components.push(linkButtons);
        }
        await postOrEdit(rankingChannel, 'ranking_links_message_id', payload);
    } catch(e){ console.error("リンクボタン更新エラー:", e); }
}

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`Logged in as ${client.user.tag}!`);
        client.redis = redis; 
        try {
            const savedStatus = await redis.get('bot_status_text');
            if (savedStatus) client.user.setActivity(savedStatus, { type: ActivityType.Playing });

            // 【修正】再起動通知をEmbed形式に変更し、Gitのコミット情報を含める
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) {
                const commitHash = process.env.GIT_COMMIT_SHA || '不明';
                // GitHubリポジトリのURLをハードコード（必要に応じて変更してください）
                const repoUrl = 'https://github.com/sundaysiesta/hisameai4-discord-bot';
                
                const embed = new EmbedBuilder()
                    .setTitle('🤖 Botが再起動しました')
                    .setColor(0x3498DB)
                    .setDescription('新しいバージョンがデプロイされました。')
                    .setTimestamp();
                
                if (commitHash !== '不明' && commitHash.length >= 7) {
                    // コミットハッシュへのリンクをフィールドに追加
                    embed.addFields({ name: '現在のバージョン (コミット)', value: `[${commitHash.substring(0, 7)}](${repoUrl}/commit/${commitHash})` });
                } else {
                    embed.addFields({ name: '現在のバージョン (コミット)', value: '`不明`' });
                }

                await notificationChannel.send({ embeds: [embed] });
            }
            
            // 既存の初期化処理
            const anonyChannel = await client.channels.fetch(config.ANONYMOUS_CHANNEL_ID).catch(() => null);
            if (anonyChannel) await postStickyMessage(client, anonyChannel, config.STICKY_BUTTON_ID, { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] });
            const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (panelChannel) await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, { content: '新しい部活を設立するには、下のボタンを押してください。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))] });
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) await redis.set('anonymous_message_counter', 216);
        } catch (error) { console.error('起動時の初期化処理でエラー:', error); }

        cron.schedule(config.RANKING_UPDATE_INTERVAL, async () => {
            const guild = client.guilds.cache.first();
            if (!guild) return;
            const voiceStates = guild.voiceStates.cache;
            const activeVCs = new Map();
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
                            const mainAccountId = await redis.hget(`user:${member.id}`, 'mainAccountId') || member.id;
                            const mainMember = await guild.members.fetch(mainAccountId).catch(() => null);
                            if (!mainMember) continue;
                            const xp = config.VOICE_XP_AMOUNT;
                            const monthlyKey = `monthly_xp:voice:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
                            const dailyKey = `daily_xp:voice:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;
                            
                            await redis.hincrby(`user:${mainAccountId}`, 'voiceXp', xp);
                            await safeIncrby(redis, monthlyKey, xp);
                            await safeIncrby(redis, dailyKey, xp);
                            await redis.set(cooldownKey, now, { ex: 125 });
                            await updateLevelRoles(mainMember, redis, client);
                        }
                    }
                }
            }
            await updatePermanentRankings(guild, redis);
        });
        
        cron.schedule('0 0 * * 0', async () => {
            try {
                const guild = client.guilds.cache.first();
                if (!guild) return;
                await sortClubChannels(redis, guild);
                const category = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
                if (!category) return;
                const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
                if (clubChannels.size > 0) {
                    const redisPipeline = redis.pipeline();
                    for (const channelId of clubChannels.keys()) {
                        redisPipeline.set(`weekly_message_count:${channelId}`, 0);
                    }
                    await redisPipeline.exec();
                }
                console.log('部活チャンネルの並び替えとカウンターリセットが完了しました。');
            } catch (error) { console.error('週次タスク中にエラー:', error); }
        }, { scheduled: true, timezone: "Asia/Tokyo" });
	},
};
