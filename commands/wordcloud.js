const { SlashCommandBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const { createCanvas } = require('canvas');
const cloud = require('d3-cloud');
const TinySegmenter = require('tiny-segmenter');
const config = require('../config.js'); // config.jsを読み込む

// 【修正】ローカルの定数を削除し、configから読み込む
const { STOP_WORDS, PHRASES_TO_COMBINE, WORDCLOUD_EXCLUDED_CATEGORY_ID, WORDCLOUD_EXCLUDED_ROLE_ID } = config;

const segmenter = new TinySegmenter();

function extractWords(text, wordCounts) {
    const tokens = segmenter.segment(text);
    tokens.forEach(word => {
        if (word.length > 1 && !STOP_WORDS.has(word)) {
             if (!/^[0-9]+$/.test(word)) {
                 wordCounts[word] = (wordCounts[word] || 0) + 1;
             }
        }
    });
    return wordCounts;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordcloud')
        .setDescription('このチャンネルの最近のメッセージからワードクラウド画像を生成します。'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content: 'ワードクラウドを生成中です...（最大2分程度かかります）' });

        try {
            await interaction.guild.members.fetch();

            if (interaction.channel.parentId === WORDCLOUD_EXCLUDED_CATEGORY_ID || config.EXCLUDED_CHANNELS.includes(interaction.channel.id)) {
                return interaction.followUp({ content: 'このチャンネルではワードクラウドを生成できません。', ephemeral: true });
            }

            let allText = '';
            let lastId;
            
            for (let i = 0; i < 20; i++) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;
                const messages = await interaction.channel.messages.fetch(options);
                if (messages.size === 0) break;
                
                for (const msg of messages.values()) {
                    const member = interaction.guild.members.cache.get(msg.author.id);
                    const hasExcludedRole = member && member.roles.cache.has(WORDCLOUD_EXCLUDED_ROLE_ID);
                    if (!msg.author.bot && msg.content && msg.embeds.length === 0 && !hasExcludedRole) {
                        const cleanContent = msg.content
                            .replace(/<@!?&?(\d{17,19})>/g, '') 
                            .replace(/<#(\d{17,19})>/g, '')      
                            .replace(/<a?:[a-zA-Z0-9_]+:(\d{17,19})>/g, '')
                            .replace(/https?:\/\/\S+/g, '')      
                            .replace(/```[\s\S]*?```/g, '')      
                            .replace(/`[^`]+`/g, '')             
                            .replace(/[*_~|]/g, '')             
                            .replace(/[!"#$%&'()+,-.\/:;<=>?@[\]^{}~「」『』【】、。！？・’”…]+/g, ' ')
                            .replace(/\s+/g, ' ');              
                        allText += cleanContent + '\n';
                    }
                }
                lastId = messages.last().id;
            }

            if (allText.trim() === '') {
                return interaction.followUp({ content: '分析できるメッセージが見つかりませんでした。', ephemeral: true });
            }

            let wordCounts = {};

            PHRASES_TO_COMBINE.forEach(phrase => {
                const regex = new RegExp(phrase, 'g');
                const matches = allText.match(regex);
                if (matches) {
                    wordCounts[phrase] = matches.length;
                    allText = allText.replace(regex, '');
                }
            });

            wordCounts = extractWords(allText, wordCounts);
            
            const words = Object.entries(wordCounts)
                .map(([text, size]) => ({ text, size }))
                .sort((a, b) => b.size - a.size)
                .slice(0, 200);

            if (words.length === 0) {
                return interaction.followUp({ content: 'ワードクラウドを生成するのに十分な単語が見つかりませんでした。', ephemeral: true });
            }
            
            const maxFontSize = 100;
            const minFontSize = 10;
            const calculateFontSize = (word) => {
                const size = minFontSize + Math.log(word.size) * 12;
                return Math.min(size, maxFontSize);
            };

            const layout = cloud()
                .size([800, 600])
                .canvas(() => createCanvas(1, 1))
                .words(words)
                .padding(5)
                .rotate(() => 0)
                .font('Noto Sans CJK JP')
                .fontSize(calculateFontSize)
                .on('end', async (drawnWords) => {
                    const canvas = createCanvas(800, 600);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, 800, 600);
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    drawnWords.forEach(d => {
                        ctx.save();
                        ctx.translate(d.x + 400, d.y + 300);
                        ctx.rotate(d.rotate * Math.PI / 180);
                        ctx.fillStyle = `hsl(${Math.random() * 360}, 80%, 40%)`;
                        ctx.font = `bold ${d.size}px "Noto Sans CJK JP"`;
                        ctx.fillText(d.text, 0, 0);
                        ctx.restore();
                    });
                    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'wordcloud.png' });
                    await interaction.channel.send({ content: `${interaction.user}さん、お待たせしました！ワードクラウドが完成しました。`, files: [attachment] });
                    await interaction.deleteReply();
                });

            layout.start();

        } catch (error) {
            console.error('Wordcloud generation failed:', error);
            await interaction.followUp({ content: 'ワードクラウドの生成中にエラーが発生しました。', ephemeral: true });
        }
    },
};
