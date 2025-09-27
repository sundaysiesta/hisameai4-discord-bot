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
    
    // 全部活カテゴリーから部活チャンネルを取得（人気部活カテゴリも含む）
    const allCategories = [...config.CLUB_CATEGORIES, config.POPULAR_CLUB_CATEGORY_ID];
    for (const categoryId of allCategories) {
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
        let weeklyMessageCount = 0; // リアルタイムでメッセージ数をカウント
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
                    weeklyMessageCount++; // メッセージ数をカウント
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
        const activityScore = activeMemberCount * weeklyMessageCount;
        
        ranking.push({ 
            id: channel.id, 
            count: activityScore, // アクティブ度を使用（下位互換のためプロパティ名は維持）
            messageCount: weeklyMessageCount,
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
    
    // 全部活を適切なカテゴリーに配置
    for (let i = 0; i < ranking.length; i++) {
        const channelData = ranking[i];
        const channel = await guild.channels.fetch(channelData.id).catch(() => null);
        if (!channel) continue;
        
        // どのカテゴリーに配置するかを決定
        let targetCategoryId;
        let positionInCategory;
        
        if (i < 5) {
            // 上位5つは人気部活カテゴリに配置
            targetCategoryId = config.POPULAR_CLUB_CATEGORY_ID;
            positionInCategory = i;
        } else {
            // 6位以降は部室棟に配置
            const adjustedIndex = i - 5; // 人気部活カテゴリ分を差し引く
            if (adjustedIndex < maxChannelsPerCategory - topChannelOffset) {
                // 1つ目のカテゴリーに配置
                targetCategoryId = config.CLUB_CATEGORIES[0];
                positionInCategory = adjustedIndex + topChannelOffset;
            } else {
                // 2つ目以降のカテゴリーに配置
                const categoryIndex = Math.floor((adjustedIndex - (maxChannelsPerCategory - topChannelOffset)) / (maxChannelsPerCategory - topChannelOffset)) + 1;
                if (categoryIndex < config.CLUB_CATEGORIES.length) {
                    targetCategoryId = config.CLUB_CATEGORIES[categoryIndex];
                    positionInCategory = (adjustedIndex - (maxChannelsPerCategory - topChannelOffset)) % (maxChannelsPerCategory - topChannelOffset) + topChannelOffset;
                } else {
                    // カテゴリーが足りない場合は最後のカテゴリーに配置
                    targetCategoryId = config.CLUB_CATEGORIES[config.CLUB_CATEGORIES.length - 1];
                    positionInCategory = adjustedIndex + topChannelOffset;
                }
            }
        }
        
        // カテゴリーが変更された場合は移動
        if (channel.parentId !== targetCategoryId) {
            const targetCategory = await guild.channels.fetch(targetCategoryId).catch(() => null);
            if (targetCategory) {
                // 現在の権限設定を保存
                const currentOverwrites = channel.permissionOverwrites.cache.clone();
                
                await channel.setParent(targetCategoryId).catch(e => 
                    console.error(`setParent Error for ${channel.name}: ${e.message}`)
                );
                
                // 権限設定を復元
                try {
                    for (const [id, overwrite] of currentOverwrites) {
                        await channel.permissionOverwrites.edit(id, {
                            allow: overwrite.allow,
                            deny: overwrite.deny
                        }).catch(e => 
                            console.error(`Permission restore error for ${channel.name} (${id}): ${e.message}`)
                        );
                    }
                } catch (e) {
                    console.error(`Permission restore failed for ${channel.name}: ${e.message}`);
                }
            }
        }
        
        // 位置を設定
        const newPosition = positionInCategory;
        if (channel.position !== newPosition) {
            await channel.setPosition(newPosition).catch(e => 
                console.error(`setPosition Error for ${channel.name}: ${e.message}`)
            );
        }
        
        // チャンネル名に活発度を追加
        const currentName = channel.name;
        const scorePattern = /[🔥⚡🌱・]\d+$/; // 既存のスコアを検出（全アイコン対応）
        const baseName = currentName.replace(scorePattern, ''); // スコア部分を除去
        const activityIcon = getActivityIcon(channelData.count);
        const newName = `${baseName}${activityIcon}${channelData.count}`;
        
        if (currentName !== newName) {
            await channel.setName(newName).catch(e => 
                console.error(`setName Error for ${channel.name}: ${e.message}`)
            );
        }
    }
}
const toHalfWidth = (str) => {
    if (!str) return '';
    return str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
};

// 活発度に応じたアイコンを返す関数
function getActivityIcon(score) {
    if (score >= 10000) return '🔥';
    if (score >= 1000) return '⚡';
    if (score >= 100) return '🌱';
    return '・';
}
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

// コテハンと固定アイコンのデータ管理
const kotehanData = new Map(); // userId -> { name: string, tag: string }
const koteiconData = new Map(); // userId -> { url: string, attachment: object }

// コテハン用のランダムタグ生成（4桁の数字）
function generateKotehanTag() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// コテハン設定
function setKotehan(userId, name) {
    const tag = generateKotehanTag();
    kotehanData.set(userId, { name: name.trim(), tag });
    return tag;
}

// コテハン取得
function getKotehan(userId) {
    return kotehanData.get(userId);
}

// コテハン削除
function removeKotehan(userId) {
    return kotehanData.delete(userId);
}

// 固定アイコン設定
function setKoteicon(userId, iconData) {
    koteiconData.set(userId, iconData);
}

// 固定アイコン取得
function getKoteicon(userId) {
    return koteiconData.get(userId);
}

// 固定アイコン削除
function removeKoteicon(userId) {
    return koteiconData.delete(userId);
}

// Notionからアイコンを取得して固定アイコンとして設定
async function setKoteiconFromNotion(userId, notion, config) {
    try {
        // Notionデータベースからユーザーのページを取得
        const response = await notion.databases.query({
            database_id: config.NOTION_DATABASE_ID,
            filter: {
                property: 'DiscordユーザーID',
                rich_text: {
                    equals: userId
                }
            }
        });

        if (response.results.length === 0) {
            return { success: false, error: 'Notionデータベースにユーザーが見つかりません' };
        }

        const page = response.results[0];
        
        // ページのアイコンを取得
        if (!page.icon || page.icon.type !== 'external') {
            return { success: false, error: 'Notionページにアイコンが設定されていません' };
        }

        const iconUrl = page.icon.external.url;
        
        // アイコンをダウンロードして処理
        const iconResponse = await fetch(iconUrl);
        if (!iconResponse.ok) {
            return { success: false, error: 'アイコンのダウンロードに失敗しました' };
        }

        const arrayBuffer = await iconResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // ファイル処理
        const processedIcon = await processFileSafely({
            url: iconUrl,
            attachment: buffer,
            name: 'notion-icon.png',
            contentType: 'image/png',
            size: buffer.length
        }, config);

        if (!processedIcon.success) {
            return { success: false, error: `アイコンの処理に失敗しました: ${processedIcon.error}` };
        }

        // 固定アイコンとして設定
        setKoteicon(userId, {
            url: iconUrl,
            attachment: processedIcon.file
        });

        return { success: true, iconUrl: iconUrl };
    } catch (error) {
        console.error('Notionアイコン取得エラー:', error);
        return { success: false, error: `エラーが発生しました: ${error.message}` };
    }
}

// 全ユーザーのNotionアイコンを一括設定
async function setAllNotionIcons(notion, config) {
    const results = [];
    
    try {
        // 全ページを取得
        const response = await notion.databases.query({
            database_id: config.NOTION_DATABASE_ID,
            page_size: 100
        });

        for (const page of response.results) {
            const discordId = getNotionPropertyText(page.properties['DiscordユーザーID']);
            if (discordId === 'N/A' || !discordId) continue;

            const result = await setKoteiconFromNotion(discordId, notion, config);
            results.push({
                userId: discordId,
                pageTitle: getNotionPropertyText(page.properties['名前']),
                success: result.success,
                error: result.error
            });
        }

        return results;
    } catch (error) {
        console.error('一括アイコン設定エラー:', error);
        return { success: false, error: `エラーが発生しました: ${error.message}` };
    }
}

// DiscordアイコンをNotionに一括設定
async function setDiscordIconsToNotion(client, notion, config) {
    const results = [];
    
    try {
        // 全ページを取得
        const response = await notion.databases.query({
            database_id: config.NOTION_DATABASE_ID,
            page_size: 100
        });

        for (const page of response.results) {
            const discordId = getNotionPropertyText(page.properties['DiscordユーザーID']);
            const pageTitle = getNotionPropertyText(page.properties['名前']);
            
            if (discordId === 'N/A' || !discordId) {
                results.push({
                    userId: discordId,
                    pageTitle: pageTitle,
                    success: false,
                    error: 'DiscordユーザーIDが設定されていません'
                });
                continue;
            }

            try {
                // アイコンURLプロパティが存在するかチェック
                if (!page.properties['アイコンURL']) {
                    console.warn(`[NotionIcon] 警告: ${pageTitle} - アイコンURLプロパティが存在しません`);
                }

                // Discordユーザーを取得
                const discordUser = await client.users.fetch(discordId);
                
                // DiscordアイコンURLを取得（アニメーションアバター対応）
                const avatarUrl = discordUser.displayAvatarURL({ dynamic: true, size: 256 });
                
                // NotionページのアイコンとアイコンURLプロパティを更新
                try {
                    await notion.pages.update({
                        page_id: page.id,
                        icon: {
                            type: 'external',
                            external: {
                                url: avatarUrl
                            }
                        },
                        properties: {
                            'アイコンURL': {
                                url: avatarUrl
                            }
                        }
                    });
                    console.log(`[NotionIcon] 成功: ${pageTitle} - アイコンとURLを更新`);
                } catch (updateError) {
                    console.error(`[NotionIcon] 更新エラー: ${pageTitle}`, updateError);
                    // アイコンのみ更新を試行
                    try {
                        await notion.pages.update({
                            page_id: page.id,
                            icon: {
                                type: 'external',
                                external: {
                                    url: avatarUrl
                                }
                            }
                        });
                        console.log(`[NotionIcon] 部分成功: ${pageTitle} - アイコンのみ更新`);
                    } catch (iconError) {
                        console.error(`[NotionIcon] アイコン更新も失敗: ${pageTitle}`, iconError);
                        throw iconError;
                    }
                }

                results.push({
                    userId: discordId,
                    pageTitle: pageTitle,
                    discordUsername: discordUser.username,
                    success: true,
                    avatarUrl: avatarUrl
                });

            } catch (discordError) {
                console.error(`Discordユーザー取得エラー (${discordId}):`, discordError);
                results.push({
                    userId: discordId,
                    pageTitle: pageTitle,
                    success: false,
                    error: `Discordユーザーが見つかりません: ${discordError.message}`
                });
            }
        }

        return results;
    } catch (error) {
        console.error('Discordアイコン一括設定エラー:', error);
        return { success: false, error: `エラーが発生しました: ${error.message}` };
    }
}

// 指定ユーザーのDiscordアイコンをNotionに設定
async function setDiscordIconToNotion(client, notion, config, discordId) {
    try {
        // Notionデータベースからユーザーのページを取得
        const response = await notion.databases.query({
            database_id: config.NOTION_DATABASE_ID,
            filter: {
                property: 'DiscordユーザーID',
                rich_text: {
                    equals: discordId
                }
            }
        });

        if (response.results.length === 0) {
            return { success: false, error: 'Notionデータベースにユーザーが見つかりません' };
        }

        const page = response.results[0];
        const pageTitle = getNotionPropertyText(page.properties['名前']);

        // アイコンURLプロパティが存在するかチェック
        if (!page.properties['アイコンURL']) {
            console.warn(`[NotionIcon] 警告: ${pageTitle} - アイコンURLプロパティが存在しません`);
        }

        // Discordユーザーを取得
        const discordUser = await client.users.fetch(discordId);
        
        // DiscordアイコンURLを取得
        const avatarUrl = discordUser.displayAvatarURL({ dynamic: true, size: 256 });
        
        // NotionページのアイコンとアイコンURLプロパティを更新
        try {
            await notion.pages.update({
                page_id: page.id,
                icon: {
                    type: 'external',
                    external: {
                        url: avatarUrl
                    }
                },
                properties: {
                    'アイコンURL': {
                        url: avatarUrl
                    }
                }
            });
            console.log(`[NotionIcon] 個別成功: ${pageTitle} - アイコンとURLを更新`);
        } catch (updateError) {
            console.error(`[NotionIcon] 個別更新エラー: ${pageTitle}`, updateError);
            // アイコンのみ更新を試行
            try {
                await notion.pages.update({
                    page_id: page.id,
                    icon: {
                        type: 'external',
                        external: {
                            url: avatarUrl
                        }
                    }
                });
                console.log(`[NotionIcon] 個別部分成功: ${pageTitle} - アイコンのみ更新`);
            } catch (iconError) {
                console.error(`[NotionIcon] 個別アイコン更新も失敗: ${pageTitle}`, iconError);
                throw iconError;
            }
        }

        return { 
            success: true, 
            pageTitle: pageTitle,
            discordUsername: discordUser.username,
            avatarUrl: avatarUrl 
        };
    } catch (error) {
        console.error('Discordアイコン設定エラー:', error);
        return { success: false, error: `エラーが発生しました: ${error.message}` };
    }
}

// Notionプロパティからテキストを取得する関数（notionHelpersから移植）
function getNotionPropertyText(property) {
    if (!property) return 'N/A';
    switch (property.type) {
        case 'rich_text':
            return property.rich_text[0]?.plain_text || 'N/A';
        case 'select':
            return property.select?.name || 'N/A';
        case 'status':
            return property.status?.name || 'N/A';
        case 'multi_select':
            return property.multi_select.map(item => item.name).join(', ') || 'N/A';
        case 'title':
            return property.title[0]?.plain_text || 'N/A';
        case 'formula':
            return property.formula.string || property.formula.number?.toString() || 'N/A';
        default:
            return 'N/A';
    }
}

// 【最重要修正】toHalfWidthをエクスポートリストに追加
module.exports = { 
    postStickyMessage, 
    sortClubChannels, 
    getGenerationRoleName, 
    safeIncrby, 
    toKanjiNumber, 
    toHalfWidth, 
    getAllKeys, 
    validateFile, 
    processFileSafely, 
    prepareFileForSend, 
    getActivityIcon,
    setKotehan,
    getKotehan,
    removeKotehan,
    setKoteicon,
    getKoteicon,
    removeKoteicon,
    generateKotehanTag,
    setKoteiconFromNotion,
    setAllNotionIcons,
    getNotionPropertyText,
    setDiscordIconsToNotion,
    setDiscordIconToNotion
};
