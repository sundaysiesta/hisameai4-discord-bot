const { ChannelType } = require('discord.js');
const config = require('../config');
// 画像処理は sharp に移行（libvips ベースで低メモリ）
let sharp;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

const levelUpLocks = new Set();

async function postStickyMessage(client, channel, stickyCustomId, createMessagePayload) {
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const lastMessage = messages.first();
        const lastComponents = Array.isArray(lastMessage?.components) ? lastMessage.components : [];
        const lastCustomId = lastComponents[0]?.components?.[0]?.customId;
        if (lastMessage?.author?.id === client.user.id && lastCustomId === stickyCustomId) {
            // 既存のスティッキーメッセージを上書き編集（ランキング等の内容更新を反映）
            await lastMessage.edit(createMessagePayload).catch(() => {});
            return;
        }
        const oldStickyMessages = messages.filter(msg => {
            const comps = Array.isArray(msg?.components) ? msg.components : [];
            const cid = comps[0]?.components?.[0]?.customId;
            return msg.author?.id === client.user.id && cid === stickyCustomId;
        });
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
    
    // 廃部候補カテゴリからも部活チャンネルを取得して部室棟に戻す
    const inactiveCategory = await guild.channels.fetch(config.INACTIVE_CLUB_CATEGORY_ID).catch(() => null);
    if (inactiveCategory && inactiveCategory.type === ChannelType.GuildCategory) {
        const inactiveChannels = inactiveCategory.children.cache.filter(ch => 
            !config.EXCLUDED_CHANNELS.includes(ch.id) && 
            ch.type === ChannelType.GuildText
        );
        allClubChannels.push(...inactiveChannels.values());
    }
    
    if (allClubChannels.length === 0) return;
    
    // アクティブ度（部員数 × メッセージ数）でランキングを作成
    let ranking = [];
    for (const channel of allClubChannels) {
        const messageCount = await redis.get(`weekly_message_count:${channel.id}`) || 0;
        
        // 部員数（アクティブユーザー数）の計算（今週の開始＝JSTの日曜0時以降のみ、最大500件遡り）
        const getStartOfWeekUtcMs = () => {
            const now = new Date();
            const jstNowMs = now.getTime() + 9 * 60 * 60 * 1000; // JST補正
            const jstNow = new Date(jstNowMs);
            const day = jstNow.getUTCDay();
            const diffDays = day; // 日曜0
            const jstStartMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - diffDays * 24 * 60 * 60 * 1000;
            return jstStartMs - 9 * 60 * 60 * 1000; // UTCに戻す
        };
        const sinceUtcMs = getStartOfWeekUtcMs();

        const messageCounts = new Map();
        let beforeId = undefined;
        let fetchedTotal = 0;
        const maxFetch = 500;
        while (fetchedTotal < maxFetch) {
            const batch = await channel.messages.fetch({ limit: Math.min(100, maxFetch - fetchedTotal), before: beforeId }).catch(() => null);
            if (!batch || batch.size === 0) break;
            for (const msg of batch.values()) {
                if (msg.createdTimestamp < sinceUtcMs) { batch.clear(); break; }
                if (!msg.author.bot) {
                    const count = messageCounts.get(msg.author.id) || 0;
                    messageCounts.set(msg.author.id, count + 1);
                }
            }
            fetchedTotal += batch.size;
            const last = batch.last();
            if (!last || last.createdTimestamp < sinceUtcMs) break;
            beforeId = last.id;
        }

        // 1回以上メッセージを送っているユーザーをカウント
        const activeMembers = Array.from(messageCounts.entries())
            .filter(([_, count]) => count >= 1)
            .map(([userId]) => userId);

        const activeMemberCount = activeMembers.length;
        const activityScore = activeMemberCount * Number(messageCount);
        
        ranking.push({ 
            id: channel.id, 
            count: activityScore, // アクティブ度を使用（下位互換のためプロパティ名は維持）
            messageCount: Number(messageCount),
            activeMemberCount: activeMemberCount,
            position: channel.position,
            categoryId: channel.parentId 
        });
    }
    
    // 全部活をアクティブ度でソート（同数の場合はチャンネル位置で安定化）
    ranking.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.position - b.position;
    });
    
    // カテゴリーを跨いでソート（1つ目のカテゴリーが50チャンネルで上限の場合、2つ目以降に移動）
    const maxChannelsPerCategory = 50;
    const topChannelOffset = 2;
    
    // 全部活を部室棟に配置
    for (let i = 0; i < ranking.length; i++) {
        const channelData = ranking[i];
        const channel = await guild.channels.fetch(channelData.id).catch(() => null);
        if (!channel) continue;
        
        // どのカテゴリーに配置するかを決定
        let targetCategoryId;
        let positionInCategory;
        
        if (i < maxChannelsPerCategory - topChannelOffset) {
            // 1つ目のカテゴリーに配置
            targetCategoryId = config.CLUB_CATEGORIES[0];
            positionInCategory = i + topChannelOffset;
        } else {
            // 2つ目以降のカテゴリーに配置
            const categoryIndex = Math.floor((i - (maxChannelsPerCategory - topChannelOffset)) / (maxChannelsPerCategory - topChannelOffset)) + 1;
            if (categoryIndex < config.CLUB_CATEGORIES.length) {
                targetCategoryId = config.CLUB_CATEGORIES[categoryIndex];
                positionInCategory = (i - (maxChannelsPerCategory - topChannelOffset)) % (maxChannelsPerCategory - topChannelOffset) + topChannelOffset;
            } else {
                // カテゴリーが足りない場合は最後のカテゴリーに配置
                targetCategoryId = config.CLUB_CATEGORIES[config.CLUB_CATEGORIES.length - 1];
                positionInCategory = i + topChannelOffset;
            }
        }
        
        // カテゴリーが変更された場合は移動
        if (channel.parentId !== targetCategoryId) {
            const targetCategory = await guild.channels.fetch(targetCategoryId).catch(() => null);
            if (targetCategory) {
                await channel.setParent(targetCategoryId).catch(e => 
                    console.error(`setParent Error for ${channel.name}: ${e.message}`)
                );
            }
        }
        
        // 位置を設定
        const newPosition = positionInCategory;
        if (channel.position !== newPosition) {
            await channel.setPosition(newPosition).catch(e => 
                console.error(`setPosition Error for ${channel.name}: ${e.message}`)
            );
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

function getFileExtension(name) {
    if (!name) return '';
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function isAllowedImageType(file, config) {
    const byMime = !!(file.contentType && config.ALLOWED_IMAGE_TYPES.includes(file.contentType));
    const ext = getFileExtension(file.name);
    const allowedExts = ['jpg','jpeg','png','gif','webp'];
    const byExt = allowedExts.includes(ext);
    return byMime || byExt;
}

async function getImageDimensions(url) {
    try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const sizeOf = require('image-size');
        const dim = sizeOf(buffer);
        return { width: dim.width || 0, height: dim.height || 0 };
    } catch { return { width: 0, height: 0 }; }
}

// 画像の長辺ピクセル制限
const MAX_IMAGE_EDGE_PX = 4096;

// 画像を最大辺に合わせてリサイズ。JPEGに再エンコード。
async function resizeImageFromUrl(url, targetMaxEdgePx, outputExt = 'jpeg') {
    if (!sharp) return null;
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    try {
        // メタデータからサイズを取得して inside リサイズ
        const transformer = sharp(buffer, { failOnError: false });
        const meta = await transformer.metadata();
        const width = meta.width || 0;
        const height = meta.height || 0;
        if (!width || !height) return null;
        const maxEdge = Math.max(width, height);
        if (maxEdge <= targetMaxEdgePx) return null; // リサイズ不要
        const format = outputExt === 'png' ? 'png' : 'jpeg';
        const outBuffer = await transformer
            .resize({ width: targetMaxEdgePx, height: targetMaxEdgePx, fit: 'inside', withoutEnlargement: true })
            [format]({ quality: 85 })
            .toBuffer();
        return { buffer: outBuffer, mime: format === 'png' ? 'image/png' : 'image/jpeg' };
    } finally {
        // 参照解放の明示
        buffer = null;
    }
}

// ファイルサイズとタイプの検証関数（動画は許可、画像に厳格適用）
function validateFile(file, config) {
    const errors = [];
    if (!file) {
        errors.push('ファイルが存在しません');
        return { isValid: false, errors };
    }

    // 共通: Discord上限および独自上限
    if (file.size > config.MAX_FILE_SIZE) {
        errors.push(`ファイルサイズが大きすぎます（最大${Math.round(config.MAX_FILE_SIZE / 1024 / 1024)}MB）`);
    }

    // 画像の場合
    if (file.contentType && file.contentType.startsWith('image/')) {
        if (file.size > config.MAX_IMAGE_SIZE) {
            // リサイズ前提なので即エラーにはしない（prepareで縮小を試みる）。ここでは警告だけ。
        }
        if (!isAllowedImageType(file, config)) {
            errors.push(`サポートされていない画像形式または拡張子です（${file.contentType || 'unknown'}/${getFileExtension(file.name)}）`);
        }
    }

    // 動画はタイプ許可とサイズ上限のみ（変換はしない）
    if (file.contentType && file.contentType.startsWith('video/')) {
        if (!config.ALLOWED_VIDEO_TYPES.includes(file.contentType)) {
            errors.push(`サポートされていない動画形式です（${file.contentType}）`);
        }
        if (file.size > config.MAX_VIDEO_SIZE) {
            errors.push(`動画ファイルが大きすぎます（最大${Math.round(config.MAX_VIDEO_SIZE / 1024 / 1024)}MB）`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// 送信用に添付を準備（必要なら画像を縮小）。
// 戻り値: そのままdiscord.jsのfilesに渡せるオブジェクト。
// 画像処理の並列実行を制限する簡易セマフォ
const IMAGE_CONCURRENCY = 2;
let imageActive = 0;
const imageQueue = [];
async function runWithImageSemaphore(task) {
    if (imageActive >= IMAGE_CONCURRENCY) {
        await new Promise(resolve => imageQueue.push(resolve));
    }
    imageActive++;
    try { return await task(); }
    finally {
        imageActive--;
        const next = imageQueue.shift();
        if (next) next();
    }
}

async function prepareFileForSend(file, config) {
    // まず基本検証
    const validation = validateFile(file, config);
    if (!validation.isValid) {
        return { success: false, error: validation.errors.join(', ') };
    }

    // 画像は長辺・サイズを確認して縮小を試みる
    if (file.contentType && file.contentType.startsWith('image/')) {
        return await runWithImageSemaphore(async () => {
            try {
                const { width, height } = await getImageDimensions(file.url);
                const maxEdge = Math.max(width, height);
                const needResizeByEdge = maxEdge > MAX_IMAGE_EDGE_PX;
                const needResizeBySize = file.size > config.MAX_IMAGE_SIZE;
                if (needResizeByEdge || needResizeBySize) {
                    const out = await resizeImageFromUrl(file.url, MAX_IMAGE_EDGE_PX, 'jpeg');
                    if (out && out.buffer) {
                        const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : 'image';
                        return {
                            success: true,
                            file: { attachment: out.buffer, name: `${baseName}.jpg` }
                        };
                    }
                }
            } catch (e) {
                console.warn('画像リサイズに失敗したため原本を使用します:', e?.message || e);
            }
            return { success: true, file };
        });
    }

    // リサイズ不要、または動画・その他はそのまま返す
    return { success: true, file };
}

// ファイルの安全な処理関数（後方互換: 以前のインターフェースを維持）
async function processFileSafely(file, config) {
    try {
        const prepared = await prepareFileForSend(file, config);
        if (!prepared.success) {
            return { success: false, error: prepared.error };
        }
        return { success: true, file: prepared.file };
    } catch (error) {
        console.error('ファイル処理中にエラーが発生しました:', error);
        return { success: false, error: 'ファイルの処理中にエラーが発生しました' };
    }
}

// 【最重要修正】toHalfWidthをエクスポートリストに追加
module.exports = { postStickyMessage, sortClubChannels, getGenerationRoleName, safeIncrby, toKanjiNumber, toHalfWidth, getAllKeys, validateFile, processFileSafely, prepareFileForSend };
