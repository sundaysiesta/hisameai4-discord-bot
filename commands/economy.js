const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('economy')
        .setDescription('経済システムの管理コマンド')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('全ユーザーの所持金と銀行残高をリセットします')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('リセットするユーザー（指定しない場合は全員）')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('ユーザーの所持金または銀行残高を設定します')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('設定するユーザー')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('設定する残高の種類')
                        .setRequired(true)
                        .addChoices(
                            { name: '所持金', value: 'balance' },
                            { name: '銀行残高', value: 'bank' }
                        ))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('設定する金額')
                        .setRequired(true)
                        .setMinValue(0))),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'reset') {
                const targetUser = interaction.options.getUser('user');
                
                if (targetUser) {
                    // 特定のユーザーのリセット
                    const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
                    const multi = redis.multi();
                    multi.hset(`user:${mainAccountId}`, 'balance', config.STARTING_BALANCE);
                    multi.hset(`user:${mainAccountId}`, 'bank', '0');
                    await multi.exec();

                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('残高リセット完了')
                        .setDescription(`${targetUser.username}の残高をリセットしました。`)
                        .addFields(
                            { name: '所持金', value: `${config.COIN_SYMBOL} ${config.STARTING_BALANCE.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                            { name: '銀行残高', value: `${config.COIN_SYMBOL} 0 ${config.COIN_NAME}`, inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    // 全ユーザーのリセット
                    const keys = await redis.keys('user:*');
                    const multi = redis.multi();
                    
                    for (const key of keys) {
                        if (key.startsWith('user:')) {
                            multi.hset(key, 'balance', config.STARTING_BALANCE);
                            multi.hset(key, 'bank', '0');
                        }
                    }
                    
                    await multi.exec();

                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('全ユーザー残高リセット完了')
                        .setDescription('全ユーザーの残高をリセットしました。')
                        .addFields(
                            { name: '初期所持金', value: `${config.COIN_SYMBOL} ${config.STARTING_BALANCE.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                            { name: '初期銀行残高', value: `${config.COIN_SYMBOL} 0 ${config.COIN_NAME}`, inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                }
            } else if (subcommand === 'set') {
                const targetUser = interaction.options.getUser('user');
                const type = interaction.options.getString('type');
                const amount = interaction.options.getInteger('amount');

                const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
                await redis.hset(`user:${mainAccountId}`, type, amount);

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('残高設定完了')
                    .setDescription(`${targetUser.username}の${type === 'balance' ? '所持金' : '銀行残高'}を設定しました。`)
                    .addFields(
                        { name: type === 'balance' ? '所持金' : '銀行残高', value: `${config.COIN_SYMBOL} ${amount.toLocaleString()} ${config.COIN_NAME}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('経済管理エラー:', error);
            await interaction.editReply('経済管理コマンドの実行中にエラーが発生しました。');
        }
    },
}; 