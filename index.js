const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { Redis } = require('@upstash/redis');
const { Client: NotionClient } = require('@notionhq/client');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  maxRetriesPerRequest: 5,
  enableReadyCheck: true,
  connectTimeout: 30000,
});
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

// メッセージキャッシュの制限を設定
client.options.messageCacheMaxSize = 100;
client.options.messageCacheLifetime = 300; // 5分
client.options.messageSweepInterval = 300; // 5分

// イベントリスナーの制限を設定
client.setMaxListeners(20);

// --- コマンドハンドリング ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// --- イベントハンドリング ---
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args, redis, notion));
	} else {
		client.on(event.name, (...args) => event.execute(...args, redis, notion));
	}
}

// グローバルエラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
    console.error('未処理のPromise拒否:', reason);
    // プロセスを終了させずにログのみ出力
});

process.on('uncaughtException', (error) => {
    console.error('未処理の例外:', error);
    // プロセスを終了させずにログのみ出力
});

// Discordクライアントのエラーハンドリング
client.on('error', (error) => {
    console.error('Discordクライアントエラー:', error);
});

// コマンドの自動デプロイ機能
async function deployCommands() {
    const { REST, Routes } = require('discord.js');
    
    const commands = [];
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    
    try {
        console.log('スラッシュコマンドの登録を開始します...');
        // client.application.idを使用してアプリケーションIDを取得
        const applicationId = client.application?.id || process.env.DISCORD_APPLICATION_ID;
        
        if (!applicationId) {
            throw new Error('アプリケーションIDが取得できません。DISCORD_APPLICATION_ID環境変数を設定するか、Botが正しくログインしていることを確認してください。');
        }
        
        await rest.put(Routes.applicationCommands(applicationId), { body: commands });
        console.log('スラッシュコマンドの登録が正常に完了しました。');
    } catch (error) {
        console.error('スラッシュコマンドの登録に失敗しました:', error);
    }
}

// Botが準備完了したらコマンドをデプロイ
client.once('ready', async () => {
    console.log(`${client.user.tag} がログインしました！`);
    await deployCommands();
});

// BotをDiscordにログイン
client.login(process.env.DISCORD_BOT_TOKEN);
