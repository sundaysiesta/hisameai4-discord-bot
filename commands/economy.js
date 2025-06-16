const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('economy')
        .setDescription('経済システムの管理（管理者限定）')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set_balance')
                .setDescription('ユーザーの残高を設定します')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象ユーザー')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('設定する金額')
                        .setRequired(true)
                        .setMinValue(0)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add_balance')
                .setDescription('ユーザーの残高を追加します')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象ユーザー')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('追加する金額')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove_balance')
                .setDescription('ユーザーの残高を削除します')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象ユーザー')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('削除する金額')
                        .setRequired(true)
                        .setMinValue(1))),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        try {
            const userKey = `user:${targetUser.id}`;
            let userData = await redis.hGetAll(userKey);

            if (Object.keys(userData).length === 0) {
                userData = {
                    balance: '0',
                    bank: '0'
                };
            }

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTimestamp();

            if (subcommand === 'set_balance') {
                userData.balance = amount.toString();
                embed.setTitle('残高設定完了')
                    .setDescription(`${targetUser.username}の残高を設定しました。`)
                    .addFields(
                        { name: '設定金額', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    );
            } else if (subcommand === 'add_balance') {
                const newBalance = parseInt(userData.balance) + amount;
                userData.balance = newBalance.toString();
                embed.setTitle('残高追加完了')
                    .setDescription(`${targetUser.username}の残高を追加しました。`)
                    .addFields(
                        { name: '追加金額', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '新しい残高', value: `${config.COIN_SYMBOL} ${newBalance.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    );
            } else if (subcommand === 'remove_balance') {
                const currentBalance = parseInt(userData.balance);
                if (currentBalance < amount) {
                    return interaction.editReply('残高が不足しています。');
                }
                const newBalance = currentBalance - amount;
                userData.balance = newBalance.toString();
                embed.setTitle('残高削除完了')
                    .setDescription(`${targetUser.username}の残高を削除しました。`)
                    .addFields(
                        { name: '削除金額', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '新しい残高', value: `${config.COIN_SYMBOL} ${newBalance.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    );
            }

            await redis.hSet(userKey, userData);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('経済システム管理エラー:', error);
            await interaction.editReply('経済システム管理コマンドの実行中にエラーが発生しました。');
        }
    },
}; 