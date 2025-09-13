const { EmbedBuilder } = require('discord.js');
const config = require('../config.js');

// グローバルイベント状態管理
global.anonymousEvent = {
    isActive: false,
    counter: 0,
    threshold: 100, // 100回に1回
    notificationChannelId: '1415336647284883528'
};

/**
 * 匿名イベントの状態を取得
 */
function getEventStatus() {
    return {
        isActive: global.anonymousEvent.isActive,
        counter: global.anonymousEvent.counter,
        threshold: global.anonymousEvent.threshold
    };
}

/**
 * 匿名イベントを開始
 */
function startEvent() {
    global.anonymousEvent.isActive = true;
    global.anonymousEvent.counter = 0;
    return true;
}

/**
 * 匿名イベントを停止
 */
function stopEvent() {
    global.anonymousEvent.isActive = false;
    global.anonymousEvent.counter = 0;
    return true;
}

/**
 * 匿名が剥がれるかどうかを判定
 * @returns {boolean} 匿名が剥がれる場合true
 */
function shouldRevealAnonymous() {
    if (!global.anonymousEvent.isActive) {
        return false;
    }
    
    global.anonymousEvent.counter++;
    
    // 100回に1回の確率でtrueを返す
    return global.anonymousEvent.counter >= global.anonymousEvent.threshold;
}

/**
 * カウンターをリセット
 */
function resetCounter() {
    global.anonymousEvent.counter = 0;
}

/**
 * 通知チャンネルにイベント開始/停止の通知を送信
 * @param {Object} client - Discordクライアント
 * @param {string} action - 'start' または 'stop'
 * @param {string} userId - コマンド実行者のユーザーID
 */
async function sendEventNotification(client, action, userId) {
    try {
        const channel = client.channels.cache.get(global.anonymousEvent.notificationChannelId);
        if (!channel) {
            console.warn('通知チャンネルが見つかりません:', global.anonymousEvent.notificationChannelId);
            return;
        }

        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setTitle(action === 'start' ? '🎭 匿名イベント開始' : '🔒 匿名イベント停止')
            .setColor(action === 'start' ? 0x00ff00 : 0xff0000)
            .addFields(
                { name: '実行者', value: `${user.tag} (${userId})`, inline: true },
                { name: '状態', value: action === 'start' ? 'アクティブ' : '非アクティブ', inline: true },
                { name: '確率', value: '100回に1回で匿名が剥がれます', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: '匿名イベント管理システム' });

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('イベント通知の送信に失敗しました:', error);
    }
}

/**
 * 匿名が剥がれた際の特別な表示用のEmbedを作成
 * @param {Object} user - ユーザーオブジェクト
 * @param {string} content - メッセージ内容
 * @param {string} originalHash - 元の匿名ID
 * @returns {EmbedBuilder} 特別なEmbed
 */
function createRevealedEmbed(user, content, originalHash) {
    return new EmbedBuilder()
        .setTitle('🎭 匿名が剥がれました！')
        .setDescription(`**${user.username}** の匿名が100回目の投稿で剥がれました！`)
        .setColor(0xff6b6b)
        .addFields(
            { name: '元の匿名ID', value: originalHash, inline: true },
            { name: '投稿内容', value: content, inline: false }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: '匿名イベント - 100回に1回の確率で発生' });
}

module.exports = {
    getEventStatus,
    startEvent,
    stopEvent,
    shouldRevealAnonymous,
    resetCounter,
    sendEventNotification,
    createRevealedEmbed
};
