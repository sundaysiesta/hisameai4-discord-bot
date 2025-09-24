const { SlashCommandBuilder } = require('discord.js');
const { setKoteicon, getKoteicon, removeKoteicon, processFileSafely } = require('../utils/utility.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('koteicon')
        .setDescription('匿名投稿用の固定アイコンを設定します')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('実行する操作')
                .setRequired(true)
                .addChoices(
                    { name: '設定', value: 'set' },
                    { name: '確認', value: 'view' },
                    { name: '削除', value: 'remove' }
                )
        )
        .addAttachmentOption(option =>
            option.setName('アイコン')
                .setDescription('固定したいアイコン画像（最大10MB）')
                .setRequired(false)
        ),
    async execute(interaction) {
        const action = interaction.options.getString('action');
        const icon = interaction.options.getAttachment('アイコン');
        const userId = interaction.user.id;

        if (action === 'set') {
            if (!icon) {
                return interaction.reply({ content: 'アイコンを選択してください。', ephemeral: true });
            }

            // ファイルサイズチェック
            const iconCheck = await processFileSafely(icon, config);
            if (!iconCheck.success) {
                return interaction.reply({ content: `アイコンファイルエラー: ${iconCheck.error}`, ephemeral: true });
            }

            // 固定アイコンを設定
            setKoteicon(userId, {
                url: icon.url,
                attachment: iconCheck.file || icon
            });
            
            return interaction.reply({ 
                content: `固定アイコンを設定しました！\n\nこれで匿名投稿時にこのアイコンが自動的に使用されます。\n/anonymousコマンドで別のアイコンを指定すれば上書きできます。`, 
                ephemeral: true 
            });
        }

        if (action === 'view') {
            const koteicon = getKoteicon(userId);
            
            if (!koteicon) {
                return interaction.reply({ 
                    content: '固定アイコンは設定されていません。\n`/koteicon`で固定アイコンを設定できます。', 
                    ephemeral: true 
                });
            }

            return interaction.reply({ 
                content: '現在の固定アイコン:', 
                files: [koteicon.attachment],
                ephemeral: true 
            });
        }

        if (action === 'remove') {
            const removed = removeKoteicon(userId);
            
            if (removed) {
                return interaction.reply({ 
                    content: '固定アイコンを削除しました。\n匿名投稿時はデフォルトのアイコンが使用されます。', 
                    ephemeral: true 
                });
            } else {
                return interaction.reply({ 
                    content: '固定アイコンは設定されていません。', 
                    ephemeral: true 
                });
            }
        }
    },
};
