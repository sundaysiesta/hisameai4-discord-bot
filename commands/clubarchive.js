const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const config = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clubarchive')
        .setDescription('部活を廃部化します（廃部カテゴリーに移動）。(部長のみ)'),
    async execute(interaction, redis) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const channel = interaction.channel;
        
        // 部活チャンネルかどうかチェック（人気部活カテゴリも含む）
        const isClubChannel = (
            channel.parent && (
                config.CLUB_CATEGORIES.includes(channel.parent.id) ||
                channel.parent.id === config.POPULAR_CLUB_CATEGORY_ID ||
                channel.parent.id === config.INACTIVE_CLUB_CATEGORY_ID
            )
        );
        if (!isClubChannel) {
            return interaction.editReply({ content: "このコマンドは部活チャンネルでのみ使用できます。" });
        }
        
        // 既にアーカイブカテゴリにいる場合はエラー
        if (channel.parent && (
            channel.parent.id === config.ARCHIVE_CATEGORY_ID ||
            channel.parent.id === config.ARCHIVE_OVERFLOW_CATEGORY_ID
        )) {
            return interaction.editReply({ content: "この部活は既に廃部化されています。" });
        }
        
        // 部長かどうかチェック
        const leaderUserId = await redis.get(`leader_user:${channel.id}`);
        if (!leaderUserId || leaderUserId !== interaction.user.id) {
            return interaction.editReply({ content: "このコマンドは部長のみが使用できます。" });
        }
        
        try {
            // アーカイブカテゴリを取得
            const archiveCategory = await interaction.guild.channels.fetch(config.ARCHIVE_CATEGORY_ID).catch(() => null);
            const archiveOverflowCategory = await interaction.guild.channels.fetch(config.ARCHIVE_OVERFLOW_CATEGORY_ID).catch(() => null);
            
            if (!archiveCategory || !archiveOverflowCategory) {
                return interaction.editReply({ content: "アーカイブカテゴリが見つかりませんでした。" });
            }
            
            // アーカイブカテゴリの現在のチャンネル数を確認
            const currentArchiveChannels = archiveCategory.children.cache.filter(ch => ch.type === ChannelType.GuildText).size;
            const maxArchiveChannels = 50;
            
            // アーカイブカテゴリが50個を超える場合はオーバーフローカテゴリに移動
            const targetCategory = currentArchiveChannels >= maxArchiveChannels ? archiveOverflowCategory : archiveCategory;
            
            // チャンネルをアーカイブカテゴリに移動
            await channel.setParent(targetCategory, { 
                lockPermissions: false,
                reason: `部長による廃部化: ${interaction.user.username} (${interaction.user.id})`
            });
            
            const embed = new EmbedBuilder()
                .setTitle('📦 部活廃部化')
                .setDescription(`部活「${channel.name}」を廃部化しました。`)
                .setColor(0x808080)
                .addFields(
                    { name: '移動先カテゴリ', value: targetCategory.name, inline: true },
                    { name: '実行者', value: interaction.user.toString(), inline: true }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Clubarchive command error:', error);
            await interaction.editReply({ content: '廃部化処理中にエラーが発生しました。' });
        }
    },
};

