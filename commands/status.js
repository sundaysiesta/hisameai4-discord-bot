const { SlashCommandBuilder, PermissionsBitField, ActivityType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Botのステータスメッセージを変更します。(管理者限定)')
        .addStringOption(option => 
            option.setName('内容')
                .setDescription('表示するステータスの内容')
                .setRequired(true)),
    async execute(interaction, redis) { // redisを引数で受け取る
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        await interaction.deferReply({ephemeral: true});
        const statusText = interaction.options.getString('内容');
        
        try {
            // Discordのステータスを設定
            interaction.client.user.setActivity(statusText, { type: ActivityType.Playing });
            
            // Redisにステータスを保存（キー: 'bot_status_text'）
            await redis.set('bot_status_text', statusText);
            
            await interaction.editReply({ content: `Botのステータスを「${statusText}」に変更し、保存しました。再起動後もこのステータスが維持されます。` });
        } catch (error) {
            console.error('ステータスの設定または保存中にエラー:', error);
            await interaction.editReply({ content: 'ステータスの設定中にエラーが発生しました。' });
        }
    },
};

