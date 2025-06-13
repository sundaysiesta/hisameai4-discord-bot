const { ChannelType } = require('discord.js');
const config = require('../config');

async function postStickyMessage(client, channel, stickyCustomId, createMessagePayload) {
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const oldStickyMessages = messages.filter(msg =>
            msg.author.id === client.user.id &&
            msg.components[0]?.components[0]?.customId === stickyCustomId
        );
        for (const msg of oldStickyMessages.values()) {
            await msg.delete().catch(() => {});
        }
        await channel.send(createMessagePayload);
    } catch (error) {
        console.error(`Sticky message post failed for channel ${channel.id}:`, error);
    }
}

// 【ここを修正】
async function sortClubChannels(redis, guild) {
    const category = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return;

    // ソート対象の部活チャンネルを取得
    const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
    
    let ranking = [];
    for (const channel of clubChannels.values()) {
        const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
        ranking.push({ id: channel.id, count: Number(count), position: channel.position });
    }

    // メッセージ数と現在の位置でソート
    ranking.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.position - b.position;
    });

    // 常に上位に表示したい非部活チャンネルの数をオフセットとして設定
    const topChannelOffset = 2; 

    // 新しい位置を設定
    for (let i = 0; i < ranking.length; i++) {
        const channel = await guild.channels.fetch(ranking[i].id).catch(() => null);
        const newPosition = i + topChannelOffset; // オフセットを加算
        if (channel && channel.position !== newPosition) {
            await channel.setPosition(newPosition).catch(e => console.error(`setPosition Error: ${e.message}`));
        }
    }
}

const toHalfWidth = (str) => {
    if (!str) return '';
    return str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
};

function getGenerationRoleName(generationText) {
    if (!generationText || typeof generationText !== 'string') return null;
    const halfWidthText = toHalfWidth(generationText);
    const match = halfWidthText.match(/第(\d+)世代/);
    if (!match || !match[1]) return null;
    let num = parseInt(match[1], 10);
    const lookup = {M:1000,CM:900,D:500,CD:400,C:100,XC:90,L:50,XL:40,X:10,IX:9,V:5,IV:4,I:1};
    let roman = '';
    for (const i in lookup) {
        while ( num >= lookup[i] ) {
            roman += i;
            num -= lookup[i];
        }
    }
    return roman;
}

module.exports = { postStickyMessage, sortClubChannels, getGenerationRoleName };
