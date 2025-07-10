const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');
const { WebhookClient, EmbedBuilder } = require('discord.js');

// グローバル: 部活チャンネルごとのメッセージ数をメモリ内でカウント
if (!global.dailyMessageBuffer) global.dailyMessageBuffer = {};
const dailyMessageBuffer = global.dailyMessageBuffer;

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

        // --- ここからメンション付き画像/動画代理投稿機能 ---
        const clientUser = message.client.user;
        const isMentionToBot = message.mentions.has(clientUser);
        const isReply = !!message.reference;
        const attachments = message.attachments.filter(att => att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/')));
        const hasMedia = attachments.size > 0;
        const hasText = message.content.replace(/<@!?\d+>/g, '').trim().length > 0;

        if (isMentionToBot) {
            if (!isReply && hasMedia) {
                // webhook取得または作成
                let webhook = null;
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.owner && wh.owner.id === clientUser.id);
                if (!webhook) {
                    webhook = await message.channel.createWebhook({
                        name: message.author.username,
                        avatar: message.author.displayAvatarURL({ dynamic: true })
                    });
                } else {
                    // 名前・アイコンを最新に
                    await webhook.edit({
                        name: message.author.username,
                        avatar: message.author.displayAvatarURL({ dynamic: true })
                    });
                }
                // 送信内容構築
                const files = Array.from(attachments.values());
                let content = hasText ? message.content.replace(`<@${clientUser.id}>`, '').trim() : '';
                await webhook.send({
                    content: content || undefined,
                    files: files,
                    username: message.author.username,
                    avatarURL: message.author.displayAvatarURL({ dynamic: true }),
                    allowedMentions: { parse: [] }
                });
                await message.delete().catch(() => {});
                return;
            } else {
                // 返信 or 添付なし: 使い方案内
                const helpEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('📚 Botの使い方')
                    .setDescription('Botへのメンション付きで画像や動画を送信すると、代理で投稿します。\n\n**使い方例:**\n@Bot名 画像や動画（＋任意のテキスト）\n\n※メンションのみや返信、添付ファイルがない場合は代理投稿されません。');
                await message.reply({ embeds: [helpEmbed], ephemeral: true }).catch(() => {});
                return;
            }
        }

        // --- テキストXP付与処理はここで削除 ---

        // --- 部活チャンネルのメッセージ数カウント（メモリ内のみ） ---
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            dailyMessageBuffer[message.channel.id] = (dailyMessageBuffer[message.channel.id] || 0) + 1;
        }
    },
};
