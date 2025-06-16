const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('他のユーザーにコインを送金します')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('送金先のユーザー')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('送金額')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const senderId = interaction.user.id;
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        
        if (targetUser.bot) {
            return interaction.editReply('Botには送金できません。');
        }
        
        if (targetUser.id === senderId) {
            return interaction.editReply('自分自身には送金できません。');
        }

        try {
            const senderMainId = await redis.hget(`user:${senderId}`, 'mainAccountId') || senderId;
            const receiverMainId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
            const senderBalance = await redis.hget(`user:${senderMainId}`, 'balance') || '0';

            if (parseInt(senderBalance) < amount) {
                return interaction.editReply(`所持金が足りません。\n所持金: ${config.COIN_SYMBOL} ${parseInt(senderBalance).toLocaleString()} ${config.COIN_NAME}`);
            }

            // Redisでのトランザクション処理
            const multi = redis.multi();
            multi.hincrby(`user:${senderMainId}`, 'balance', -amount);
            multi.hincrby(`user:${receiverMainId}`, 'balance', amount);
            await multi.exec();

            const newSenderBalance = await redis.hget(`user:${senderMainId}`, 'balance');
            const newReceiverBalance = await redis.hget(`user:${receiverMainId}`, 'balance');

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('送金完了')
                .setDescription(`${targetUser.username} に ${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME} を送金しました。`)
                .addFields(
                    { name: 'あなたの残高', value: `${config.COIN_SYMBOL} ${parseInt(newSenderBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '相手の残高', value: `${config.COIN_SYMBOL} ${parseInt(newReceiverBalance).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('送金エラー:', error);
            await interaction.editReply('送金中にエラーが発生しました。');
        }
    },
};
