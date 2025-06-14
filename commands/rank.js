const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { calculateTextLevel, getXpForTextLevel, calculateVoiceLevel, getXpForVoiceLevel } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('現在のレベルと経験値を表示します。')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('確認したいユーザー（指定しない場合は自分）')
                .setRequired(false)),
    async execute(interaction, redis) {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id);
        
        try {
            const mainAccountId = await redis.hget(`user:${targetUser.id}`, 'mainAccountId') || targetUser.id;
            const data = await redis.hgetall(`user:${mainAccountId}`);
            const textXp = data?.textXp || 0;
            const voiceXp = data?.voiceXp || 0;

            const textLevel = calculateTextLevel(textXp);
            const voiceLevel = calculateVoiceLevel(voiceXp);

            const xpForCurrentText = getXpForTextLevel(textLevel);
            const xpForNextText = getXpForTextLevel(textLevel + 1);
            const progressText = textXp - xpForCurrentText;
            const neededText = xpForNextText - xpForCurrentText;
            const percentText = neededText > 0 ? Math.floor((progressText / neededText) * 100) : 100;

            const xpForCurrentVoice = getXpForVoiceLevel(voiceLevel);
            const xpForNextVoice = getXpForVoiceLevel(voiceLevel + 1);
            const progressVoice = voiceXp - xpForCurrentVoice;
            const neededVoice = xpForNextVoice - xpForCurrentVoice;
            const percentVoice = neededVoice > 0 ? Math.floor((progressVoice / neededVoice) * 100) : 100;

            const canvas = createCanvas(934, 282);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // ... (canvas描画処理、テキストとボイス両方を描画)
            
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'rank-card.png' });
            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            console.error('Rank command error:', error);
            await interaction.editReply('ランク情報の取得中にエラーが発生しました。');
        }
    },
};
