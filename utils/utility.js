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
    let allClubChannels = [];
    
    // 両方のカテゴリーから部活チャンネルを取得
    for (const categoryId of config.CLUB_CATEGORIES) {
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (category && category.type === ChannelType.GuildCategory) {
            const clubChannels = category.children.cache.filter(ch => 
                !config.EXCLUDED_CHANNELS.includes(ch.id) && 
                ch.type === ChannelType.GuildText
            );
            allClubChannels.push(...clubChannels.values());
        }
    }
    
    if (allClubChannels.length === 0) return;
    
    // メッセージ数でランキングを作成
    let ranking = [];
    for (const channel of allClubChannels) {
        const count = await redis.get(`weekly_message_count:${channel.id}`) || 0;
        ranking.push({ 
            id: channel.id, 
            count: Number(count), 
            position: channel.position,
            categoryId: channel.parentId 
        });
    }
    
    // メッセージ数でソート（同じ場合は位置でソート）
    ranking.sort((a, b) => (b.count !== a.count) ? b.count - a.count : a.position - b.position);
    
    // 各カテゴリー内でソート
    for (const categoryId of config.CLUB_CATEGORIES) {
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (!category) continue;
        
        const categoryChannels = ranking.filter(r => r.categoryId === categoryId);
        const topChannelOffset = 2;
        
        for (let i = 0; i < categoryChannels.length; i++) {
            const channel = await guild.channels.fetch(categoryChannels[i].id).catch(() => null);
            const newPosition = i + topChannelOffset;
            if (channel && channel.position !== newPosition) {
                await channel.setPosition(newPosition).catch(e => 
                    console.error(`setPosition Error for ${channel.name}: ${e.message}`)
                );
            }
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

// redis.keysの代替
async function getAllKeys(redis, pattern) {
    let cursor = '0';
    const keys = [];
    do {
        const reply = await redis.scan(Number(cursor), { match: pattern, count: 1000 });
        cursor = String(reply[0]);
        keys.push(...reply[1]);
    } while (cursor !== '0');
    return keys;
}

// ファイルサイズとタイプの検証関数
function validateFile(file, config) {
    const errors = [];
    
    // ファイルサイズチェック
    if (file.size > config.MAX_FILE_SIZE) {
        errors.push(`ファイルサイズが大きすぎます（最大${Math.round(config.MAX_FILE_SIZE / 1024 / 1024)}MB）`);
    }
    
    // 画像ファイルの場合
    if (file.contentType && file.contentType.startsWith('image/')) {
        if (file.size > config.MAX_IMAGE_SIZE) {
            errors.push(`画像ファイルが大きすぎます（最大${Math.round(config.MAX_IMAGE_SIZE / 1024 / 1024)}MB）`);
        }
        if (!config.ALLOWED_IMAGE_TYPES.includes(file.contentType)) {
            errors.push(`サポートされていない画像形式です（${file.contentType}）`);
        }
    }
    
    // 動画ファイルの場合
    if (file.contentType && file.contentType.startsWith('video/')) {
        if (file.size > config.MAX_VIDEO_SIZE) {
            errors.push(`動画ファイルが大きすぎます（最大${Math.round(config.MAX_VIDEO_SIZE / 1024 / 1024)}MB）`);
        }
        if (!config.ALLOWED_VIDEO_TYPES.includes(file.contentType)) {
            errors.push(`サポートされていない動画形式です（${file.contentType}）`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// ファイルの安全な処理関数
async function processFileSafely(file, config) {
    try {
        // ファイルサイズとタイプの検証
        const validation = validateFile(file, config);
        if (!validation.isValid) {
            return {
                success: false,
                error: validation.errors.join(', ')
            };
        }
        
        // ファイルサイズが大きすぎる場合は警告
        if (file.size > 5 * 1024 * 1024) { // 5MB以上
            console.warn(`大きなファイルが処理されています: ${file.name} (${Math.round(file.size / 1024 / 1024)}MB)`);
        }
        
        return {
            success: true,
            file: file
        };
    } catch (error) {
        console.error('ファイル処理中にエラーが発生しました:', error);
        return {
            success: false,
            error: 'ファイルの処理中にエラーが発生しました'
        };
    }
}

// 【最重要修正】toHalfWidthをエクスポートリストに追加
module.exports = { postStickyMessage, sortClubChannels, getGenerationRoleName, safeIncrby, toKanjiNumber, toHalfWidth, getAllKeys, validateFile, processFileSafely };
