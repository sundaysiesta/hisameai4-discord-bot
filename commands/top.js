const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { calculateTextLevel, calculateVoiceLevel } = require('../utils/utility.js');
const config = require('../config.js');

async function createLeaderboardEmbed(users, page, totalPages, title, type, client) {
    const startIndex = page * 10;
    const endIndex = Math.min(startIndex + 10, users.length);
    const pageUsers = users.slice(startIndex, endIndex);

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(title)
        .setTimestamp();

    let description = '';
    for (let i = 0; i < pageUsers.length; i++) {
        const user = pageUsers[i];
        const rank = startIndex + i + 1;
        const userData = await client.users.fetch(user.userId).catch(() => null);
        const username = userData ? userData.username : '不明なユーザー';
        
        let xpDisplay;
        if (type === 'coin') {
            xpDisplay = `${config.COIN_SYMBOL} ${user.xp.toLocaleString()} ${config.COIN_NAME}`;
        } else {
            const level = type === 'text' ? calculateTextLevel(user.xp) : calculateVoiceLevel(user.xp);
            xpDisplay = `レベル ${level} (${user.xp.toLocaleString()} XP)`;
        }
        
        description += `${rank}. ${username}: ${xpDisplay}\n`;
    }

    if (description === '') {
        description = 'データがありません。';
    }

    embed.setDescription(description);
    embed.setFooter({ text: `ページ ${page + 1}/${totalPages}` });

    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('ランキングを表示します。')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('ランキングの種類（未指定で両方表示）')
                .setRequired(false)
                .addChoices(
                    { name: 'テキスト', value: 'text' },
                    { name: 'ボイス', value: 'voice' },
                    { name: 'ロメコイン', value: 'coin' }
                ))
        .addStringOption(option => option.setName('duration').setDescription('期間（指定しない場合は全期間）').setRequired(false).addChoices({ name: '日間', value: 'daily' }, { name: '月間', value: 'monthly' }))
        .addStringOption(option => option.setName('date').setDescription('日付 (YYYY-MM-DD形式)').setRequired(false))
        .addStringOption(option => option.setName('month').setDescription('月 (YYYY-MM形式)').setRequired(false)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const type = interaction.options.getString('type');
        const duration = interaction.options.getString('duration');
        let date = interaction.options.getString('date');
        let month = interaction.options.getString('month');

        if (type === 'coin') {
            const users = [];
            const userKeys = await redis.keys('user:*');
            for(const key of userKeys) {
                const userId = key.split(':')[1];
                const mainAccountId = await redis.hget(key, 'mainAccountId');
                if (!mainAccountId || mainAccountId === userId) {  // メインアカウントのみを集計
                    const balance = await redis.hget(key, 'balance');
                    if (balance) {
                        users.push({ userId, xp: Number(balance) });
                    }
                }
            }
            users.sort((a, b) => b.xp - a.xp);
            const totalPages = Math.max(1, Math.ceil(users.length / 10));
            let page = 0;

            const embed = await createLeaderboardEmbed(users, page, totalPages, 'ロメコインランキング', 'coin', interaction.client);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('前へ').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1)
            );

            const message = await interaction.editReply({ embeds: [embed], components: [row] });
            
            if (totalPages > 1) {
                const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
                collector.on('collect', async i => {
                    if (i.user.id === interaction.user.id) {
                        if (i.customId === 'prev') page--;
                        else if (i.customId === 'next') page++;

                        const newEmbed = await createLeaderboardEmbed(users, page, totalPages, 'ロメコインランキング', 'coin', interaction.client);
                        row.components[0].setDisabled(page === 0);
                        row.components[1].setDisabled(page === totalPages - 1);

                        await i.update({ embeds: [newEmbed], components: [row] });
                    }
                });
            }
            return;
        }

        // 既存のテキスト・ボイスXPランキング処理
        if (!type) {
            const textUsers = [];
            const voiceUsers = [];
            const userKeys = await redis.keys('user:*');
            for(const key of userKeys) {
                const userId = key.split(':')[1];
                const textXp = await redis.hget(key, 'textXp');
                const voiceXp = await redis.hget(key, 'voiceXp');
                if(textXp) textUsers.push({ userId, xp: Number(textXp) });
                if(voiceXp) voiceUsers.push({ userId, xp: Number(voiceXp) });
            }
            
            const top10Text = textUsers.sort((a,b) => b.xp-a.xp).slice(0, 10);
            const top10Voice = voiceUsers.sort((a,b) => b.xp-a.xp).slice(0, 10);

            const textDesc = top10Text.map((u, i) => {
                const level = calculateTextLevel(u.xp);
                return `**${i+1}位:** <@${u.userId}> - Lv.${level} (${u.xp} XP)`;
            }).join('\n') || 'データなし';
            const voiceDesc = top10Voice.map((u, i) => {
                const level = calculateVoiceLevel(u.xp);
                return `**${i+1}位:** <@${u.userId}> - Lv.${level} (${u.xp} XP)`;
            }).join('\n') || 'データなし';
            
            const embed = new EmbedBuilder().setTitle('総合レベルランキングTOP10').setColor(0x0099ff).setTimestamp().addFields(
                { name: '💬 テキスト', value: textDesc, inline: true },
                { name: '🎤 ボイス', value: voiceDesc, inline: true }
            );
            return interaction.editReply({ embeds: [embed] });
        }

        let redisKeyPattern;
        let title;
        if (duration === 'daily') {
            date = date || new Date().toISOString().slice(0, 10);
            redisKeyPattern = `daily_xp:${type}:${date}:*`;
            title = `${date} の${type === 'text' ? 'テキスト' : 'ボイス'}ランキング`;
        } else if (duration === 'monthly') {
            month = month || new Date().toISOString().slice(0, 7);
            redisKeyPattern = `monthly_xp:${type}:${month}:*`;
            title = `${month}月 の${type === 'text' ? 'テキスト' : 'ボイス'}ランキング`;
        } else {
            redisKeyPattern = `user:*`;
            title = `全期間 ${type === 'text' ? 'テキスト' : 'ボイス'}ランキング`;
        }
        
        try {
            const keys = await redis.keys(redisKeyPattern);
            if (keys.length === 0) return interaction.editReply('ランキングデータがありません。');
            
            const usersData = [];
            for (const key of keys) {
                let xp;
                if (duration) {
                    xp = await redis.get(key);
                } else {
                    xp = await redis.hget(key, `${type}Xp`);
                }
                if(xp) usersData.push({ userId: key.split(':').pop(), xp: Number(xp) });
            }

            const sortedUsers = usersData.sort((a, b) => b.xp - a.xp);
            
            let page = 0;
            const totalPages = Math.ceil(sortedUsers.length / 10);
            if(totalPages === 0) return interaction.editReply('ランキングデータがありません。');

            const embed = await createLeaderboardEmbed(sortedUsers, page, totalPages, title, type, interaction.client);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev_page').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('next_page').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1)
            );

            const reply = await interaction.editReply({ embeds: [embed], components: [row] });
            const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) return i.reply({ content: 'コマンド実行者のみ操作できます。', ephemeral: true });
                if(i.customId === 'prev_page') page--;
                else if(i.customId === 'next_page') page++;
                
                const newEmbed = await createLeaderboardEmbed(sortedUsers, page, totalPages, title, type, interaction.client);
                row.components[0].setDisabled(page === 0);
                row.components[1].setDisabled(page >= totalPages - 1);
                
                await i.update({ embeds: [newEmbed], components: [row] });
            });

            collector.on('end', () => {
                row.components.forEach(c => c.setDisabled(true));
                reply.edit({ components: [row] }).catch(()=>{});
            });
        } catch (error) {
            console.error('Leaderboard error:', error);
            await interaction.editReply('ランキングの取得中にエラーが発生しました。');
        }
    },
};
