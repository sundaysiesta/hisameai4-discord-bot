const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linkmain')
        .setDescription('サブアカウントのXPをメインアカウントに合算します。(管理者限定)')
        .addUserOption(option => 
            option.setName('main_account')
                .setDescription('XPの合算先となるメインアカウント')
                .setRequired(true))
        .addUserOption(option => 
            option.setName('sub_account')
                .setDescription('XPを合算するサブアカウント')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('unlink')
                .setDescription('アカウントのリンクを解除する')
                .setRequired(false)),
    async execute(interaction, redis) {
        // 【修正】管理者権限チェックを追加
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        
        // 【修正】オプションからメインとサブのアカウントを取得
        const mainAccount = interaction.options.getUser('main_account');
        const subAccount = interaction.options.getUser('sub_account');
        const unlink = interaction.options.getBoolean('unlink') || false;
        
        if (mainAccount.id === subAccount.id) {
            return interaction.editReply('メインアカウントとサブアカウントに同じユーザーを指定することはできません。');
        }

        try {
            if (unlink) {
                // リンク解除処理
                const subData = await redis.hgetall(`user:${subAccount.id}`);
                if (!subData?.mainAccountId) {
                    return interaction.editReply(`${subAccount.username} はメインアカウントにリンクされていません。`);
                }

                if (subData.mainAccountId !== mainAccount.id) {
                    return interaction.editReply(`${subAccount.username} は ${mainAccount.username} にリンクされていません。`);
                }

                // リンクを解除
                await redis.hdel(`user:${subAccount.id}`, 'mainAccountId');
                await interaction.editReply(`${subAccount.username} のメインアカウントとのリンクを解除しました。`);
                return;
            }

            // サブアカウントのデータを取得
            const subData = await redis.hgetall(`user:${subAccount.id}`);
            const textXpToTransfer = Number(subData?.textXp) || 0;
            const voiceXpToTransfer = Number(subData?.voiceXp) || 0;
            
            if (textXpToTransfer === 0 && voiceXpToTransfer === 0) {
                return interaction.editReply(`${subAccount.username} には引き継ぐXPがありません。`);
            }

            // メインアカウントにXPを加算
            await redis.hincrby(`user:${mainAccount.id}`, 'textXp', textXpToTransfer);
            await redis.hincrby(`user:${mainAccount.id}`, 'voiceXp', voiceXpToTransfer);
            
            // サブアカウントのデータをリセットし、メインアカウントIDを記録
            await redis.hset(`user:${subAccount.id}`, { mainAccountId: mainAccount.id, textXp: 0, voiceXp: 0 });

            await interaction.editReply(
                `${subAccount.username} のXPを ${mainAccount.username} に合算し、今後このアカウントのXPはメインに計上されるように設定しました。\n` +
                `合算されたXP: (テキスト: ${textXpToTransfer}, ボイス: ${voiceXpToTransfer})`
            );
        } catch (error) {
            console.error('Linkmain command error:', error);
            await interaction.editReply('処理中にエラーが発生しました。');
        }
    },
};
