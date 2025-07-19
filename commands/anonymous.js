const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const crypto = require('crypto');
const memoryManager = require('../utils/memoryManager');

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
                .setDescription('画像や動画などの添付ファイル（最大25MB、1ファイルのみ）')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('アイコン')
                .setDescription('表示用アイコン画像（最大5MB）')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('名前')
                .setDescription('表示名（未入力の場合は「名無しのロメダ民」）')
                .setRequired(false)
        ),
    async execute(interaction) {
        // メモリ使用量チェック
        if (!memoryManager.checkMemoryUsage()) {
            return interaction.reply({ 
                content: 'システムの負荷が高いため、しばらく待ってから再試行してください。', 
                ephemeral: true 
            });
        }

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

        // ファイルサイズ制限チェック
        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
        const MAX_ICON_SIZE = 5 * 1024 * 1024; // 5MB

        if (file) {
            const sizeValidation = memoryManager.validateFileSize(file.size, MAX_FILE_SIZE);
            if (!sizeValidation.valid) {
                return interaction.reply({ content: sizeValidation.error, ephemeral: true });
            }
        }

        if (icon) {
            const iconSizeValidation = memoryManager.validateFileSize(icon.size, MAX_ICON_SIZE);
            if (!iconSizeValidation.valid) {
                return interaction.reply({ content: iconSizeValidation.error, ephemeral: true });
            }
        }

        // ファイル形式チェック
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
        const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

        if (file) {
            const typeValidation = memoryManager.validateFileType(file.contentType, allowedTypes);
            if (!typeValidation.valid) {
                return interaction.reply({ 
                    content: `サポートされていないファイル形式です。画像（JPEG、PNG、GIF、WebP）または動画（MP4、WebM、MOV）のみ対応しています。`, 
                    ephemeral: true 
                });
            }
        }

        if (icon) {
            const iconTypeValidation = memoryManager.validateFileType(icon.contentType, allowedImageTypes);
            if (!iconTypeValidation.valid) {
                return interaction.reply({ 
                    content: `アイコンは画像ファイル（JPEG、PNG、GIF、WebP）のみ対応しています。`, 
                    ephemeral: true 
                });
            }
        }

        // 匿名ID生成
        const salt = process.env.ANONYMOUS_SALT || '';
        const date = new Date().toISOString().slice(0, 10);
        const hash = crypto.createHash('sha256').update(interaction.user.id + date + salt).digest('hex').slice(0, 8);
        const displayNameRaw = (nameOpt && nameOpt.trim().length > 0) ? nameOpt.trim() : '名無しのロメダ民';
        const displayName = `${displayNameRaw} ID: ${hash}`;

        // webhook取得または作成
        const channel = interaction.channel;
        const clientUser = interaction.client.user;
        let webhook = null;
        
        try {
            const webhooks = await channel.fetchWebhooks();
            webhook = webhooks.find(wh => wh.owner && wh.owner.id === clientUser.id);
            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: displayName,
                    avatar: icon ? icon.url : null
                });
            } else {
                await webhook.edit({
                    name: displayName,
                    avatar: icon ? icon.url : null
                });
            }
        } catch (error) {
            console.error('Webhook作成/編集エラー:', error);
            return interaction.reply({ 
                content: 'Webhookの設定に失敗しました。権限を確認してください。', 
                ephemeral: true 
            });
        }

        // 投稿
        await interaction.deferReply({ ephemeral: true });
        
        try {
            // ファイルの安全な処理
            let files = [];
            if (file) {
                try {
                    const buffer = await memoryManager.processFileSafely(file.url, MAX_FILE_SIZE);
                    const attachment = new AttachmentBuilder(buffer, {
                        name: file.name,
                        description: file.description
                    });
                    files.push(attachment);
                } catch (fileError) {
                    console.error('ファイル処理エラー:', fileError);
                    return interaction.editReply({ 
                        content: 'ファイルの処理に失敗しました。ファイルサイズや形式を確認してください。', 
                        ephemeral: true 
                    });
                }
            }

            await webhook.send({
                content: content,
                files: files,
                username: displayName,
                avatarURL: icon ? icon.url : null,
                allowedMentions: { parse: [] }
            });

            await interaction.editReply({ content: '匿名で投稿しました。', ephemeral: true });

            // 投稿後のメモリクリーンアップ
            memoryManager.forceCleanup();

        } catch (error) {
            console.error('投稿エラー:', error);
            
            // エラーの種類に応じたメッセージ
            let errorMessage = '投稿に失敗しました。';
            if (error.code === 40005) {
                errorMessage = 'ファイルサイズが大きすぎます。';
            } else if (error.code === 50013) {
                errorMessage = '権限が不足しています。';
            } else if (error.code === 50001) {
                errorMessage = 'チャンネルが見つかりません。';
            }

            await interaction.editReply({ 
                content: errorMessage, 
                ephemeral: true 
            });
        }
    },
}; 