const { ChannelType } = require('discord.js');
const config = require('../config');

// ロック用のSetを作成
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
    const table = [0]; // Level 0
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
         if (level > 200) return 200; // 安全停止
    }
}

function getXpForVoiceLevel(level) {
    let totalXp = 0;
    for (let i = 0; i < level; i++) {
        totalXp += Math.floor(138 * i + 69);
    }
    return totalXp;
}

// 【最重要修正】レベルロールの更新ロジックを全面的に改善
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

        const levelRoleRegex = /^Lv\.(\d+)$/;
        const currentLevelRoles = mainMember.roles.cache.filter(role => levelRoleRegex.test(role.name));
        const targetRole = mainMember.guild.roles.cache.find(role => role.name === `Lv.${newLevel}`);
        
        const rolesToRemove = currentLevelRoles.filter(r => r.id !== targetRole?.id);
        const shouldAddRole = targetRole && !mainMember.roles.cache.has(targetRole.id);

        if (rolesToRemove.size > 0) {
            await mainMember.roles.remove(rolesToRemove);
        }
        if (shouldAddRole) {
            await mainMember.roles.add(targetRole);
        }

        // 【修正】レベルアップ通知ロジックを完全に削除

    } catch (error) {
        console.error(`Failed to update level roles for ${member.id}:`, error);
    } finally {
        levelUpLocks.delete(mainAccountId);
    }
}

async function safeIncrby(redis, key, value) {
    try {
        return await redis.incrby(key, value);
    } catch (e) {
        if (e.message.includes("WRONGTYPE")) {
            console.log(`Fixing corrupted key ${key}. Deleting and recreating.`);
            await redis.del(key);
            return await redis.incrby(key, value);
        } else {
            throw e;
        }
    }
}

module.exports = { postStickyMessage, sortClubChannels, getGenerationRoleName, calculateTextLevel, getXpForTextLevel, calculateVoiceLevel, getXpForVoiceLevel, updateLevelRoles, safeIncrby };
