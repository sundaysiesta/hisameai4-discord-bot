const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ChannelType } = require('discord.js');
const { calculateTextLevel, calculateVoiceLevel } = require('../utils/utility.js');
const config = require('../config.js');

const createLeaderboardEmbed = async (users, page, totalPages, title, type) => {
    const start = page * 10;
    const end = start + 10;
    const currentUsers = users.slice(start, end);

    const descriptionPromises = currentUsers.map(async (u, i) => {
        const level = type === 'text' ? calculateTextLevel(u.xp) : calculateVoiceLevel(u.xp);
        return `**${start + i + 1}位:** <@${u.userId}> - Lv.${level} (${u.xp.toLocaleString()} XP)`;
    });

    const description = (await Promise.all(descriptionPromises)).join('\n');

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || 'データがありません。')
        .setColor(0xFFA500)
        .setFooter({ text: `ページ ${page + 1} / ${totalPages}` })
        .setTimestamp();
};

const createClubLeaderboardEmbed = async (clubs, page, totalPages, guild, redis) => {
    const start = page * 10;
    const end = start + 10;
    const currentClubs = clubs.slice(start, end);

    const descriptionPromises = currentClubs.map(async (club, i) => {
        const leaderRoleId = await redis.get(`leader_roles:${club.id}`);
        let leaderMention = '未設定';
        if (leaderRoleId) {
            const role = await guild.roles.fetch(leaderRoleId, { force: true }).catch(() => null);
            if (role) {
                if (role.members.size > 0) {
                    leaderMention = role.members.map(m => m.toString()).join(', ');
                } else {
                    leaderMention = '不在';
                }
            }
        }

        // 部員数の計算
        const messages = await guild.channels.cache.get(club.id)?.messages.fetch({ limit: 100 }).catch(() => null);
        let memberCount = 0;
        if (messages) {
            const messageCounts = new Map();
            messages.forEach(msg => {
                if (!msg.author.bot) {
                    const count = messageCounts.get(msg.author.id) || 0;
                    messageCounts.set(msg.author.id, count + 1);
                }
            });
            memberCount = Array.from(messageCounts.entries())
                .filter(([_, count]) => count >= 5)
                .length;
        }

        return `**${start + i + 1}位:** <#${club.id}>  **部長:** ${leaderMention}  **部員数:** ${memberCount}人`;
    });

    const description = (await Promise.all(descriptionPromises)).join('\n');

    return new EmbedBuilder()
        .setTitle('部活アクティブランキング (週間)')
        .setDescription(description || 'データがありません。')
        .setColor(0x5865F2)
        .setFooter({ text: `ページ ${page + 1} / ${totalPages}` })
        .setTimestamp();
};

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
                    { name: '部活', value: 'club' }
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

        if (type === 'club') {
            const guild = interaction.guild;
            const category = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
            if (!category) return interaction.editReply({ content: "部活カテゴリが見つかりません。" });

            const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
            let ranking = [];
            for (const channel of clubChannels.values()) {
                const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
                
                // 部員数の計算
                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                let memberCount = 0;
                if (messages) {
                    const messageCounts = new Map();
                    messages.forEach(msg => {
                        if (!msg.author.bot) {
                            const count = messageCounts.get(msg.author.id) || 0;
                            messageCounts.set(msg.author.id, count + 1);
                        }
                    });
                    memberCount = Array.from(messageCounts.entries())
                        .filter(([_, count]) => count >= 5)
                        .length;
                }

                // メッセージ数と部員数を組み合わせたスコアを計算
                const score = (Number(count) * 0.7) + (memberCount * 0.3);
                ranking.push({ 
                    id: channel.id, 
                    name: channel.name, 
                    count: Number(count), 
                    memberCount: memberCount,
                    score: score,
                    position: channel.position 
                });
            }
            ranking.sort((a, b) => (b.score !== a.score) ? b.score - a.score : a.position - b.position);

            const totalPages = Math.ceil(ranking.length / 10) || 1;
            let page = 0;

            const embed = await createClubLeaderboardEmbed(ranking, page, totalPages, guild, redis);
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
                
                const newEmbed = await createClubLeaderboardEmbed(ranking, page, totalPages, guild, redis);
                row.components[0].setDisabled(page === 0);
                row.components[1].setDisabled(page >= totalPages - 1);
                
                await i.update({ embeds: [newEmbed], components: [row] });
            });

            collector.on('end', () => {
                row.components.forEach(c => c.setDisabled(true));
                reply.edit({ components: [row] }).catch(()=>{});
            });
            return;
        }

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

            const embed = await createLeaderboardEmbed(sortedUsers, page, totalPages, title, type);
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
                
                const newEmbed = await createLeaderboardEmbed(sortedUsers, page, totalPages, title, type);
                row.components[0].setDisabled(page === 0);
                row.components[1].setDisabled(page >= totalPages - 1);
                
                await i.update({ embeds: [newEmbed], components: [row] });
            });

            collector.on('end', () => {
                row.components.forEach(c => c.setDisabled(true));
                reply.edit({ components: [row] }).catch(()=>{});
            });

        } catch (error) {
            console.error("Leaderboard error:", error);
            await interaction.editReply("ランキングの表示中にエラーが発生しました。");
        }
    },
};
