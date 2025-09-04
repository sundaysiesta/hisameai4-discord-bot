const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();

async function main() {
    const appId = process.env.DISCORD_APPLICATION_ID;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !token) {
        console.error('環境変数 DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN が未設定です。');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(token);

    // 1) グローバルコマンドを全消去
    try {
        console.log('[1/3] グローバルコマンドをクリア中...');
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        console.log('グローバルコマンドをクリアしました。');
    } catch (e) {
        console.error('グローバルコマンドのクリアに失敗:', e);
    }

    // 2) 全参加ギルドのギルドコマンドを全消去
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.once('ready', async () => {
        try {
            console.log('[2/3] ギルドコマンドをクリア中...');
            const guilds = client.guilds.cache;
            for (const [, guild] of guilds) {
                try {
                    await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: [] });
                    console.log(` - クリア済み: ${guild.name} (${guild.id})`);
                } catch (e) {
                    console.error(` - 失敗: ${guild.name} (${guild.id})`, e);
                }
            }
            console.log('ギルドコマンドのクリアが完了しました。');
        } catch (e) {
            console.error('ギルドコマンドのクリア中にエラー:', e);
        } finally {
            // 3) 完了
            console.log('[3/3] 完了');
            await client.destroy();
            process.exit(0);
        }
    });

    await client.login(token);
}

main().catch(err => {
    console.error('致命的なエラー:', err);
    process.exit(1);
});


