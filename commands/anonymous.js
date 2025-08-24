const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('crypto');
const config = require('../config.js');

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
                .setDescription('画像や動画などの添付ファイル')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('アイコン')
                .setDescription('表示用アイコン画像')
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

        // 投稿
        await interaction.deferReply({ ephemeral: true });
        try {
            const sentMessage = await webhook.send({
                content: content,
                files: file ? [file] : [],
                username: displayName,
                avatarURL: null,
                allowedMentions: { parse: [] }
            });

            // 管理者ログチャンネルに投稿情報を送信
            await this.sendAdminLog(interaction, sentMessage, hash, displayName);

            await interaction.editReply({ content: '匿名で投稿しました。', ephemeral: true });
        } catch (e) {
            await interaction.editReply({ content: '投稿に失敗しました。', ephemeral: true });
        }
    },

    // 管理者ログチャンネルに投稿情報を送信する関数
    async sendAdminLog(interaction, sentMessage, hash, displayName) {
        try {
            const adminLogChannel = interaction.client.channels.cache.get(config.ADMIN_LOG_CHANNEL_ID);
            if (!adminLogChannel) {
                console.warn('管理者ログチャンネルが見つかりません:', config.ADMIN_LOG_CHANNEL_ID);
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🔒 匿名投稿ログ')
                .setColor(0x00ff00)
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