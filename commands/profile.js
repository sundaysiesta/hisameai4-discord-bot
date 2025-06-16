const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { getGenerationRoleName, toKanjiNumber } = require('../utils/utility.js');
const { notion, getNotionPropertyText, getNotionRelationTitles, getNotionRelationData } = require('../utils/notionHelpers.js');
const config = require('../config.js');

/**
 * 角丸の四角形を描画するヘルパー関数
 */
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

/**
 * テキストを折り返して描画するヘルパー関数
 */
function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines) {
    const isDummyRun = typeof context.fillText !== 'function';
    const lines = text.split('\n');
    let lineCount = 0;

    for (const line of lines) {
        if (maxLines && lineCount >= maxLines) break;
        let currentLine = '';
        const words = line.split('');
        for (let n = 0; n < words.length; n++) {
            const testLine = currentLine + words[n];
            const metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                if (!isDummyRun) context.fillText(currentLine, x, y);
                currentLine = words[n];
                y += lineHeight;
                lineCount++;
                if (maxLines && lineCount >= maxLines) {
                    currentLine = ''; 
                    break;
                }
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
             if (!isDummyRun) context.fillText(currentLine, x, y);
             y += lineHeight;
             lineCount++;
        }
    }
    return lineCount;
}

/**
 * 称号の配列をフォーマットするヘルパー関数
 * シンプルな2列表示を行う
 */
function formatTitles(titles) {
    if (!titles || titles.length === 0) return 'なし';
    
    let formattedString = '';
    titles.forEach((title, index) => {
        const trimmedTitle = title.trim();
        if (!trimmedTitle) return;
        formattedString += trimmedTitle;
        if (index < titles.length - 1) {
            if ((index + 1) % 2 === 0) {
                formattedString += '\n';
            } else {
                formattedString += ' ';
            }
        }
    });

    return formattedString || 'なし';
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
            // Notionからユーザーデータを取得
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
            
            // プロフィール情報の整形
            const nameValue = getNotionPropertyText(props['名前']);
            const generationNames = await getNotionRelationData(notion, props['世代']);
            let generationValue = '不明';
            if (generationNames.length > 0 && generationNames[0]?.title) {
                generationValue = generationNames[0].title;
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
            const hazardValue = await getNotionRelationTitles(notion, props['危険等級']);
            const hazardValueText = hazardValue.length > 0 ? hazardValue.join(', ') : 'なし';


            const titleData = await getNotionRelationData(notion, props['称号'], '開催日');
            titleData.sort((a, b) => new Date(b.date) - new Date(a.date));
            const emojiRegex = /[\p{Emoji_Presentation}\p{Emoji}\p{Emoji_Modifier_Base}\p{Emoji_Modifier}\p{Emoji_Component}]/gu;
            let titleValue = 'なし';
            
            if (titleData.length > 0) {
                // 称号処理（絵文字の削除のみ）
                const topThreeTitles = titleData
                    .slice(0, 3)
                    .map(item => item.title.replace(emojiRegex, '').trim())
                    .filter(Boolean);

                titleValue = formatTitles(topThreeTitles);
                if (titleData.length > 3) {
                    titleValue += `\n他${titleData.length - 3}個`;
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

            const dummyCanvas = createCanvas(1, 1);
            const dummyCtx = dummyCanvas.getContext('2d');
            
            // --- 【修正】動的な高さ計算 ---
            dummyCtx.font = '22px "Noto Sans CJK JP"';
            
            const titleLineHeight = 35;
            const titleMaxLines = 3;
            // 称号の実際の行数を計算
            const titleLineCount = wrapText(dummyCtx, titleValue, 0, 0, 550, titleLineHeight, titleMaxLines);
            
            const descriptionLineHeight = 32;
            const descriptionMaxLines = 4;
            const descriptionLineCount = wrapText(dummyCtx, finalDescription, 0, 0, 934 - 80, descriptionLineHeight, descriptionMaxLines);
            const descriptionBlockHeight = descriptionLineCount > 0 ? (descriptionLineCount * descriptionLineHeight) : descriptionLineHeight;

            // 称号が3行の場合の高さを基準とし、行数が少ない分だけ高さを減らす
            const topSectionHeight = 340 - ((titleMaxLines - titleLineCount) * titleLineHeight);
            const separatorPadding = 25;
            const bottomMargin = 40;

            const canvasHeight = topSectionHeight + separatorPadding + 1 + separatorPadding + descriptionBlockHeight + bottomMargin;

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
            const avatarX = margin + 45;
            const avatarY = margin + 40;
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

            const contentStartX = avatarX + avatarSize + 50;
            ctx.fillStyle = '#FFFFFF';

            ctx.font = 'bold 42px "Noto Sans CJK JP"';
            ctx.fillText(nameValue, contentStartX, 85);

            ctx.font = '22px "Noto Sans CJK JP"';
            const detailY = 145;
            const detailLineHeight = 38;
            const col1X = contentStartX;
            const col2X = col1X + 250;
            
            ctx.fillText(`世代: ${generationValue}`, col1X, detailY);
            ctx.fillText(`性別: ${genderValue === 'N/A' ? '不明' : genderValue}`, col1X, detailY + detailLineHeight);
            ctx.fillText(`生年度: ${birthYearValue === 'N/A' ? '不明' : birthYearValue}`, col1X, detailY + detailLineHeight * 2);

            ctx.fillText(`出身地: ${birthplaceValue === 'N/A' ? '不明' : birthplaceValue}`, col2X, detailY);
            ctx.fillText(`界隈: ${communityValue}`, col2X, detailY + detailLineHeight);
            ctx.fillText(`危険等級: ${hazardValueText}`, col2X, detailY + detailLineHeight * 2);

            const titleY = detailY + detailLineHeight * 3 + 15;
            ctx.font = 'bold 22px "Noto Sans CJK JP"';
            ctx.fillText('称号:', col1X, titleY);
            ctx.font = '22px "Noto Sans CJK JP"';
            wrapText(ctx, titleValue, col1X + 70, titleY, 550, 35, 3);
            
            const separatorY = topSectionHeight + separatorPadding;
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin + 40, separatorY);
            ctx.lineTo(canvas.width - margin - 40, separatorY);
            ctx.stroke();

            ctx.font = '22px "Noto Sans CJK JP"';
            const descriptionY = separatorY + separatorPadding;
            wrapText(ctx, finalDescription, margin + 40, descriptionY, canvas.width - (margin * 2) - 80, descriptionLineHeight, descriptionMaxLines);

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'profile-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Notion API /profile error:', error);
            await interaction.editReply('プロフィールの取得中にエラーが発生しました。');
        }
    },
};