const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('ユーザーのXPを操作します。(管理者限定)')
        .addUserOption(option => option.setName('user').setDescription('対象のユーザー').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('操作するXPの種類').setRequired(true).addChoices({ name: 'テキスト', value: 'text' }, { name: 'ボイス', value: 'voice' }))
        .addStringOption(option => option.setName('action').setDescription('操作の種類').setRequired(true).addChoices({ name: '追加', value: 'add' }, { name: '削除', value: 'remove' }, { name: '設定', value: 'set' }))
        .addIntegerOption(option => option.setName('amount').setDescription('XPの量').setRequired(true)),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '権限がありません。', ephemeral: true });
        
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const type = interaction.options.getString('type');
        const action = interaction.options.getString('action');
        const amount = interaction.options.getInteger('amount');
        const xpKey = `${type}Xp`;

        try {
            if (action === 'add') {
                await redis.hincrby(`user:${targetUser.id}`, xpKey, amount);
            } else if (action === 'remove') {
                await redis.hincrby(`user:${targetUser.id}`, xpKey, -amount);
            } else if (action === 'set') {
                await redis.hset(`user:${targetUser.id}`, { [xpKey]: amount });
            }
            const newXp = await redis.hget(`user:${targetUser.id}`, xpKey);
            await interaction.editReply(`${targetUser.username} の${type}XPを${newXp}に更新しました。`);
        } catch (error) {
            await interaction.editReply('XPの操作中にエラーが発生しました。');
        }
    },
};
