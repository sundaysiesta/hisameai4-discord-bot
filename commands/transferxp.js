const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transferxp')
        .setDescription('BANされたアカウントのボイスXPを新しいアカウントに引き継ぎます。(管理者限定)')
        .addStringOption(option => option.setName('old_user_id').setDescription('元のアカウントのユーザーID').setRequired(true))
        .addUserOption(option => option.setName('new_user').setDescription('引き継ぎ先の新しいアカウント').setRequired(true)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '権限がありません。', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        const oldId = interaction.options.getString('old_user_id');
        const newUser = interaction.options.getUser('new_user');
        
        try {
            const oldData = await redis.hgetall(`user:${oldId}`);
            if (!oldData) return interaction.editReply('元アカウントのデータが見つかりません。');
            
            const voiceXp = oldData.voiceXp || 0;
            await redis.hincrby(`user:${newUser.id}`, 'voiceXp', voiceXp);
            await redis.del(`user:${oldId}`); // 元のデータを削除
            await interaction.editReply(`ボイスXPを引き継ぎました。
ボイスXP: +${voiceXp}`);
        } catch (error) {
            await interaction.editReply('XPの引き継ぎ中にエラーが発生しました。');
        }
    },
};
