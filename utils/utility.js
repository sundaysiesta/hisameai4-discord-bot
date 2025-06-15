const { ChannelType } = require('discord.js');
const config = require('../config');

const levelUpLocks = new Set();

async function postStickyMessage(client, channel, stickyCustomId, createMessagePayload) {
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const lastMessage = messages.first();
        if (lastMessage?.author.id === client.user.id && lastMessage.components[0]?.components[0]?.customId === stickyCustomId) {
            return;
        }
        const oldStickyMessages = messages.filter(msg =>
            msg.author.id === client.user.id &&
            msg.components[0]?.components[0]?.customId === stickyCustomId
        );
        for (const msg of oldStickyMessages.values()) {
            await msg.delete().catch(() => {});
        }
        await channel.send(createMessagePayload);
    } catch (error) {
        console.error(`Sticky message update failed for channel ${channel.id}:`, error);
    }
}
async function sortClubChannels(redis, guild) {
    const category = await guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return;
    const clubChannels = category.children.cache.filter(ch => !config.EXCLUDED_CHANNELS.includes(ch.id) && ch.type === ChannelType.GuildText);
    let ranking = [];
    for (const channel of clubChannels.values()) {
        const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
        ranking.push({ id: channel.id, count: Number(count), position: channel.position });
    }
    ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
    const topChannelOffset = 2; 
    for (let i = 0; i < ranking.length; i++) {
        const channel = await guild.channels.fetch(ranking[i].id).catch(() => null);
        const newPosition = i + topChannelOffset;
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
const generateTextXpTable = (maxLevel) => {
    const table = [0];
    let xpForNextLevel = 35; 
    let increaseAmount = 68;
    let totalXp = 0;
    for (let level = 1; level <= maxLevel; level++) {
        totalXp += xpForNextLevel;
        table[level] = totalXp;
        xpForNextLevel += increaseAmount;
        increaseAmount = (increaseAmount === 69) ? 70 : 69;
    }
    return table;
};
const textXpTable = generateTextXpTable(100);
function calculateTextLevel(xp) {
    if (xp <= 0) return 0;
    for (let i = textXpTable.length - 1; i >= 0; i--) {
        if (xp >= textXpTable[i]) {
            return i;
        }
    }
    return 0;
}
function getXpForTextLevel(level) {
    if (level < 0) return 0;
    if (level >= textXpTable.length) {
        const lastLevelXp = textXpTable[textXpTable.length - 1];
        const lastLevelDelta = textXpTable[textXpTable.length - 1] - textXpTable[textXpTable.length - 2];
        return lastLevelXp + (lastLevelDelta * (level - (textXpTable.length - 1)));
    }
    return textXpTable[level];
}
function calculateVoiceLevel(xp) {
    if (xp <= 0) return 0;
    let level = 0;
    let cumulativeXp = 0;
    while (true) {
        const requiredForNext = (level === 0) ? 69 : Math.floor(138 * level + 69);
        if (xp < cumulativeXp + requiredForNext) {
            return level;
        }
        cumulativeXp += requiredForNext;
        level++;
         if (level > 200) return 200;
    }
}
function getXpForVoiceLevel(level) {
    let totalXp = 0;
    for (let i = 0; i < level; i++) {
        totalXp += Math.floor(138 * i + 69);
    }
    return totalXp;
}
function getRankInfo(level) {
    if (level <= 0) return { title: null, level: 0 };
    if (level >= 100) return { title: 'LEGEND', level: 100 };
    if (level >= 95) return { title: 'ULTIMATE MASTER II', level: 95 };
    if (level >= 90) return { title: 'ULTIMATE MASTER I', level: 90 };
    if (level >= 85) return { title: 'GRAND MASTER II', level: 85 };
    if (level >= 80) return { title: 'GRAND MASTER I', level: 80 };
    if (level >= 75) return { title: 'HIGH MASTER II', level: 75 };
    if (level >= 70) return { title: 'HIGH MASTER I', level: 70 };
    if (level >= 65) return { title: 'MASTER II', level: 65 };
    if (level >= 60) return { title: 'MASTER I', level: 60 };
    if (level >= 55) return { title: 'DIAMOND II', level: 55 };
    if (level >= 50) return { title: 'DIAMOND I', level: 50 };
    if (level >= 45) return { title: 'PLATINUM II', level: 45 };
    if (level >= 40) return { title: 'PLATINUM I', level: 40 };
    if (level >= 35) return { title: 'GOLD II', level: 35 };
    if (level >= 30) return { title: 'GOLD I', level: 30 };
    if (level >= 25) return { title: 'SILVER II', level: 25 };
    if (level >= 20) return { title: 'SILVER I', level: 20 };
    if (level >= 15) return { title: 'BRONZE II', level: 15 };
    if (level >= 10) return { title: 'BRONZE I', level: 10 };
    if (level >= 5) return { title: 'IRON', level: level };
    if (level >= 1) return { title: 'ROOKIE', level: level };
    return { title: null, level: 0 };
}
async function updateLevelRoles(member, redis, client) {
    if (!member || !redis || !client) return;
    const mainAccountId = await redis.hget(`user:${member.id}`, 'mainAccountId') || member.id;
    if (levelUpLocks.has(mainAccountId)) return;
    levelUpLocks.add(mainAccountId);
    try {
        const mainMember = await member.guild.members.fetch(mainAccountId).catch(() => null);
        if (!mainMember) return;
        const textXp = await redis.hget(`user:${mainAccountId}`, 'textXp') || 0;
        const voiceXp = await redis.hget(`user:${mainAccountId}`, 'voiceXp') || 0;
        const textLevel = calculateTextLevel(textXp);
        const voiceLevel = calculateVoiceLevel(voiceXp);
        const newLevel = Math.max(textLevel, voiceLevel);
        const rankInfo = getRankInfo(newLevel);
        if (!rankInfo.title) {
            const currentLevelRoles = mainMember.roles.cache.filter(role => role.name.includes('Lv.'));
            if (currentLevelRoles.size > 0) await mainMember.roles.remove(currentLevelRoles);
            return;
        }
        const targetRoleName = `${rankInfo.title} Lv.${rankInfo.level}`;
        const targetRole = mainMember.guild.roles.cache.find(r => r.name === targetRoleName);
        const allTitleRanks = ['ROOKIE', 'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'HIGH', 'GRAND', 'ULTIMATE', 'LEGEND'];
        const currentLevelRoles = mainMember.roles.cache.filter(role => allTitleRanks.some(title => role.name.startsWith(title)) && role.name.includes('Lv.'));
        const rolesToRemove = currentLevelRoles.filter(r => r.id !== targetRole?.id);
        const shouldAddRole = targetRole && !mainMember.roles.cache.has(targetRole.id);
        if (rolesToRemove.size > 0) await mainMember.roles.remove(rolesToRemove);
        if (shouldAddRole) await mainMember.roles.add(targetRole);
    } catch (error) {
        console.error(`Failed to update level roles for ${member.id}:`, error);
    } finally {
        levelUpLocks.delete(mainAccountId);
    }
}
async function safeIncrby(redis, key, value) {
    try { return await redis.incrby(key, value); }
    catch (e) {
        if (e.message.includes("WRONGTYPE")) {
            console.log(`Fixing corrupted key ${key}. Deleting and recreating.`);
            await redis.del(key);
            return await redis.incrby(key, value);
        } else { throw e; }
    }
}
function toKanjiNumber(num) {
    const kanjiDigits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const kanjiUnits = ['', '十', '百', '千'];
    if (num === 0) return kanjiDigits[0];
    let result = '';
    const sNum = String(num);
    for (let i = 0; i < sNum.length; i++) {
        const digit = parseInt(sNum[i]);
        const unit = kanjiUnits[sNum.length - 1 - i];
        if (digit > 0) {
            if (digit === 1 && unit && (sNum.length - 1 - i) > 0) {
                result += unit;
            } else {
                result += kanjiDigits[digit] + (unit || '');
            }
        }
    }
    return result;
}

// 【最重要修正】toHalfWidthをエクスポートリストに追加
module.exports = { postStickyMessage, sortClubChannels, getGenerationRoleName, calculateTextLevel, getXpForTextLevel, calculateVoiceLevel, getXpForVoiceLevel, updateLevelRoles, safeIncrby, toKanjiNumber, toHalfWidth };
