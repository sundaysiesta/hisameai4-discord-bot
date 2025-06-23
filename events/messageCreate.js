const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');

// テキストXP関連のクールダウンや付与処理は削除

module.exports = {
    name: Events.MessageCreate,
    async execute(message, redis, notion) {
        if (message.webhookId && message.channel.id === config.ANONYMOUS_CHANNEL_ID) {
            const payload = { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] };
            await postStickyMessage(message.client, message.channel, config.STICKY_BUTTON_ID, payload);
            return;
        }
        if (message.author.bot || !message.inGuild()) return;

        // --- テキストXP付与処理はここで削除 ---

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
