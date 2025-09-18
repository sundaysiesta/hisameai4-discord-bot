const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const config = require('../config.js');
const { processFileSafely } = require('../utils/utility.js');
const { shouldRevealAnonymous, createRevealedEmbed } = require('../utils/anonymousEvent.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anonymous')
        .setDescription('匿名でメッセージを投稿します。')
        .addStringOption(option =>
            option.setName('内容')
                .setDescription('投稿内容（改行禁止・144文字以内）')
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('添付ファイル')
                .setDescription('画像や動画などの添付ファイル（最大25MB）')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('アイコン')
                .setDescription('表示用アイコン画像（最大10MB）')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('名前')
                .setDescription('表示名（未入力の場合は「名無しのロメダ民」）')
                .setRequired(false)
        ),
    async execute(interaction) {
        // クールダウン管理
        if (!global.anonymousCooldown) global.anonymousCooldown = {};
        const now = Date.now();
        const last = global.anonymousCooldown[interaction.user.id] || 0;
        if (now - last < 30 * 1000) {
            const wait = Math.ceil((30 * 1000 - (now - last)) / 1000);
            return interaction.reply({ content: `クールダウン中です。あと${wait}秒お待ちください。`, ephemeral: true });
        }
        global.anonymousCooldown[interaction.user.id] = now;

        const content = interaction.options.getString('内容');
        const file = interaction.options.getAttachment('添付ファイル');
        const icon = interaction.options.getAttachment('アイコン');
        const nameOpt = interaction.options.getString('名前');

        if (content.includes('\n') || content.length > 144) {
            return interaction.reply({ content: '内容は改行禁止・144文字以内です。', ephemeral: true });
        }

        // ファイルサイズチェック
        if (file) {
            const fileCheck = await processFileSafely(file, config);
            if (!fileCheck.success) {
                return interaction.reply({ content: `添付ファイルエラー: ${fileCheck.error}`, ephemeral: true });
            }
        }

        if (icon) {
            const iconCheck = await processFileSafely(icon, config);
            if (!iconCheck.success) {
                return interaction.reply({ content: `アイコンファイルエラー: ${iconCheck.error}`, ephemeral: true });
            }
        }

        // 匿名ID生成
        const salt = process.env.ANONYMOUS_SALT || '';
        const date = new Date().toISOString().slice(0, 10);
        const hash = crypto.createHash('sha256').update(interaction.user.id + date + salt).digest('hex').slice(0, 8);
        const displayNameRaw = (nameOpt && nameOpt.trim().length > 0) ? nameOpt.trim() : '名無しのロメダ民';
        const displayName = `${displayNameRaw} ID: ${hash}`;

        // 匿名剥がれチェック（常に1%の確率）
        const shouldReveal = shouldRevealAnonymous();
        let finalDisplayName = displayName;
        let finalAvatar = icon ? icon.url : null;
        let isRevealed = false;

        if (shouldReveal) {
            // 匿名が剥がれる場合 - 名前やアイコンのオプションは無効化
            finalDisplayName = interaction.user.username;
            finalAvatar = interaction.user.displayAvatarURL();
            isRevealed = true;
            
            // 匿名が剥がれた場合は名前やアイコンのオプションを無視
            if (nameOpt || icon) {
                console.log(`匿名が剥がれたため、名前やアイコンのオプションは無効化されました。ユーザー: ${interaction.user.tag}`);
            }
        }

        // webhook取得または作成
        const channel = interaction.channel;
        const clientUser = interaction.client.user;
        let webhook = null;
        const webhooks = await channel.fetchWebhooks();
        webhook = webhooks.find(wh => wh.owner && wh.owner.id === clientUser.id);
        if (!webhook) {
            webhook = await channel.createWebhook({
                name: finalDisplayName,
                avatar: finalAvatar
            });
        } else {
            await webhook.edit({
                name: finalDisplayName,
                avatar: finalAvatar
            });
        }

        // 投稿
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            console.error('deferReplyエラー:', deferError);
            return; // deferReplyに失敗した場合は処理を終了
        }

        try {
            let sentMessage;
            
            if (isRevealed) {
                // 匿名が剥がれた場合は特別なEmbedで投稿
                const revealedEmbed = createRevealedEmbed(interaction.user, content, hash);
                sentMessage = await webhook.send({
                    embeds: [revealedEmbed],
                    files: file ? [ (file.attachment ? file : file) ] : [],
                    username: finalDisplayName,
                    avatarURL: finalAvatar,
                    allowedMentions: { parse: [] }
                });
            } else {
                // 通常の匿名投稿
                sentMessage = await webhook.send({
                    content: content,
                    files: file ? [ (file.attachment ? file : file) ] : [],
                    username: finalDisplayName,
                    avatarURL: finalAvatar,
                    allowedMentions: { parse: [] }
                });
            }

            // 管理者ログチャンネルへの送信は無効化（要望により匿名機能のログ送信を停止）

            const replyMessage = isRevealed 
                ? '🎭 匿名が剥がれました！元の名前とアイコンで投稿されました。' 
                : '匿名で投稿しました。';
            
            try {
                await interaction.editReply({ content: replyMessage, ephemeral: true });
            } catch (editError) {
                console.error('editReplyエラー:', editError);
            }
        } catch (e) {
            console.error('匿名投稿エラー:', e);
            let errorMessage = '投稿に失敗しました。';
            
            // ファイルサイズ関連のエラーの場合
            if (e.message && e.message.includes('size')) {
                errorMessage = 'ファイルサイズが大きすぎます。Discordの制限（25MB）を確認してください。';
            } else if (e.message && e.message.includes('413')) {
                errorMessage = 'ファイルサイズが大きすぎます。Discordの制限（25MB）を確認してください。';
            }
            
            try {
                await interaction.editReply({ content: errorMessage, ephemeral: true });
            } catch (editError) {
                console.error('editReplyエラー（エラー処理中）:', editError);
            }
        }
    },

    // 管理者ログチャンネルに投稿情報を送信する関数
    async sendAdminLog(interaction, sentMessage, hash, displayName, isRevealed = false) {
        try {
            const adminLogChannel = interaction.client.channels.cache.get(config.ADMIN_LOG_CHANNEL_ID);
            if (!adminLogChannel) {
                console.warn('管理者ログチャンネルが見つかりません:', config.ADMIN_LOG_CHANNEL_ID);
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(isRevealed ? '🎭 匿名剥がれログ' : '🔒 匿名投稿ログ')
                .setColor(isRevealed ? 0xff6b6b : 0x00ff00)
                .addFields(
                    { name: '投稿者', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                    { name: '匿名ID', value: hash, inline: true },
                    { name: '表示名', value: displayName, inline: true },
                    { name: '投稿チャンネル', value: `${interaction.channel.name} (${interaction.channel.id})`, inline: true },
                    { name: '投稿時刻', value: new Date().toLocaleString('ja-JP'), inline: true },
                    { name: '投稿内容', value: interaction.options.getString('内容') || 'なし' }
                )
                .setTimestamp()
                .setFooter({ text: '管理者専用ログ' });

            // 匿名が剥がれた場合の特別な情報を追加
            if (isRevealed) {
                embed.addFields(
                    { name: '🎭 匿名剥がれ', value: '1%の確率で匿名が剥がれました！', inline: false }
                );
            }

            // 添付ファイルがある場合は追加
            const file = interaction.options.getAttachment('添付ファイル');
            if (file) {
                embed.addFields({ name: '添付ファイル', value: `[${file.name}](${file.url})`, inline: false });
            }

            // 投稿メッセージへのリンクを追加
            embed.addFields({ 
                name: '投稿メッセージ', 
                value: `[メッセージを表示](${sentMessage.url})`, 
                inline: false 
            });

            await adminLogChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('管理者ログの送信に失敗しました:', error);
        }
    }
};
