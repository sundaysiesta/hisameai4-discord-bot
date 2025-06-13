const { SlashCommandBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const { createCanvas } = require('canvas');
const cloud = require('d3-cloud');
const kuromoji = require('kuromoji');
const config = require('../config.js');

const EXCLUDED_ROLE_ID = '1371467046055055432';
const PHRASES_TO_COMBINE = ['確認してください', 'よろしくお願いします'];
const STOP_WORDS = new Set(['する', 'いる', 'なる', 'れる', 'ある', 'ない', 'です', 'ます', 'こと', 'もの', 'それ', 'あれ', 'これ', 'よう', 'ため', 'さん', 'せる', 'れる', 'から', 'ので', 'まで', 'など', 'w', '笑']);

function extractWords(tokenizer, text, wordCounts) {
    const tokens = tokenizer.tokenize(text);
    tokens.forEach(token => {
        if (token.pos === '名詞' && token.surface_form.length > 1 && !STOP_WORDS.has(token.surface_form)) {
            if (!/^[0-9!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~「」『』【】、。！？・’”…]+$/.test(token.surface_form)) {
                 const word = token.surface_form;
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
        // 【修正】応答をephemeralにする
        await interaction.deferReply({ ephemeral: true });

        // 【修正】除外カテゴリのチェック
        if (interaction.channel.parentId === config.WORDCLOUD_EXCLUDED_CATEGORY_ID) {
            return interaction.editReply({ content: 'このカテゴリのチャンネルではワードクラウドを生成できません。' });
        }
        
        // 処理中であることをユーザーに伝える
        await interaction.editReply({ content: 'ワードクラウドを生成中です...（最大1分程度かかります）' });

        try {
            await interaction.guild.members.fetch();

            const tokenizer = await new Promise((resolve, reject) => {
                kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, tokenizer) => {
                    if (err) return reject(err);
                    resolve(tokenizer);
                });
            });

            let allText = '';
            let fetchedMessages = 0;
            let lastId;
            
            // 【修正】実行されたチャンネルから最大1000件のメッセージを取得する
            while(fetchedMessages < 1000) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }
                const messages = await interaction.channel.messages.fetch(options);
                if (messages.size === 0) {
                    break;
                }
                
                for (const msg of messages.values()) {
                    const member = interaction.guild.members.cache.get(msg.author.id);
                    const hasExcludedRole = member && member.roles.cache.has(EXCLUDED_ROLE_ID);

                    if (!msg.author.bot && msg.content && !hasExcludedRole) {
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
                fetchedMessages += messages.size;
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

            wordCounts = extractWords(tokenizer, allText, wordCounts);
            
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
                    // 【修正】チャンネルに直接送信
                    await interaction.channel.send({ content: `${interaction.user}さん、お待たせしました！ワードクラウドが完成しました。`, files: [attachment] });
                    // 最初の応答を削除
                    await interaction.deleteReply();
                });

            layout.start();

        } catch (error) {
            console.error('Wordcloud generation failed:', error);
            await interaction.followUp({ content: 'ワードクラウドの生成中にエラーが発生しました。', ephemeral: true });
        }
    },
};

