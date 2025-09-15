const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anonlookup')
        .setDescription('匿名IDと日付から送信者を特定します。(管理者限定)')
        .addStringOption(option =>
            option.setName('匿名id')
                .setDescription('匿名ID（8文字）')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('日付')
                .setDescription('投稿日付（YYYY-MM-DD）')
                .setRequired(true)
        ),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }

        const inputHash = interaction.options.getString('匿名id').trim();
        const date = interaction.options.getString('日付').trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return interaction.reply({ content: '日付は YYYY-MM-DD の形式で入力してください。', ephemeral: true });
        }
        if (!/^[a-f0-9]{8}$/i.test(inputHash)) {
            return interaction.reply({ content: '匿名IDは16進数8文字で入力してください。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const salt = process.env.ANONYMOUS_SALT || '';
            const members = await interaction.guild.members.fetch();

            let matched = [];
            for (const [, member] of members) {
                const calc = crypto.createHash('sha256').update(member.user.id + date + salt).digest('hex').slice(0, 8);
                if (calc.toLowerCase() === inputHash.toLowerCase()) {
                    matched.push(member);
                }
            }

            if (matched.length === 0) {
                return interaction.editReply({ content: '該当ユーザーは見つかりませんでした。日付や匿名IDを確認してください。' });
            }

            const list = matched.map(m => `${m.user.tag} (${m.id})`).join('\n');
            return interaction.editReply({ content: `一致したユーザー:\n${list}` });
        } catch (error) {
            console.error('anonlookup error:', error);
            return interaction.editReply({ content: '照会中にエラーが発生しました。' });
        }
    }
};


