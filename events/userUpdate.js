const { Events } = require('discord.js');
const config = require('../config.js');

module.exports = {
    // Botが検知するイベントの種類を指定
	name: Events.UserUpdate,
    
    // イベントが発生したときに実行される処理
	async execute(oldUser, newUser, redis, notion) {
		// 【最重要修正】アバターのハッシュを直接比較する、より確実な方法に変更
		if (oldUser.avatar === newUser.avatar) {
			return;
		}

        console.log(`[Avatar Sync] User ${newUser.username} updated their avatar. Attempting to sync with Notion.`);

		try {
            // Notionデータベースから、今回アバターを変更したユーザーのIDを持つページを探す
			const response = await notion.databases.query({
				database_id: config.NOTION_DATABASE_ID,
				filter: {
					property: 'DiscordユーザーID',
					rich_text: {
						equals: newUser.id,
					},
				},
			});

			// ページが見つかった場合のみ、アイコンを更新する
			if (response.results.length > 0) {
				const pageId = response.results[0].id;
                
                // 新しいアバターのURLを取得 (アニメーションアバターの場合はGIF形式)
                // 新しいアバターが設定されていない場合（削除された場合）はnullになる
				const newAvatarUrl = newUser.displayAvatarURL({ dynamic: true, size: 256 });

                // Notionページのアイコンを更新する
				await notion.pages.update({
					page_id: pageId,
					// 【修正】新しいアバターがある場合はURLを、ない場合はアイコンをリセット(null)する
					icon: newAvatarUrl ? {
						type: 'external',
						external: {
							url: newAvatarUrl,
						},
					} : null,
				});

				console.log(`[Avatar Sync] Successfully synced avatar for ${newUser.username} with Notion page ${pageId}.`);
			}
		} catch (error) {
			console.error(`[Avatar Sync] Failed to sync avatar for ${newUser.username}:`, error);
		}
	},
};
