const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { updateLevelRoles, postStickyMessage } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');

const textXpCooldowns = new Map();
const segmenter = new TinySegmenter();

// メモリリーク防止のためのクリーンアップ関数
function cleanupCooldowns() {
    const now = Date.now();
    for (const [userId, timestamp] of textXpCooldowns.entries()) {
        if (now - timestamp > config.TEXT_XP_COOLDOWN * 2) {
            textXpCooldowns.delete(userId);
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
                        if (!xpToGive || isNaN(xpToGive)) {
                            console.log(`[テキストXP] ${mainMember.user.tag} のXP付与をスキップ: 不正なXP値`);
                            return;
                        }

                        // ユーザーデータの初期化と更新を一連の処理で実行
                        const userKey = `user:${mainAccountId}`;
                        const monthlyKey = `monthly_xp:text:${new Date().toISOString().slice(0, 7)}:${mainAccountId}`;
                        const dailyKey = `daily_xp:text:${new Date().toISOString().slice(0, 10)}:${mainAccountId}`;

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
                                    voiceXp: '0'
                                });
                                console.log(`[テキストXP] ${mainMember.user.tag} のユーザーデータを初期化しました`);
                            }

                            // 月間・日間XPの初期化（必要な場合）
                            if (!monthlyExists) {
                                await redis.set(monthlyKey, '0');
                                console.log(`[テキストXP] ${mainMember.user.tag} の月間XPデータを初期化しました`);
                            }
                            if (!dailyExists) {
                                await redis.set(dailyKey, '0');
                                console.log(`[テキストXP] ${mainMember.user.tag} の日間XPデータを初期化しました`);
                            }

                            // XPの更新（個別に実行して確実性を高める）
                            await Promise.all([
                                redis.hincrby(userKey, 'textXp', xpToGive),
                                redis.incrby(monthlyKey, xpToGive),
                                redis.incrby(dailyKey, xpToGive),
                                redis.expire(monthlyKey, 60 * 60 * 24 * 32),  // 32日
                                redis.expire(dailyKey, 60 * 60 * 24 * 2)      // 2日
                            ]);
                            
                            textXpCooldowns.set(userId, now);
                            await updateLevelRoles(mainMember, redis, message.client);
                            console.log(`[テキストXP] ${mainMember.user.tag} に ${xpToGive} XPを付与しました（メインアカウント: ${mainMember.user.tag}）`);
                        } catch (error) {
                            console.error(`[テキストXP] ${mainMember.user.tag} のXP付与中にエラー:`, error);
                        }
                    }
                }
            }
        } catch(error) { console.error('テキストXP付与エラー:', error); }

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
