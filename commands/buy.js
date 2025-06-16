const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('ショップから商品を購入します')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('購入する商品名')
                .setRequired(true)),
    async execute(interaction, redis) {
        await interaction.deferReply();

        try {
            const itemName = interaction.options.getString('name');
            const item = config.COIN_ITEMS.find(item => item.name === itemName);

            if (!item) {
                return interaction.editReply('指定された商品が見つかりません。');
            }

            // ユーザーの所持金を確認
            const userData = await redis.hGetAll(`user:${interaction.user.id}`);
            const balance = parseInt(userData.balance || '0');

            if (balance < item.price) {
                return interaction.editReply(`所持金が足りません。\n必要額: ${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}\n所持金: ${config.COIN_SYMBOL} ${balance.toLocaleString()} ${config.COIN_NAME}`);
            }

            // ロールの存在確認
            const role = await interaction.guild.roles.fetch(item.roleId).catch(() => null);
            if (!role) {
                return interaction.editReply('この商品は現在購入できません。');
            }

            // ユーザーが既にロールを持っているか確認
            if (interaction.member.roles.cache.has(item.roleId)) {
                return interaction.editReply('あなたは既にこの商品を所持しています。');
            }

            // トランザクションの開始
            const multi = redis.multi();

            // 所持金を減らす
            multi.hSet(`user:${interaction.user.id}`, 'balance', balance - item.price);

            // トランザクションの実行
            await multi.exec();

            // ロールを付与
            await interaction.member.roles.add(item.roleId);

            const embed = new EmbedBuilder()
                .setTitle('購入完了')
                .setColor('#00ff00')
                .setDescription(`${item.name}を購入しました。`)
                .addFields(
                    { name: '支払い金額', value: `${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                    { name: '残高', value: `${config.COIN_SYMBOL} ${(balance - item.price).toLocaleString()} ${config.COIN_NAME}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('商品購入エラー:', error);
            await interaction.editReply('商品の購入中にエラーが発生しました。');
        }
    },
};
