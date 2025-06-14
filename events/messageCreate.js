const { Events } = require('discord.js');
const config = require('../config.js');
const TinySegmenter = require('tiny-segmenter');

const { STOP_WORDS, PHRASES_TO_COMBINE, WORDCLOUD_EXCLUDED_CATEGORY_ID, WORDCLOUD_EXCLUDED_ROLE_ID } = config;

const segmenter = new TinySegmenter();

module.exports = {
	name: Events.MessageCreate,
	async execute(message, redis, notion) {
        if (message.author.bot || !message.inGuild()) return;

        // トレンド用単語の集計・保存処理
        try {
            const isExcludedChannel = config.EXCLUDED_CHANNELS.includes(message.channel.id) || message.channel.parentId === WORDCLOUD_EXCLUDED_CATEGORY_ID;
            const hasExcludedRole = message.member && message.member.roles.cache.has(WORDCLOUD_EXCLUDED_ROLE_ID);

            if (message.content && !isExcludedChannel && !hasExcludedRole) {
                 const cleanContent = message.content
                    .replace(/<@!?&?(\d{17,19})>/g, '')
                    .replace(/<#(\d{17,19})>/g, '')
                    .replace(/<a?:[a-zA-Z0-9_]+:(\d{17,19})>/g, '')
                    .replace(/https?:\/\/\S+/g, '')
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/`[^`]+`/g, '')
                    .replace(/[*_~|]/g, '')
                    .replace(/[!"#$%&'()+,-.\/:;<=>?@[\]^{}~「」『』【】、。！？・’”…]+/g, ' ')
                    .replace(/\s+/g, ' ');
                
                let textToProcess = cleanContent;
                const foundWords = new Set(); // 【修正】このメッセージ内で見つかった単語を記録（重複防止）

                PHRASES_TO_COMBINE.forEach(phrase => {
                    const regex = new RegExp(phrase, 'g');
                    if (regex.test(textToProcess)) {
                        foundWords.add(phrase);
                        textToProcess = textToProcess.replace(regex, '');
                    }
                });

                const tokens = segmenter.segment(textToProcess);
                tokens.forEach(word => {
                    if (word.length > 1 && !STOP_WORDS.has(word)) {
                         if (!/^[0-9]+$/.test(word)) {
                             foundWords.add(word);
                         }
                    }
                });

                // Setから配列に変換し、タイムスタンプを付与
                const now = Date.now();
                const wordsToStore = Array.from(foundWords).map(word => `${word}:${now}`);

                if (wordsToStore.length > 0) {
                    await redis.lpush('trend_words', ...wordsToStore);
                }
            }
        } catch (error) {
            console.error("トレンド単語の集計中にエラー:", error);
        }

        // 部活チャンネルのメッセージ数カウント
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            try {
                 await redis.incr(`weekly_message_count:${message.channel.id}`);
            } catch (error) {
                console.error("Redis message count increment failed:", error);
            }
        }
	},
};

