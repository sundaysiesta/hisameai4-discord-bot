const { EmbedBuilder } = require('discord.js');
const config = require('../config.js');

/**
 * 匿名が剥がれるかどうかを判定（常に1%の確率）
 * @returns {boolean} 匿名が剥がれる場合true
 */
function shouldRevealAnonymous() {
    // 1%の確率でtrueを返す
    return Math.random() < 0.01;
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
        .setDescription(`**${user.username}** の匿名が1%の確率で剥がれました！`)
        .setColor(0xff6b6b)
        .addFields(
            { name: '元の匿名ID', value: originalHash, inline: true },
            { name: '投稿内容', value: content, inline: false }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: '匿名システム - 1%の確率で発生' });
}

module.exports = {
    shouldRevealAnonymous,
    createRevealedEmbed
};
