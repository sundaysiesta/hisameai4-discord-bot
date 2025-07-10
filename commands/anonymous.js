const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const crypto = require('crypto');

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
                avatar: null
            });
        } else {
            await webhook.edit({
                name: displayName,
                avatar: null
            });
        }

        // 投稿
        await interaction.deferReply({ ephemeral: true });
        try {
            await webhook.send({
                content: content,
                files: file ? [file] : [],
                username: displayName,
                avatarURL: null,
                allowedMentions: { parse: [] }
            });
            await interaction.editReply({ content: '匿名で投稿しました。', ephemeral: true });
        } catch (e) {
            await interaction.editReply({ content: '投稿に失敗しました。', ephemeral: true });
        }
    },
}; 