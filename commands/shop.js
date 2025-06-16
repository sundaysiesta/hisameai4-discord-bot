const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('ショップの管理コマンド')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('現在の商品一覧を表示します'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('新しい商品を追加します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('商品名')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('price')
                        .setDescription('価格')
                        .setRequired(true)
                        .setMinValue(1))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('商品の説明')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('role_id')
                        .setDescription('付与するロールID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('商品を削除します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('削除する商品名')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('商品の情報を編集します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('編集する商品名')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('field')
                        .setDescription('編集する項目')
                        .setRequired(true)
                        .addChoices(
                            { name: '商品名', value: 'name' },
                            { name: '価格', value: 'price' },
                            { name: '説明', value: 'description' },
                            { name: 'ロールID', value: 'role_id' }
                        ))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('新しい値')
                        .setRequired(true))),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'list') {
                const embed = new EmbedBuilder()
                    .setTitle('ショップ商品一覧')
                    .setColor('#00ff00')
                    .setTimestamp();

                if (config.COIN_ITEMS.length === 0) {
                    embed.setDescription('商品がありません。');
                } else {
                    config.COIN_ITEMS.forEach(item => {
                        embed.addFields({
                            name: `${item.name} - ${config.COIN_SYMBOL} ${item.price.toLocaleString()} ${config.COIN_NAME}`,
                            value: `${item.description}\nロールID: ${item.roleId}`
                        });
                    });
                }

                await interaction.editReply({ embeds: [embed] });
            } else if (subcommand === 'add') {
                const name = interaction.options.getString('name');
                const price = interaction.options.getInteger('price');
                const description = interaction.options.getString('description');
                const roleId = interaction.options.getString('role_id');

                // 商品名の重複チェック
                if (config.COIN_ITEMS.some(item => item.name === name)) {
                    return interaction.editReply('この商品名は既に使用されています。');
                }

                // ロールの存在確認
                const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
                if (!role) {
                    return interaction.editReply('指定されたロールが見つかりません。');
                }

                // 商品の追加
                config.COIN_ITEMS.push({
                    id: Date.now().toString(),
                    name,
                    price,
                    description,
                    roleId
                });

                const embed = new EmbedBuilder()
                    .setTitle('商品追加完了')
                    .setColor('#00ff00')
                    .setDescription('新しい商品を追加しました。')
                    .addFields(
                        { name: '商品名', value: name, inline: true },
                        { name: '価格', value: `${config.COIN_SYMBOL} ${price.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '説明', value: description },
                        { name: 'ロールID', value: roleId }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else if (subcommand === 'remove') {
                const name = interaction.options.getString('name');
                const itemIndex = config.COIN_ITEMS.findIndex(item => item.name === name);

                if (itemIndex === -1) {
                    return interaction.editReply('指定された商品が見つかりません。');
                }

                const removedItem = config.COIN_ITEMS.splice(itemIndex, 1)[0];

                const embed = new EmbedBuilder()
                    .setTitle('商品削除完了')
                    .setColor('#ff0000')
                    .setDescription('商品を削除しました。')
                    .addFields(
                        { name: '商品名', value: removedItem.name, inline: true },
                        { name: '価格', value: `${config.COIN_SYMBOL} ${removedItem.price.toLocaleString()} ${config.COIN_NAME}`, inline: true },
                        { name: '説明', value: removedItem.description },
                        { name: 'ロールID', value: removedItem.roleId }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } else if (subcommand === 'edit') {
                const name = interaction.options.getString('name');
                const field = interaction.options.getString('field');
                const value = interaction.options.getString('value');
                const itemIndex = config.COIN_ITEMS.findIndex(item => item.name === name);

                if (itemIndex === -1) {
                    return interaction.editReply('指定された商品が見つかりません。');
                }

                const item = config.COIN_ITEMS[itemIndex];
                const oldValue = item[field];

                // 値の検証
                if (field === 'price') {
                    const newPrice = parseInt(value);
                    if (isNaN(newPrice) || newPrice < 1) {
                        return interaction.editReply('価格は1以上の整数を指定してください。');
                    }
                    item.price = newPrice;
                } else if (field === 'role_id') {
                    const role = await interaction.guild.roles.fetch(value).catch(() => null);
                    if (!role) {
                        return interaction.editReply('指定されたロールが見つかりません。');
                    }
                    item.roleId = value;
                } else if (field === 'name') {
                    if (config.COIN_ITEMS.some(item => item.name === value)) {
                        return interaction.editReply('この商品名は既に使用されています。');
                    }
                    item.name = value;
                } else {
                    item[field] = value;
                }

                const embed = new EmbedBuilder()
                    .setTitle('商品編集完了')
                    .setColor('#00ff00')
                    .setDescription('商品の情報を更新しました。')
                    .addFields(
                        { name: '商品名', value: item.name, inline: true },
                        { name: '編集項目', value: field, inline: true },
                        { name: '変更前', value: oldValue.toString(), inline: true },
                        { name: '変更後', value: value, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('ショップ管理エラー:', error);
            await interaction.editReply('ショップ管理コマンドの実行中にエラーが発生しました。');
        }
    },
};
