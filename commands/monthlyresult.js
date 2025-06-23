const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { calculateVoiceLevel, getAllKeys } = require('../utils/utility.js');

// 描画用のヘルパー関数 (変更なし)
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
    ctx.fill();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('monthlyresult')
        .setDescription('月間ボイスレベルランキングのリザルト画像を生成します。')
        .addStringOption(option =>
            option.setName('month')
                .setDescription('対象の月をYYYY-MM 形式で指定 (例: 2025-05)。未指定の場合は先月になります。')
                .setRequired(false)),

    async execute(interaction, redis) {
        await interaction.deferReply();

        let targetMonth = interaction.options.getString('month');
        if (!targetMonth) {
            const now = new Date();
            now.setMonth(now.getMonth() - 1);
            targetMonth = now.toISOString().slice(0, 7);
        }

        try {
            const fetchUsers = async (keys) => {
                const users = [];
                for (const key of keys) {
                    try {
                        const xp = await redis.get(key);
                        const userId = key.split(':')[3];
                        if (xp && userId) {
                            users.push({ userId, xp: Number(xp) });
                        }
                    } catch (error) {
                        if (error.message.includes('WRONGTYPE')) {
                            console.error(`Skipping corrupted key (WRONGTYPE): ${key}`);
                        } else {
                            throw error;
                        }
                    }
                }
                return users.sort((a, b) => b.xp - a.xp).slice(0, 10);
            };

            const voiceKeys = await getAllKeys(redis, `monthly_xp:voice:${targetMonth}:*`);
            const topVoiceUsers = await fetchUsers(voiceKeys);
            
            if (topVoiceUsers.length === 0) {
                return interaction.editReply(`${targetMonth} のボイスランキングデータが見つかりませんでした。`);
            }

            const canvasWidth = 600;
            const canvasHeight = 800;
            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 48px "Noto Sans CJK JP"';
            ctx.textAlign = 'center';
            ctx.fillText(`${targetMonth}月度 月間ボイスランキング`, canvasWidth / 2, 70);

            // ボイスランキングのみ描画
            const drawRanking = async (users, startX) => {
                const title = '🎤 VOICE';
                const color = '#3BA55D';

                ctx.fillStyle = color;
                ctx.font = 'bold 32px "Noto Sans CJK JP"';
                ctx.textAlign = 'center';
                ctx.fillText(title, startX + 275, 140);
                
                let yPos = 200;
                for (let i = 0; i < users.length; i++) {
                    const user = users[i];
                    try {
                        const discordUser = await interaction.client.users.fetch(user.userId);
                        const level = calculateVoiceLevel(user.xp);

                        ctx.fillStyle = '#FFFFFF';
                        ctx.font = 'bold 28px "Noto Sans CJK JP"';
                        ctx.textAlign = 'left';
                        ctx.fillText(`${i + 1}.`, startX + 20, yPos + 28);
                        
                        const avatar = await loadImage(discordUser.displayAvatarURL({ extension: 'png', size: 64 }));
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(startX + 90, yPos + 25, 25, 0, Math.PI * 2, true);
                        ctx.clip();
                        ctx.drawImage(avatar, startX + 65, yPos, 50, 50);
                        ctx.restore();

                        ctx.fillStyle = '#FFFFFF';
                        ctx.font = '24px "Noto Sans CJK JP"';
                        ctx.fillText(discordUser.username, startX + 135, yPos + 30, 250);

                        ctx.fillStyle = '#B9BBBE';
                        ctx.font = '20px "Noto Sans CJK JP"';
                        ctx.textAlign = 'right';
                        ctx.fillText(`Lv.${level} (${user.xp} XP)`, startX + 530, yPos + 30);
                        
                        yPos += 60;

                    } catch (e) { console.error(`Failed to process user ${user.userId}`, e); }
                }
            };
            
            await drawRanking(topVoiceUsers, 0);

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `monthly-result-${targetMonth}.png` });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Monthly result generation error:', error);
            await interaction.editReply('リザルト画像の生成中にエラーが発生しました。');
        }
    },
};