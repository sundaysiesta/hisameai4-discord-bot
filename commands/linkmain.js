const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linkmain')
        .setDescription('サブアカウントのボイスXPをメインアカウントに合算します。(管理者限定)')
        .addUserOption(option => 
            option.setName('main_account')
                .setDescription('XPの合算先となるメインアカウント')
                .setRequired(true))
        .addUserOption(option => 
            option.setName('sub_account')
                .setDescription('XPを合算するサブアカウント')
                .setRequired(true)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        
        const mainAccount = interaction.options.getUser('main_account');
        const subAccount = interaction.options.getUser('sub_account');
        
        if (mainAccount.id === subAccount.id) {
            return interaction.editReply('メインアカウントとサブアカウントに同じユーザーを指定することはできません。');
        }

        try {
            const subData = await redis.hgetall(`user:${subAccount.id}`);
            const voiceXpToTransfer = Number(subData?.voiceXp) || 0;
            if (voiceXpToTransfer === 0) {
                return interaction.editReply(`${subAccount.username} には引き継ぐボイスXPがありません。`);
            }
            await redis.hincrby(`user:${mainAccount.id}`, 'voiceXp', voiceXpToTransfer);
            await redis.hset(`user:${subAccount.id}`, { mainAccountId: mainAccount.id, voiceXp: 0 });
            await interaction.editReply(
                `${subAccount.username} のボイスXPを ${mainAccount.username} に合算し、今後このアカウントのXPはメインに計上されるように設定しました。\n` +
                `合算されたボイスXP: ${voiceXpToTransfer}`
            );
        } catch (error) {
            console.error('Linkmain command error:', error);
            await interaction.editReply('処理中にエラーが発生しました。');
        }
    },
};
