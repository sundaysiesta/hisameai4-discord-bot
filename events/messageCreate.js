const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { updateLevelRoles, postStickyMessage, safeIncrby } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');

const textXpCooldowns = new Map();
const trendCooldowns = new Map();
const segmenter = new TinySegmenter();

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
            const lastTrendTime = await redis.get(`trend_cooldown:${userId}`);
            if (!lastTrendTime || (now - Number(lastTrendTime) > config.TREND_WORD_COOLDOWN)) {
                const isExcludedChannel = config.EXCLUDED_CHANNELS.includes(message.channel.id) || message.channel.parentId === config.WORDCLOUD_EXCLUDED_CATEGORY_ID;
                const hasExcludedRole = message.member && message.member.roles.cache.has(config.XP_EXCLUDED_ROLE_ID);
                if (message.content && !isExcludedChannel && !hasExcludedRole) {
                     const cleanContent = message.content.replace(/<@!?&?(\d{17,19})>|<#(\d{17,19})>|<a?:[a-zA-Z0-9_]+:(\d{17,19})>|https?:\/\/\S+|```[\s\S]*?```|`[^`]+`|[*_~|]|[!"#$%&'()+,-.\/:;<=>?@[\]^{}~「」『』【】、。！？・’”…]+/g, ' ').replace(/\s+/g, ' ');
                    let textToProcess = cleanContent;
                    const foundWords = new Set(); 
                    config.PHRASES_TO_COMBINE.forEach(phrase => {
                        const regex = new RegExp(phrase, 'g');
                        if (regex.test(textToProcess)) {
                            foundWords.add(phrase);
                            textToProcess = textToProcess.replace(regex, '');
                        }
                    });
                    const tokens = segmenter.segment(textToProcess);
                    tokens.forEach(word => {
                        if (word.length > 1 && !config.STOP_WORDS.has(word)) {
                             if (!/^[0-9]+$/.test(word)) foundWords.add(word);
                        }
                    });
                    const wordsToStore = Array.from(foundWords).map(word => `${word}:${userId}:${now}`);
                    if (wordsToStore.length > 0) {
                        await redis.lpush('trend_words', ...wordsToStore);
                        await redis.set(`trend_cooldown:${userId}`, now, { ex: 125 });
                    }
                }
            }
        } catch (error) { console.error("トレンド単語の集計中にエラー:", error); }
        
        // --- 部活チャンネルのメッセージ数カウント ---
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            await redis.incr(`weekly_message_count:${message.channel.id}`);
        }
	},
};
