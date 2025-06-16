const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('所持金を確認します')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user') || interaction.user;
        
        try {
            const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
            const balance = await redis.hget(`user:${mainAccountId}`, 'balance') || '0';

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`${targetUser.username}の所持金`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '所持金', value: `${config.COIN_SYMBOL} ${parseInt(balance).toLocaleString()} ${config.COIN_NAME}` }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('残高確認エラー:', error);
            await interaction.editReply('残高の確認中にエラーが発生しました。');
        }
    },
};
