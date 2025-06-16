const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { updateLevelRoles, postStickyMessage } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');

const textXpCooldowns = new Map();
const trendCooldowns = new Map();
const segmenter = new TinySegmenter();

// メモリリーク防止のためのクリーンアップ関数
function cleanupCooldowns() {
    const now = Date.now();
    for (const [userId, timestamp] of textXpCooldowns.entries()) {
        if (now - timestamp > config.TEXT_XP_COOLDOWN * 2) {
            textXpCooldowns.delete(userId);
        }
    }
    for (const [userId, timestamp] of trendCooldowns.entries()) {
        if (now - timestamp > config.TREND_WORD_COOLDOWN * 2) {
            trendCooldowns.delete(userId);
        }
    }
}

// 5分ごとにクリーンアップを実行
setInterval(cleanupCooldowns, 5 * 60 * 1000);

module.exports = {
    name: Events.MessageCreate,
    async execute(message, redis, notion) {
        if (message.webhookId && message.channel.id === config.ANONYMOUS_CHANNEL_ID) {
            const payload = { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] };
            await postStickyMessage(message.client, message.channel, config.STICKY_BUTTON_ID, payload);
            return;
        }
        if (message.author.bot || !message.inGuild()) return;

        const now = Date.now();
        const userId = message.author.id;

        // --- XP獲得処理 ---
        try {
            if (message.member && !message.member.roles.cache.has(config.XP_EXCLUDED_ROLE_ID)) {
                const lastXpTime = textXpCooldowns.get(userId);
                if (!lastXpTime || (now - lastXpTime > config.TEXT_XP_COOLDOWN)) {
                    const mainAccountId = await redis.hget(`user:${userId}`, 'mainAccountId') || userId;
                    const mainMember = await message.guild.members.fetch(mainAccountId).catch(() => null);
                    if (mainMember) {
                        const xpToGive = Math.floor(Math.random() * (config.MAX_TEXT_XP - config.MIN_TEXT_XP + 1)) + config.MIN_TEXT_XP;
                        
                        // ユーザーデータの初期化と更新を一連の処理で実行
                        const userKey = `user:${mainAccountId}`;
                        const monthlyKey = `monthly_xp:text:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
                        const dailyKey = `daily_xp:text:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;

                        // Redis Multi/Execを使用してアトミックな操作を実行
                        const multi = redis.multi();

                        // ユーザーデータの初期化
                        const userData = await redis.hgetall(userKey);
                        if (!userData || Object.keys(userData).length === 0) {
                            multi.hset(userKey, 'textXp', '0', 'voiceXp', '0');
                        } else {
                            if (!userData.textXp) multi.hset(userKey, 'textXp', '0');
                            if (!userData.voiceXp) multi.hset(userKey, 'voiceXp', '0');
                        }

                        // 月間・日間XPの初期化と更新
                        const [monthlyExists, dailyExists] = await Promise.all([
                            redis.exists(monthlyKey),
                            redis.exists(dailyKey)
                        ]);

                        if (!monthlyExists) multi.set(monthlyKey, '0');
                        if (!dailyExists) multi.set(dailyKey, '0');

                        // XPの更新
                        multi.hincrby(userKey, 'textXp', xpToGive);
                        multi.incrby(monthlyKey, xpToGive);
                        multi.incrby(dailyKey, xpToGive);

                        // TTLの設定
                        multi.expire(monthlyKey, 60 * 60 * 24 * 32); // 32日
                        multi.expire(dailyKey, 60 * 60 * 24 * 2);    // 2日

                        // すべての操作を実行
                        await multi.exec();
                        
                        textXpCooldowns.set(userId, now);
                        await updateLevelRoles(mainMember, redis, message.client);
                    }
                }
            }
        } catch(error) { console.error('テキストXP付与エラー:', error); }

        // --- トレンド単語集計処理 ---
        try {
            const lastTrendTime = trendCooldowns.get(userId);
            if (!lastTrendTime || (now - lastTrendTime > config.TREND_WORD_COOLDOWN)) {
                const content = message.content
                    .replace(/<@!?&?(\d{17,19})>/g, '')
                    .replace(/<#(\d{17,19})>/g, '')
                    .replace(/<a?:[a-zA-Z0-9_]+:(\d{17,19})>/g, '')
                    .replace(/https?:\/\/\S+/g, '')
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/`[^`]+`/g, '')
                    .replace(/[*_~|]/g, '')
                    .replace(/[!"#$%&'()+,-.\/:;<=>?@[\]^{}~「」『』【】、。！？・'"…]+/g, ' ')
                    .replace(/\s+/g, ' ');

                const words = segmenter.segment(content)
                    .filter(word => 
                        word.length > 1 && 
                        !config.STOP_WORDS.has(word) && 
                        !/^[a-zA-Z0-9]+$/.test(word) &&
                        !/^\d+$/.test(word)
                    );

                // 重複を排除
                const uniqueWords = [...new Set(words)];
                if (uniqueWords.length > 0) {
                    const timestamp = Date.now().toString();
                    const multi = redis.multi();

                    // トレンド単語の追加とTTLの設定
                    const trendEntries = uniqueWords.map(word => `${word}:${userId}:${timestamp}`);
                    multi.lpush('trend_words', ...trendEntries);
                    multi.expire('trend_words', config.TREND_WORD_LIFESPAN);

                    await multi.exec();
                    trendCooldowns.set(userId, now);
                }
            }
        } catch (error) { console.error('トレンド処理エラー:', error); }
        
        // --- 部活チャンネルのメッセージ数カウント ---
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            try {
                const key = `weekly_message_count:${message.channel.id}`;
                const exists = await redis.exists(key);
                if (!exists) {
                    await redis.set(key, '0');
                    await redis.expire(key, 60 * 60 * 24 * 8); // 8日
                }
                await redis.incr(key);
            } catch (error) {
                console.error('部活メッセージカウントエラー:', error);
            }
        }
    },
};
