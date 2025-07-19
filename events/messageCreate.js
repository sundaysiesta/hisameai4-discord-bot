const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const memoryManager = require('../utils/memoryManager');

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

        // --- ここからメンション付き画像/動画/リンク代理投稿機能 ---
        const clientUser = message.client.user;
        const isMentionToBot = message.mentions.has(clientUser);
        const isReply = !!message.reference;
        const attachments = message.attachments.filter(att => att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/')));
        const hasMedia = attachments.size > 0;
        const textWithoutMention = message.content.replace(/<@!?\d+>/g, '').trim();
        const hasText = textWithoutMention.length > 0;
        const urlRegex = /https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/gi;
        const hasUrl = urlRegex.test(textWithoutMention);

        if (isMentionToBot) {
            // メモリ使用量チェック
            if (!memoryManager.checkMemoryUsage()) {
                await message.reply({ 
                    content: 'システムの負荷が高いため、しばらく待ってから再試行してください。', 
                    flags: MessageFlags.Ephemeral 
                }).catch(() => {});
                return;
            }

            if (!isReply && (hasMedia || hasUrl)) {
                // ファイルサイズ制限チェック
                const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
                const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 合計50MB
                let totalSize = 0;

                for (const attachment of attachments.values()) {
                    const sizeValidation = memoryManager.validateFileSize(attachment.size, MAX_FILE_SIZE);
                    if (!sizeValidation.valid) {
                        await message.reply({ 
                            content: `ファイル「${attachment.name}」のサイズが大きすぎます。最大25MBまで対応しています。`, 
                            flags: MessageFlags.Ephemeral 
                        }).catch(() => {});
                        return;
                    }
                    totalSize += attachment.size;
                }

                if (totalSize > MAX_TOTAL_SIZE) {
                    await message.reply({ 
                        content: `添付ファイルの合計サイズが大きすぎます。最大50MBまで対応しています。`, 
                        flags: MessageFlags.Ephemeral 
                    }).catch(() => {});
                    return;
                }

                // ファイル形式チェック
                const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
                const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

                for (const attachment of attachments.values()) {
                    const typeValidation = memoryManager.validateFileType(attachment.contentType, allowedTypes);
                    if (!typeValidation.valid) {
                        await message.reply({ 
                            content: `ファイル「${attachment.name}」の形式がサポートされていません。画像（JPEG、PNG、GIF、WebP）または動画（MP4、WebM、MOV）のみ対応しています。`, 
                            flags: MessageFlags.Ephemeral 
                        }).catch(() => {});
                        return;
                    }
                }

                // クールダウン管理
                const cooldownCheck = memoryManager.checkProxyCooldown(message.author.id, 10 * 1000);
                if (cooldownCheck.onCooldown) {
                    await message.reply({ 
                        content: `クールダウン中です。あと${cooldownCheck.remainingTime}秒お待ちください。`, 
                        flags: MessageFlags.Ephemeral 
                    }).catch(() => {});
                    return;
                }

                try {
                    // webhook取得または作成
                    let webhook = null;
                    const webhooks = await message.channel.fetchWebhooks();
                    webhook = webhooks.find(wh => wh.owner && wh.owner.id === clientUser.id);
                    // サーバーニックネーム取得
                    let displayName = message.member ? message.member.displayName : message.author.username;
                    if (!webhook) {
                        webhook = await message.channel.createWebhook({
                            name: displayName,
                            avatar: message.author.displayAvatarURL({ dynamic: true })
                        });
                    } else {
                        // 名前・アイコンを最新に
                        await webhook.edit({
                            name: displayName,
                            avatar: message.author.displayAvatarURL({ dynamic: true })
                        });
                    }

                    // 安全なファイル処理
                    const files = [];
                    for (const attachment of attachments.values()) {
                        try {
                            const buffer = await memoryManager.processFileSafely(attachment.url, MAX_FILE_SIZE);
                            const { AttachmentBuilder } = require('discord.js');
                            const fileAttachment = new AttachmentBuilder(buffer, {
                                name: attachment.name,
                                description: attachment.description
                            });
                            files.push(fileAttachment);
                        } catch (fileError) {
                            console.error('ファイル処理エラー:', fileError);
                            await message.reply({ 
                                content: `ファイル「${attachment.name}」の処理に失敗しました。`, 
                                flags: MessageFlags.Ephemeral 
                            }).catch(() => {});
                            return;
                        }
                    }

                    // 送信内容構築
                    let content = textWithoutMention;
                    // 削除ボタン追加
                    const delBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`delete_proxy_${message.id}`)
                            .setLabel('削除')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🗑️')
                    );

                    // メッセージ削除を並列で実行
                    message.delete().catch(() => {});

                    const sent = await webhook.send({
                        content: (content || hasUrl) ? content : undefined,
                        files: files,
                        username: displayName,
                        avatarURL: message.author.displayAvatarURL({ dynamic: true }),
                        allowedMentions: { parse: [] },
                        components: [delBtn]
                    });

                    // 送信者IDとメッセージIDを紐付けて保存（削除権限判定用）
                    if (!global.proxyDeleteMap) global.proxyDeleteMap = {};
                    global.proxyDeleteMap[sent.id] = message.author.id;

                    // 投稿後のメモリクリーンアップ
                    memoryManager.forceCleanup();

                } catch (error) {
                    console.error('代理投稿エラー:', error);
                    await message.reply({ 
                        content: '代理投稿に失敗しました。しばらく待ってから再試行してください。', 
                        flags: MessageFlags.Ephemeral 
                    }).catch(() => {});
                }
                return;
            } else {
                // 返信 or 添付・リンクなし: 使い方案内
                const helpEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('📚 Botの使い方')
                    .setDescription('Botへのメンション付きで画像や動画、またはリンクを送信すると、代理で投稿します。\n\n**使い方例:**\n@Bot名 画像や動画（＋任意のテキスト）\n@Bot名 https://example.com\n\n※メンションのみや返信、添付ファイル・リンクがない場合は代理投稿されません。\n※ファイルサイズは最大25MB、合計50MBまで対応しています。');
                await message.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
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
