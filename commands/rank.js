const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { calculateVoiceLevel, getXpForVoiceLevel, getGenerationRoleName, getAllKeys } = require('../utils/utility.js');
const { notion, getNotionRelationTitles } = require('../utils/notionHelpers.js');
const config = require('../config.js');

const formatXp = (xp) => {
    return xp.toLocaleString();
};

function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('現在のボイスレベルと経験値を表示します。')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)),
    async execute(interaction, redis, notion) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user') || interaction.user;
        
        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
            const data = await redis.hgetall(`user:${mainAccountId}`);
            
            const voiceXp = Number(data?.voiceXp) || 0;

            // すべてのユーザーのXPを取得してランク順位を計算
            const userKeys = await getAllKeys(redis, 'user:*');
            const voiceRanks = [];
            for (const key of userKeys) {
                const userData = await redis.hgetall(key);
                if (userData.voiceXp) voiceRanks.push({ id: key.split(':')[1], xp: Number(userData.voiceXp) });
            }
            voiceRanks.sort((a, b) => b.xp - a.xp);
            const voiceRank = voiceRanks.findIndex(u => u.id === mainAccountId) + 1;

            const voiceLevel = calculateVoiceLevel(voiceXp);
            const xpForCurrentVoice = getXpForVoiceLevel(voiceLevel);
            const xpForNextVoice = getXpForVoiceLevel(voiceLevel + 1);
            const neededVoice = xpForNextVoice - xpForCurrentVoice;
            const percentVoice = neededVoice > 0 ? ((voiceXp - xpForCurrentVoice) / neededVoice) : 1;
            const totalNeededVoiceXp = xpForNextVoice;  // 次のレベルまでの合計必要XP

            let borderColor = '#747F8D';
            let backgroundUrl = null;

            const notionResponse = await notion.databases.query({
                database_id: config.NOTION_DATABASE_ID,
                filter: { property: 'DiscordユーザーID', rich_text: { equals: targetUser.id } },
            });
            if (notionResponse.results.length > 0) {
                const props = notionResponse.results[0].properties;
                const generationNames = await getNotionRelationTitles(notion, props['世代']);
                if(generationNames.length > 0) {
                    const romanRoleName = getGenerationRoleName(generationNames[0]);
                    if (romanRoleName) {
                        const role = interaction.guild.roles.cache.find(r => r.name === romanRoleName);
                        if (role && role.color !== 0) borderColor = role.hexColor;
                    }
                }
                // 【追加】Notionから背景URLを取得
                if (props['ランクカード背景URL']?.url) {
                    backgroundUrl = props['ランクカード背景URL'].url;
                }
            }

            const canvas = createCanvas(934, 282);
            const ctx = canvas.getContext('2d');
            
            try {
                if (backgroundUrl) {
                    const background = await loadImage(backgroundUrl);
                    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
                } else {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            } catch (bgError) {
                console.error("Failed to load custom background, falling back to default.", bgError);
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const margin = 20;
            const panelRadius = 25;
            ctx.fillStyle = 'rgba(35, 39, 42, 0.8)';
            drawRoundRect(ctx, margin, margin, canvas.width - margin * 2, canvas.height - margin * 2, panelRadius);
            ctx.fill();

            const avatarSize = 180;
            const avatarX = margin + 30;
            const avatarY = (canvas.height - avatarSize) / 2;
            const contentX = avatarX + avatarSize + 30;
            
            ctx.font = 'bold 38px "Noto Sans CJK JP"';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(targetUser.username, contentX, 75);

            ctx.font = 'bold 24px "Noto Sans CJK JP"';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('VOICE', contentX, 125);
            ctx.font = 'bold 30px "Noto Sans CJK JP"';
            ctx.fillText(`Lv.${voiceLevel} #${voiceRank}`, contentX + 100, 125);

            // ボイスチャットのプログレスバー
            const barWidth = canvas.width - contentX - margin - 30;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            drawRoundRect(ctx, contentX, 145, barWidth, 20, 10);
            ctx.fill();
            if(percentVoice > 0) {
                ctx.fillStyle = '#32CD32';
                drawRoundRect(ctx, contentX, 145, barWidth * percentVoice, 20, 10);
                ctx.fill();
            }

            // XPテキストの描画（ボイスのみ）
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '16px "Noto Sans CJK JP"';
            ctx.textAlign = 'right';
            const voiceXpDisplay = `${formatXp(voiceXp)} / ${formatXp(xpForNextVoice)} XP`;
            ctx.fillText(voiceXpDisplay, contentX + barWidth - 5, 135);

            // サーバーアイコンを右上に追加
            const serverIconSize = 48;
            const serverIconX = canvas.width - margin - serverIconSize - 10;
            const serverIconY = margin + 10;
            try {
                const serverIcon = await loadImage(interaction.guild.iconURL({ extension: 'png', size: 128 }));
                ctx.save();
                ctx.beginPath();
                ctx.arc(serverIconX + serverIconSize/2, serverIconY + serverIconSize/2, serverIconSize/2, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(serverIcon, serverIconX, serverIconY, serverIconSize, serverIconSize);
                ctx.restore();
            } catch (error) {
                console.error('Failed to load server icon:', error);
            }

            // アバター描画
            try {
                const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();
            } catch (error) {
                console.error('Failed to load user avatar:', error);
            }

            // 画像を送信
            const buffer = canvas.toBuffer('image/png');
            const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            console.error('ランクカード生成エラー:', error);
            await interaction.editReply('ランクカードの生成中にエラーが発生しました。');
        }
    },
};
