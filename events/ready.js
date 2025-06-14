const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ActivityType } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
// 【修正】新しい関数名をインポート
const { postStickyMessage, sortClubChannels, updateLevelRoles, calculateTextLevel, calculateVoiceLevel, safeIncrby } = require('../utils/utility.js');

async function postOrEdit(channel, redisKey, payload) { /* ... (この関数は変更なし) ... */ }
async function updatePermanentRankings(guild, redis) { /* ... (この関数は変更なし) ... */ }

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`Logged in as ${client.user.tag}!`);
        client.redis = redis; 
        try {
            const savedStatus = await redis.get('bot_status_text');
            if (savedStatus) client.user.setActivity(savedStatus, { type: ActivityType.Playing });
            const notificationChannel = await client.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID).catch(() => null);
            if (notificationChannel) await notificationChannel.send('再起動しました。確認してください。');
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
        
        cron.schedule('0 0 * * 0', async () => { /* ... (変更なし) ... */ });
	},
};
