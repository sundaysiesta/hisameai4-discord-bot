const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { getGenerationRoleName, toKanjiNumber, toHalfWidth } = require('../utils/utility.js');
// 【最重要修正】getNotionRelationTitlesをインポートリストに追加
const { notion, getNotionPropertyText, getNotionRelationTitles, getNotionRelationData } = require('../utils/notionHelpers.js');
const config = require('../config.js');

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

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const lines = text.split('\n');
    let lineCount = 0;
    for (const line of lines) {
        if (maxLines && lineCount >= maxLines) break;
        let currentLine = '';
        const words = line.split('');
        for(let n = 0; n < words.length; n++) {
            const testLine = currentLine + words[n];
            const metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                context.fillText(currentLine, x, y);
                currentLine = words[n];
                y += lineHeight;
                lineCount++;
                 if (maxLines && lineCount >= maxLines) return lineCount;
            } else {
                currentLine = testLine;
            }
        }
        context.fillText(currentLine, x, y);
        y += lineHeight;
        lineCount++;
    }
    return lineCount;
}

function formatTitles(titles) {
    let formattedString = "";
    for (let i = 0; i < titles.length; i++) {
        formattedString += titles[i];
        if ((i + 1) % 2 === 0 && i < titles.length - 1) {
            formattedString += "\n";
        } else if (i < titles.length - 1) {
            formattedString += "、 ";
        }
    }
    return formattedString;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('プロフィールを画像で表示します。ユーザー指定か名前検索、または自身のプロフを表示します。')
        .addUserOption(option => option.setName('user').setDescription('プロフィールを表示したいユーザー').setRequired(false))
        .addStringOption(option => option.setName('name').setDescription('Notionデータベースの名前で検索').setRequired(false)),
    async execute(interaction, redis, notion) {
        await interaction.deferReply();
        const userOption = interaction.options.getUser('user');
        const nameOption = interaction.options.getString('name');

        let notionPage;
        let targetUser;

        try {
            if (nameOption) {
                const response = await notion.databases.query({ database_id: config.NOTION_DATABASE_ID, filter: { property: '名前', title: { equals: nameOption } } });
                if (response.results.length === 0) return interaction.editReply(`名前「${nameOption}」のプロフィールは見つかりませんでした。`);
                notionPage = response.results[0];
                const discordId = getNotionPropertyText(notionPage.properties['DiscordユーザーID']);
                targetUser = discordId !== 'N/A' ? await interaction.client.users.fetch(discordId).catch(() => interaction.user) : interaction.user;
            } else {
                targetUser = userOption || interaction.user;
                const response = await notion.databases.query({ database_id: config.NOTION_DATABASE_ID, filter: { property: 'DiscordユーザーID', rich_text: { equals: targetUser.id } } });
                if (response.results.length === 0) return interaction.editReply(`${targetUser.username} さんのプロフィールはまだ登録されていません。`);
                notionPage = response.results[0];
            }

            const props = notionPage.properties;
            
            const nameValue = getNotionPropertyText(props['名前']);
            
            const generationNames = await getNotionRelationData(notion, props['世代']);
            let generationValue = '不明';
            if (generationNames.length > 0 && generationNames[0]?.title) {
                const genText = generationNames[0].title;
                const halfWidthText = toHalfWidth(genText);
                const match = halfWidthText.match(/第(\d+)世代/);
                generationValue = (match && match[1]) ? `第${toKanjiNumber(parseInt(match[1], 10))}世代` : genText;
            }

            let borderColor = '#747F8D';
            if (generationNames.length > 0 && generationNames[0]?.title) {
                const romanRoleName = getGenerationRoleName(generationNames[0].title);
                if (romanRoleName) {
                    const role = interaction.guild.roles.cache.find(r => r.name === romanRoleName);
                    if (role && role.color !== 0) borderColor = role.hexColor;
                }
            }
            
            const genderValue = getNotionPropertyText(props['性別']);
            const birthYearValue = getNotionPropertyText(props['生年度']);
            const birthplaceValue = getNotionPropertyText(props['出身地']);
            const communityNames = await getNotionRelationTitles(notion, props['界隈']);
            const communityValue = communityNames.length > 0 ? communityNames.join(', ') : '不明';
            const hazardNames = await getNotionRelationTitles(notion, props['危険等級']);
            const hazardValue = hazardNames.length > 0 ? hazardNames.join(', ') : 'なし';

            const titleData = await getNotionRelationData(notion, props['称号'], '開催日');
            titleData.sort((a, b) => new Date(b.date) - new Date(a.date));
            const emojiRegex = /[\p{Emoji_Presentation}\p{Emoji}\p{Emoji_Modifier_Base}\p{Emoji_Modifier}\p{Emoji_Component}]/gu;
            let titleValue = 'なし';
            if (titleData.length > 0) {
                const topThreeTitles = titleData.slice(0, 3).map(item => item.title.replace(emojiRegex, '').trim());
                titleValue = formatTitles(topThreeTitles);
                if (titleData.length > 3) {
                    titleValue += `、他${titleData.length - 3}個`;
                }
            }
            
            const descriptionValue = getNotionPropertyText(props['説明']);
            const tempDescriptionValue = getNotionPropertyText(props['仮説明']);
            let finalDescription = '`/settempdesc` で仮説明文を送信してください';
            if (descriptionValue !== 'N/A' && descriptionValue.trim() !== '') {
                finalDescription = descriptionValue;
            } else if (tempDescriptionValue !== 'N/A' && tempDescriptionValue.trim() !== '') {
                finalDescription = tempDescriptionValue;
            }

            const dummyCtx = createCanvas(1, 1).getContext('2d');
            dummyCtx.font = '22px "Noto Sans CJK JP"';
            const baseHeight = 350;
            const lineHeight = 30;
            let lineCount = wrapText(dummyCtx, finalDescription, 0, 0, 934 - 40 * 2, lineHeight);
            const descriptionHeight = lineCount * lineHeight;
            const canvasHeight = baseHeight + descriptionHeight;
            
            const canvas = createCanvas(934, canvasHeight);
            const ctx = canvas.getContext('2d');
            
            const backgroundUrl = props['プロフカードURL']?.url;
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
            ctx.fillStyle = 'rgba(35, 39, 42, 0.85)';
            drawRoundRect(ctx, margin, margin, canvas.width - margin * 2, canvas.height - margin * 2, panelRadius);
            ctx.fill();
            
            const avatarSize = 150;
            const avatarX = margin + 40;
            const avatarY = margin + 30;
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
            
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 5, 0, Math.PI * 2, false);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 10;
            ctx.stroke();

            ctx.fillStyle = '#FFFFFF';
            const contentStartX = avatarX + avatarSize + 50;

            // 名前
            ctx.font = 'bold 42px "Noto Sans CJK JP"';
            ctx.fillText(nameValue, contentStartX, 85);

            // 詳細情報 (3列レイアウト)
            ctx.font = '22px "Noto Sans CJK JP"';
            const detailY = 145;
            const detailLineHeight = 35;
            const col1X = contentStartX;
            const col2X = contentStartX + 220;
            const col3X = contentStartX + 440;
            
            ctx.fillText(`世代: ${generationValue}`, col1X, detailY);
            ctx.fillText(`性別: ${genderValue === 'N/A' ? '不明' : genderValue}`, col1X, detailY + detailLineHeight);
            ctx.fillText(`生年度: ${birthYearValue === 'N/A' ? '不明' : birthYearValue}`, col1X, detailY + detailLineHeight * 2);

            ctx.fillText(`出身地: ${birthplaceValue === 'N/A' ? '不明' : birthplaceValue}`, col2X, detailY);
            ctx.fillText(`界隈: ${communityValue}`, col2X, detailY + detailLineHeight);
            ctx.fillText(`危険等級: ${hazardValue}`, col2X, detailY + detailLineHeight * 2);
            
            const titleY = detailY + detailLineHeight * 3 + 10;
            ctx.font = 'bold 22px "Noto Sans CJK JP"';
            ctx.fillText('称号:', col1X, titleY);
            ctx.font = '22px "Noto Sans CJK JP"';
            wrapText(ctx, titleValue, col1X, titleY + 35, 600, 35, 3);
            
            const separatorY = canvas.height - margin - 50 - descriptionHeight;
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin + 40, separatorY);
            ctx.lineTo(canvas.width - margin - 40, separatorY);
            ctx.stroke();

            ctx.font = '22px "Noto Sans CJK JP"';
            wrapText(ctx, finalDescription, margin + 40, separatorY + 20, canvas.width - (margin * 2) - 80, lineHeight);

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Notion API /profile error:', error);
            await interaction.editReply('プロフィールの取得中にエラーが発生しました。');
        }
    },
};
