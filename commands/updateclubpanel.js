const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../config.js');

// 週間ランキングの埋め込みを作成する関数
async function createWeeklyRankingEmbed(client, redis) {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return null;

        let allClubChannels = [];
        
        // 両方のカテゴリーから部活チャンネルを取得
        for (const categoryId of config.CLUB_CATEGORIES) {
            const category = await guild.channels.fetch(categoryId).catch(() => null);
            if (category && category.type === ChannelType.GuildCategory) {
                const clubChannels = category.children.cache.filter(ch => 
                    !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                    ch.type === ChannelType.GuildText
                );
                allClubChannels.push(...clubChannels.values());
            }
        }
        
        if (allClubChannels.length === 0) return null;
        
        // メッセージ数とアクティブ部員数でランキングを作成
        let ranking = [];
        for (const channel of allClubChannels) {
            const messageCount = await redis.get(`weekly_message_count:${channel.id}`) || 0;
            
            // アクティブ部員数を計算（過去100メッセージから）
            const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());
            const messageCounts = new Map();
            messages.forEach(msg => {
                if (!msg.author.bot) {
                    const count = messageCounts.get(msg.author.id) || 0;
                    messageCounts.set(msg.author.id, count + 1);
                }
            });
            const activeMembers = Array.from(messageCounts.entries())
                .filter(([_, count]) => count >= 5)
                .length;
            
            ranking.push({ 
                id: channel.id, 
                name: channel.name,
                messageCount: Number(messageCount), 
                activeMembers,
                position: channel.position
            });
        }
        
        // メッセージ数でソート（同じ場合はアクティブ部員数でソート）
        ranking.sort((a, b) => {
            if (b.messageCount !== a.messageCount) {
                return b.messageCount - a.messageCount;
            }
            if (b.activeMembers !== a.activeMembers) {
                return b.activeMembers - a.activeMembers;
            }
            return a.position - b.position;
        });
        
        // トップ10のみ表示
        const top10 = ranking.slice(0, 10);
        
        let rankingText = '';
        for (let i = 0; i < top10.length; i++) {
            const club = top10[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            rankingText += `${medal} **${club.name}**\n`;
            rankingText += `   📊 メッセージ: ${club.messageCount} | 👥 アクティブ: ${club.activeMembers}人\n\n`;
        }
        
        if (rankingText === '') {
            rankingText = 'データがありません';
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🏆 週間部活ランキング')
            .setDescription('アクティブ・部員数順の週間ランキングです\n（日曜0時に更新）')
            .addFields(
                { name: '📈 ランキング', value: rankingText, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'HisameAI Mark.4' });
            
        return embed;
    } catch (error) {
        console.error('週間ランキング作成エラー:', error);
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updateclubpanel')
        .setDescription('部活作成パネルを手動で更新します（管理者限定）'),
    async execute(interaction, redis) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', ephemeral: true });
        }
        
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const panelChannel = await interaction.client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
            if (!panelChannel) {
                return interaction.editReply('部活作成パネルチャンネルが見つかりません。');
            }
            
            // 既存のメッセージを削除
            const messages = await panelChannel.messages.fetch({ limit: 10 });
            const oldMessages = messages.filter(msg => 
                msg.author.id === interaction.client.user.id && 
                msg.components.length > 0 &&
                msg.components[0].components.some(comp => comp.customId === config.CREATE_CLUB_BUTTON_ID)
            );
            
            for (const msg of oldMessages.values()) {
                await msg.delete().catch(() => {});
            }
            
            // 週間ランキングを取得
            const rankingEmbed = await createWeeklyRankingEmbed(interaction.client, redis);
            
            // 部活作成パネルの埋め込みを作成
            const clubPanelEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎫 部活作成パネル')
                .setDescription('新しい部活を設立するには、下のボタンを押してください。\n\n**部活設立の流れ：**\n1. ボタンを押して部活作成フォームを開く\n2. 部活名と活動内容を入力\n3. 部活チャンネルが自動で作成される\n4. 部長ロールが付与される\n\n**注意事項：**\n• 部活作成は24時間に1回まで\n• 部活名は分かりやすい名前にする\n• 活動内容は具体的に記入する')
                .addFields(
                    { name: '📋 必要な情報', value: '• 部活名\n• 活動内容', inline: true },
                    { name: '⏰ 作成制限', value: '24時間に1回', inline: true },
                    { name: '🎯 作成場所', value: 'カテゴリー1または2', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'HisameAI Mark.4' });

            // 週間ランキングと部活作成パネルを送信
            const messagePayload = {
                embeds: rankingEmbed ? [rankingEmbed, clubPanelEmbed] : [clubPanelEmbed],
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
            };
            
            await panelChannel.send(messagePayload);
            
            await interaction.editReply('部活作成パネルを更新しました。');
            
        } catch (error) {
            console.error('部活作成パネル更新エラー:', error);
            await interaction.editReply('部活作成パネルの更新中にエラーが発生しました。');
        }
    },
};
