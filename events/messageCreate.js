const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { updateLevelRoles, postStickyMessage, safeIncrby } = require('../utils/utility.js');
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
                        
                        const monthlyKey = `monthly_xp:text:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
                        const dailyKey = `daily_xp:text:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;
                        
                        await redis.hincrby(`user:${mainAccountId}`, 'textXp', xpToGive);
                        await safeIncrby(redis, monthlyKey, xpToGive);
                        await safeIncrby(redis, dailyKey, xpToGive);
                        
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

                const uniqueWords = [...new Set(words)];
                const pipelineMulti = redis.pipeline();
                const now = Date.now().toString();

                for (const word of uniqueWords) {
                    // ワードの出現回数をインクリメント
                    pipelineMulti.hincrby('trend_words', word, 1);
                    // ワードの最終更新時刻を設定
                    pipelineMulti.hset('trend_words_timestamps', word, now);
                }

                await pipelineMulti.exec();
                trendCooldowns.set(userId, Date.now());
            }
        } catch (error) { console.error('トレンド処理エラー:', error); }
        
        // --- 部活チャンネルのメッセージ数カウント ---
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            await redis.incr(`weekly_message_count:${message.channel.id}`);
        }
	},
};
