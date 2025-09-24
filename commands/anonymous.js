const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const config = require('../config.js');
const { processFileSafely, getKotehan, getKoteicon } = require('../utils/utility.js');

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
        
        // コテハンと固定アイコンの取得
        const kotehan = getKotehan(interaction.user.id);
        const koteicon = getKoteicon(interaction.user.id);
        
        // 表示名の決定（優先順位: /anonymousの名前指定 > コテハン > デフォルト）
        let displayNameRaw;
        if (nameOpt && nameOpt.trim().length > 0) {
            // /anonymousで名前が指定された場合は上書き
            displayNameRaw = nameOpt.trim();
        } else if (kotehan) {
            // コテハンが設定されている場合はそれを使用
            displayNameRaw = `${kotehan.name}#${kotehan.tag}`;
        } else {
            // デフォルト
            displayNameRaw = '名無しのロメダ民';
        }
        
        const displayName = `${displayNameRaw} ID: ${hash}`;

        // アイコンの決定（優先順位: /anonymousのアイコン指定 > 固定アイコン > デフォルト）
        let finalAvatar;
        if (icon) {
            // /anonymousでアイコンが指定された場合は上書き
            finalAvatar = icon.url;
        } else if (koteicon) {
            // 固定アイコンが設定されている場合はそれを使用
            finalAvatar = koteicon.url;
        } else {
            // デフォルト（null）
            finalAvatar = null;
        }

        // 匿名IDと表示名を設定
        const finalDisplayName = displayName;

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
            // 通常の匿名投稿
            const sentMessage = await webhook.send({
                content: content,
                files: file ? [ (file.attachment ? file : file) ] : [],
                username: finalDisplayName,
                avatarURL: finalAvatar,
                allowedMentions: { parse: [] }
            });

            // 管理者ログチャンネルへの送信は無効化（要望により匿名機能のログ送信を停止）

            const replyMessage = '匿名で投稿しました。';
            
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

};
