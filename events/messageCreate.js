const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage, processFileSafely } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');
const { WebhookClient, EmbedBuilder } = require('discord.js');

// グローバル: 部活チャンネルごとのメッセージ数をメモリ内でカウント
if (!global.dailyMessageBuffer) global.dailyMessageBuffer = {};
const dailyMessageBuffer = global.dailyMessageBuffer;

// メンション機能用のグローバル変数
if (!global.mentionCooldown) global.mentionCooldown = {};
if (!global.mentionHelpCooldown) global.mentionHelpCooldown = {};

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
        const isEveryoneMention = message.mentions.everyone;
        const attachments = message.attachments.filter(att => att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/')));
        const hasMedia = attachments.size > 0;
        const textWithoutMention = message.content.replace(/<@!?\d+>/g, '').trim();
        const hasText = textWithoutMention.length > 0;
        const urlRegex = /https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/gi;
        const hasUrl = urlRegex.test(textWithoutMention);

        // メンションのみの場合の説明表示（サーバー間クールダウン5分）
        if (isMentionToBot && !isReply && !isEveryoneMention && !hasMedia && !hasUrl && !hasText) {
            const now = Date.now();
            const lastHelp = global.mentionHelpCooldown[message.guildId] || 0;
            if (now - lastHelp < config.MENTION_HELP_COOLDOWN) {
                return; // クールダウン中は何もしない
            }
            
            // 使い方案内を表示
            const helpEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📚 Botの使い方')
                .setDescription('Botへのメンション付きで画像や動画、またはリンクを送信すると、代理で投稿します。\n\n**使い方例:**\n@Bot名 画像や動画（＋任意のテキスト）\n@Bot名 https://example.com\n@Bot名 テキストのみ（144文字以内・改行禁止）\n\n※以下の場合は代理投稿されません：\n• 返信メッセージ\n• @everyoneメンション\n\n**ファイル制限:**\n• 画像: 最大10MB\n• 動画: 最大25MB');
            
            await message.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
            global.mentionHelpCooldown[message.guildId] = now;
            return;
        }

        // 返信、everyoneメンション、または添付・リンク・テキストなしの場合は代理投稿しない
        if (isMentionToBot && !isReply && !isEveryoneMention && (hasMedia || hasUrl || hasText)) {
            // ユーザーごとのクールダウンチェック（30秒）
            const now = Date.now();
            const lastMention = global.mentionCooldown[message.author.id] || 0;
            if (now - lastMention < config.MENTION_COOLDOWN) {
                const wait = Math.ceil((config.MENTION_COOLDOWN - (now - lastMention)) / 1000);
                await message.reply({ content: `クールダウン中です。あと${wait}秒お待ちください。`, flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            global.mentionCooldown[message.author.id] = now;

            // テキストのみの場合の文字数・改行チェック
            if (hasText && !hasMedia && !hasUrl) {
                if (textWithoutMention.includes('\n') || textWithoutMention.length > config.MENTION_MAX_LENGTH) {
                    await message.reply({ content: `テキストは改行禁止・${config.MENTION_MAX_LENGTH}文字以内です。`, flags: MessageFlags.Ephemeral }).catch(() => {});
                    return;
                }
            }

            // ファイルサイズチェック
            if (hasMedia) {
                const preparedFiles = [];
                for (const attachment of attachments.values()) {
                    const fileCheck = await processFileSafely(attachment, config);
                    if (!fileCheck.success) {
                        await message.reply({ content: `ファイルエラー: ${fileCheck.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});
                        return;
                    }
                    preparedFiles.push(fileCheck.file);
                }
                // preparedFilesを後段で使用するのでスコープに残す
                message._preparedFiles = preparedFiles;
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
                // 送信内容構築
                const files = hasMedia ? (message._preparedFiles || Array.from(attachments.values())) : Array.from(attachments.values());
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
                    content: content || undefined,
                    files: files,
                    username: displayName,
                    avatarURL: message.author.displayAvatarURL({ dynamic: true }),
                    allowedMentions: { parse: [] },
                    components: [delBtn]
                });
                // 送信者IDとメッセージIDを紐付けて保存（削除権限判定用）
                if (!global.proxyDeleteMap) global.proxyDeleteMap = {};
                global.proxyDeleteMap[sent.id] = message.author.id;
            } catch (error) {
                console.error('メンション代理投稿エラー:', error);
                let errorMessage = '代理投稿に失敗しました。';
                
                // ファイルサイズ関連のエラーの場合
                if (error.message && error.message.includes('size')) {
                    errorMessage = 'ファイルサイズが大きすぎます。Discordの制限（25MB）を確認してください。';
                } else if (error.message && error.message.includes('413')) {
                    errorMessage = 'ファイルサイズが大きすぎます。Discordの制限（25MB）を確認してください。';
                }
                
                await message.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            return;
        }

        // 返信、everyoneメンションの場合の処理
        if (isMentionToBot && (isReply || isEveryoneMention)) {
            // 使い方案内を表示
            const helpEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📚 Botの使い方')
                .setDescription('Botへのメンション付きで画像や動画、またはリンクを送信すると、代理で投稿します。\n\n**使い方例:**\n@Bot名 画像や動画（＋任意のテキスト）\n@Bot名 https://example.com\n@Bot名 テキストのみ（144文字以内・改行禁止）\n\n※以下の場合は代理投稿されません：\n• 返信メッセージ\n• @everyoneメンション\n\n**ファイル制限:**\n• 画像: 最大10MB\n• 動画: 最大25MB');
            await message.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        // --- テキストXP付与処理はここで削除 ---

        // --- 部活チャンネルのメッセージ数カウント（メモリ内のみ） ---
        if (message.channel.parentId === config.CLUB_CATEGORY_ID && !config.EXCLUDED_CHANNELS.includes(message.channel.id)) {
            dailyMessageBuffer[message.channel.id] = (dailyMessageBuffer[message.channel.id] || 0) + 1;
        }
    },
};
