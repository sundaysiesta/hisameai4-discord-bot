const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const config = require('../config.js');
const { postStickyMessage, sortClubChannels } = require('../utils/utility.js');
const TinySegmenter = require('tiny-segmenter');

// ワードクラウドと同じ除外リストを使用
const EXCLUDED_ROLE_ID = '1371467046055055432';
const STOP_WORDS = new Set(['する', 'いる', 'なる', 'れる', 'ある', 'ない', 'です', 'ます', 'こと', 'もの', 'それ', 'あれ', 'これ', 'よう', 'ため', 'さん', 'せる', 'れる', 'から', 'ので', 'まで', 'など', 'w', '笑']);
const segmenter = new TinySegmenter();

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client, redis, notion) {
        console.log(`Logged in as ${client.user.tag}!`);
        // ... (既存の起動時処理は変更なし) ...
        
        // 【追加】トレンドランキング更新のスケジューラー
        cron.schedule(config.TREND_UPDATE_INTERVAL, async () => {
            try {
                const trendChannel = await client.channels.fetch(config.TREND_CHANNEL_ID).catch(() => null);
                if (!trendChannel) return;

                const now = Date.now();
                const cutoff = now - config.TREND_WORD_LIFESPAN;

                // Redisから単語リストを取得
                const wordEntries = await redis.lrange('trend_words', 0, -1);
                
                const validWords = [];
                const wordsToKeep = [];
                const wordCounts = {};

                // 古いデータをフィルタリング
                wordEntries.forEach(entry => {
                    const [word, timestamp] = entry.split(':');
                    if (Number(timestamp) >= cutoff) {
                        validWords.push(word);
                        wordsToKeep.push(entry);
                    }
                });
                
                // 新しいリストでRedisを上書き（古いデータを削除）
                if (wordsToKeep.length < wordEntries.length) {
                    await redis.del('trend_words');
                    if (wordsToKeep.length > 0) {
                        await redis.lpush('trend_words', ...wordsToKeep);
                    }
                }

                // 単語をカウント
                validWords.forEach(word => {
                    wordCounts[word] = (wordCounts[word] || 0) + 1;
                });
                
                const ranking = Object.entries(wordCounts)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 20);

                // Embedを作成
                const embed = new EmbedBuilder()
                    .setTitle('サーバー内トレンド (過去24時間)')
                    .setColor(0x1DA1F2)
                    .setTimestamp();
                
                if (ranking.length === 0) {
                    embed.setDescription('現在、トレンドはありません。');
                } else {
                    const description = ranking.map((item, index) => {
                        return `**${index + 1}位:** ${item[0]} (${item[1]}回)`;
                    }).join('\n');
                    embed.setDescription(description);
                }

                // メッセージを更新または新規投稿
                const trendMessageId = await redis.get('trend_message_id');
                if (trendMessageId) {
                    try {
                        const message = await trendChannel.messages.fetch(trendMessageId);
                        await message.edit({ embeds: [embed] });
                    } catch (error) {
                        // メッセージが見つからない場合(手動削除など)、新規投稿
                        const newMessage = await trendChannel.send({ embeds: [embed] });
                        await redis.set('trend_message_id', newMessage.id);
                    }
                } else {
                    const newMessage = await trendChannel.send({ embeds: [embed] });
                    await redis.set('trend_message_id', newMessage.id);
                }

            } catch (error) {
                console.error('トレンドランキングの更新中にエラー:', error);
            }
        });
	},
};
