const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
    try {
        const appId = process.env.DISCORD_APPLICATION_ID;
        const guildId = process.env.DISCORD_GUILD_ID; // 任意（設定推奨）

        if (!appId) {
            throw new Error('環境変数 DISCORD_APPLICATION_ID が設定されていません。');
        }

        console.log('スラッシュコマンドの登録を開始します...');

        // 1) まずグローバルコマンドをクリア（過去の不要コマンドを削除）
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        console.log('グローバルコマンドをクリアしました。');

        // 2) ギルドにコマンドを登録（推奨）/ ギルドIDが無い場合はグローバルに登録
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
            console.log(`ギルド(${guildId})にコマンドを登録しました。`);
        } else {
            await rest.put(Routes.applicationCommands(appId), { body: commands });
            console.log('ギルドID未設定のため、グローバルにコマンドを登録しました。');
        }

        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
})();