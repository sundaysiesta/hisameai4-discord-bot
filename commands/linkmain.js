const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linkmain')
        .setDescription('このアカウントをメインアカウントに指定し、XPを合算します。')
        .addUserOption(option => option.setName('sub_account').setDescription('サブアカウントとして指定するユーザー').setRequired(true)),
    async execute(interaction, redis) {
        await interaction.deferReply({ ephemeral: true });
        
        const mainAccount = interaction.user;
        const subAccount = interaction.options.getUser('sub_account');
        
        if(mainAccount.id === subAccount.id) return interaction.editReply('自分自身をサブアカウントに指定することはできません。');

        try {
            // サブアカウントのデータを取得
            const subData = await redis.hgetall(`user:${subAccount.id}`);
            const textXpToTransfer = subData?.textXp || 0;
            const voiceXpToTransfer = subData?.voiceXp || 0;
            
            // メインアカウントにXPを加算
            await redis.hincrby(`user:${mainAccount.id}`, 'textXp', textXpToTransfer);
            await redis.hincrby(`user:${mainAccount.id}`, 'voiceXp', voiceXpToTransfer);
            
            // サブアカウントのデータをリセットし、メインアカウントIDを記録
            await redis.hset(`user:${subAccount.id}`, { mainAccountId: mainAccount.id, textXp: 0, voiceXp: 0 });

            await interaction.editReply(`${subAccount.username} のXPを ${mainAccount.username} に合算し、今後このアカウントのXPはメインに計上されるように設定しました。`);
        } catch (error) {
            await interaction.editReply('処理中にエラーが発生しました。');
        }
    },
};
