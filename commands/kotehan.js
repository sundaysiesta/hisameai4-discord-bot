const { SlashCommandBuilder } = require('discord.js');
const { setKotehan, getKotehan, removeKotehan } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kotehan')
        .setDescription('匿名投稿用のコテハン（固定ハンドルネーム）を設定します')
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
        .addStringOption(option =>
            option.setName('名前')
                .setDescription('固定したいハンドルネーム（20文字以内）')
                .setRequired(false)
                .setMaxLength(20)
        ),
    async execute(interaction) {
        const action = interaction.options.getString('action');
        const name = interaction.options.getString('名前');
        const userId = interaction.user.id;

        if (action === 'set') {
            if (!name || name.trim().length === 0) {
                return interaction.reply({ content: '名前を入力してください。', ephemeral: true });
            }

            if (name.trim().length > 20) {
                return interaction.reply({ content: '名前は20文字以内で入力してください。', ephemeral: true });
            }

            const tag = setKotehan(userId, name);
            const displayName = `${name.trim()}#${tag}`;
            
            return interaction.reply({ 
                content: `コテハンを設定しました！\n表示名: **${displayName}**\n\nこれで匿名投稿時に「${displayName}」として表示されます。\n/anonymousコマンドで別の名前を指定すれば上書きできます。`, 
                ephemeral: true 
            });
        }

        if (action === 'view') {
            const kotehan = getKotehan(userId);
            
            if (!kotehan) {
                return interaction.reply({ 
                    content: 'コテハンは設定されていません。\n`/kotehan`でコテハンを設定できます。', 
                    ephemeral: true 
                });
            }

            const displayName = `${kotehan.name}#${kotehan.tag}`;
            return interaction.reply({ 
                content: `現在のコテハン: **${displayName}**`, 
                ephemeral: true 
            });
        }

        if (action === 'remove') {
            const removed = removeKotehan(userId);
            
            if (removed) {
                return interaction.reply({ 
                    content: 'コテハンを削除しました。\n匿名投稿時は通常の「名無しのロメダ民」として表示されます。', 
                    ephemeral: true 
                });
            } else {
                return interaction.reply({ 
                    content: 'コテハンは設定されていません。', 
                    ephemeral: true 
                });
            }
        }
    },
};
