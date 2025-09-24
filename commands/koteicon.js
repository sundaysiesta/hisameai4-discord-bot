const { SlashCommandBuilder } = require('discord.js');
const { setKoteicon, getKoteicon, removeKoteicon, processFileSafely } = require('../utils/utility.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('koteicon')
        .setDescription('匿名投稿用の固定アイコンを設定します')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('固定アイコンを設定します')
                .addAttachmentOption(option =>
                    option.setName('アイコン')
                        .setDescription('固定したいアイコン画像（最大10MB）')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('現在の固定アイコンを確認します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('固定アイコンを削除します')
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === 'set') {
            const icon = interaction.options.getAttachment('アイコン');
            
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

        if (subcommand === 'view') {
            const koteicon = getKoteicon(userId);
            
            if (!koteicon) {
                return interaction.reply({ 
                    content: '固定アイコンは設定されていません。\n`/koteicon set`で固定アイコンを設定できます。', 
                    ephemeral: true 
                });
            }

            return interaction.reply({ 
                content: '現在の固定アイコン:', 
                files: [koteicon.attachment],
                ephemeral: true 
            });
        }

        if (subcommand === 'remove') {
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
