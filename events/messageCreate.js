const { Events } = require('discord.js');
const config = require('../config.js');

module.exports = {
	name: Events.MessageCreate,
	async execute(message, redis, notion) {
        if (message.author.bot || !message.inGuild()) return;
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            try {
                 await redis.incr(`weekly_message_count:${message.channel.id}`);
            } catch (error) {
                console.error("Redis message count increment failed:", error);
            }
        }
	},
};
