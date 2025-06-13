const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels } = require('../utils/utility.js');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`Logged in as ${client.user.tag}!`);
        try {
            // 【追加】起動通知機能
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) {
                await notificationChannel.send('再起動しました。確認してください。');
            }

            const anonyChannel = await client.channels.fetch(config.ANONYMOUS_CHANNEL_ID).catch(() => null);
            if (anonyChannel) {
                const payload = { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] };
                await postStickyMessage(client, anonyChannel, config.STICKY_BUTTON_ID, payload);
            }
            const panelChannel = await client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (panelChannel) {
                const payload = { content: '新しい部活を設立するには、下のボタンを押してください。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))] };
                await postStickyMessage(client, panelChannel, config.CREATE_CLUB_BUTTON_ID, payload);
            }
            const counterExists = await redis.exists('anonymous_message_counter');
            if (!counterExists) await redis.set('anonymous_message_counter', 216);
        } catch (error) { console.error('起動時の初期化処理でエラー:', error); }
        
        cron.schedule('0 0 * * 0', async () => {
            console.log('週ごとの部活チャンネル並び替えタスクを開始します...');
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
